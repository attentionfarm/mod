import { update } from 'claude-code';
import { TOOL_SCHEMAS } from './tool-schemas.mjs';

const TICKER_STATE = { plugin: 'attentionfarm', key: 'ticker' };
const TICKER_OFFSET = { plugin: 'attentionfarm', key: 'tickerOffset' };
const ACCOUNT = { plugin: 'attentionfarm', key: 'account' };
const PANE = { plugin: 'attentionfarm', key: 'pane' };
const BACKUP = { plugin: 'attentionfarm', key: 'backup' };
// Free tokens this Claude Code session used through attentionfarm, counted here from each model
// request's own usage. Its own key, so switching back to claude keeps it.
const TOKENS = { plugin: 'attentionfarm', key: 'backupTokens' };
const SWITCH = { plugin: 'attentionfarm', key: 'switchPose' };
// The free models attentionfarm offers, as the server lists them, and the one the person picked. The pick
// is also kept in $.store, so the next session starts on it.
const FREE_MODELS = { plugin: 'attentionfarm', key: 'freeModels' };
const FREE_MODEL = { plugin: 'attentionfarm', key: 'freeModel' };
const FREE_MODEL_STORE = 'freeModel';
// Watch ad, get tokens: whether an ad can be watched now, why not, and the tokens earned to spend, as the server says.
const EARN = { plugin: 'attentionfarm', key: 'earn' };
const INITIAL_EARN = { available: false, earned: 0 };
const FREE_MODEL_PATTERN = /^[a-z0-9._-]+\/[a-z0-9._-]+:free$/;
const NO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, steps: 0 };
const TICKER_COPY = 'watch ad, get tokens | attentionfarm | ';
const TICKER_WIDTH = 60;
const INITIAL_TICKER = { enabled: true, paused: false };

const MOD_VERSION = '0.4.0';
const PANE_ID = 'attentionfarm-account';
const PRODUCTION_API = 'https://api.attentionfarm.com/api/mod';
const PRODUCTION_SERVICE = 'attentionfarm-mod';
const DEV_SERVICE = 'attentionfarm-mod-dev';
const SECURITY = '/usr/bin/security';
// Surfaces that draw native inputs the person can type into: the terminal and claude code desktop.
const LOGIN_SURFACES = new Set(['terminal', 'desktop']);
const KEYCHAIN_ACCOUNT = 'session';
const REQUEST_TIMEOUT_MS = 10000;
const RESEND_AFTER_MS = 60000;
const CODE_LIFETIME_MS = 10 * 60 * 1000;
const TOKEN_PATTERN = /^afm_[A-Za-z0-9_-]{43}$/;
const MASKED_PATTERN = /^[a-z0-9]?•••@[a-z0-9.-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INITIAL_ACCOUNT = { status: 'unknown' };
// The palette: monochrome plus one signal, tide. Raw hex does not follow the host theme, so tide only
// ever appears as a border or as a chip with its own ink, which reads on light and dark alike.
const TIDE = '#2EC4B6';
const TIDE_INK = '#03211F';
const SITE_URL = 'https://attentionfarm.com';
const PRIVACY_URL = `${SITE_URL}/privacy`;
const FLASH_MS = 5000;
// `site` is where the flow is drawn: a pane opened by a command, or the band itself after one of
// its buttons is pressed (the band then holds the keyboard, so a pane could not take it).
// Free backup: after Claude stops at a usage limit, this process can send its requests to a free model
// through attentionfarm until the person switches back. Only these stops offer it.
const BACKUP_STOPS = new Set(['rate_limit', 'billing_error', 'oauth_org_not_allowed']);
const BACKUP_KEY_PATTERN = /^afb_[A-Za-z0-9_-]{43}$/;
const INITIAL_BACKUP = { status: 'off' };
const INITIAL_PANE = { site: 'none', step: 'email', intent: 'signup', busy: false, canResend: false };

const COPY = {
  unsupported: 'login works in claude code on macos for now.',
  network: "couldn't reach attentionfarm. check your connection and try again.",
  unavailable: "login isn't available right now.",
  invalidEmail: 'enter a valid email.',
  backupUsedUp: "today's free requests are used up. they reset at midnight utc; switch back to claude meanwhile.",
  backupUsedUpEarn: "today's free requests are used up. watch ad, get tokens to keep going, or switch back to claude.",
  backupRejected: "the free model couldn't take this request. try again, or switch back to claude.",
  freeToolAsk: 'the free model (through attentionfarm) asked for this. check it before allowing.',
  backupUnavailable: "free backup isn't available right now.",
  backupBusy: 'the free model is busy right now. try again in a minute, or switch back to claude.',
  enterCode: 'enter the 6-digit code from the email.',
  rateLimited: 'too many codes for this email. try again in 15 minutes.',
  emailFailed: "we couldn't send the email. try again in a minute.",
  expired: 'that code expired. send a new one.',
  locked: 'too many tries. send a new code.',
  keychain: "couldn't save your login to the keychain. try again.",
  sessionEnded: 'your attentionfarm session ended. log in again.',
  generic: 'something went wrong. try again.',
};

// Session state survives hot reload; timer handles and the in-progress flow do not.
let timer;
let generation = 0;
let interactive = false;
let apiTarget;
let bandRequestId = 'AbovePrompt';
let restoring = false;
let switching = false;
// What was typed and the challenge id stay out of $.state, which any plugin can read. The session
// token is never held here at all: it is read from the keychain when a request needs it.
const flow = { gen: 0, typedEmail: '', email: '', typedCode: '', challengeId: undefined, expiresAt: 0, devCode: undefined, busy: false, resendTimer: undefined };

function stopTicker() {
  generation += 1;
  timer?.cancel();
  timer = undefined;
}

async function syncTicker($) {
  stopTicker();
  const currentGeneration = generation;
  const { value: ticker = INITIAL_TICKER } = await $.state.get(TICKER_STATE);
  if (currentGeneration !== generation) return;
  if (!interactive || !ticker.enabled) {
    $.ui.status(undefined);
    return;
  }
  let { value: offset = 0 } = await $.state.get(TICKER_OFFSET);
  if (currentGeneration !== generation) return;
  offset %= TICKER_COPY.length;
  const loop = TICKER_COPY.repeat(Math.ceil(TICKER_WIDTH / TICKER_COPY.length) + 1);
  const draw = () => $.ui.status(loop.slice(offset, offset + TICKER_WIDTH));
  draw();
  if (ticker.paused) return;
  timer = $.clock.every(1000, async () => {
    if (currentGeneration !== generation) return;
    offset = (offset + 2) % TICKER_COPY.length;
    await $.state.set(TICKER_OFFSET, offset);
    if (currentGeneration === generation) draw();
  });
}

async function setTicker($, action) {
  stopTicker();
  const { value: current = INITIAL_TICKER } = await $.state.get(TICKER_STATE);
  const updated = action === 'off' ? { ...current, enabled: false }
    : action === 'on' ? { enabled: true, paused: false }
    : { ...current, paused: action === 'pause' };
  await $.state.set(TICKER_STATE, updated);
  await syncTicker($);
}

// --- account ---------------------------------------------------------------

// Only a local worker may replace the production api, and it gets its own keychain item.
async function target($) {
  if (apiTarget) return apiTarget;
  const override = await $.env.get('ATTENTIONFARM_MOD_API_BASE');
  const local = /^(https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?)\/?$/.exec(override || '');
  apiTarget = local ? { api: `${local[1]}/api/mod`, service: DEV_SERVICE, dev: true } : { api: PRODUCTION_API, service: PRODUCTION_SERVICE, dev: false };
  return apiTarget;
}

function maskEmail(email) {
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase().replace(/[^a-z0-9.-]/g, '');
  const first = /^[a-z0-9]/i.test(local) ? local[0].toLowerCase() : '';
  return `${first}•••@${domain}`;
}

function decodeKeychainBlob(hex) {
  try { return decodeURIComponent(hex.replace(/(..)/g, '%$1')); } catch { return ''; }
}

async function keychainToken($, service) {
  const result = await $.process.run([SECURITY, 'find-generic-password', '-s', service, '-a', KEYCHAIN_ACCOUNT, '-w'], { timeoutMs: 10000 });
  if (result.exitCode !== 0) return undefined;
  const token = result.stdout.trim();
  return TOKEN_PATTERN.test(token) ? token : undefined;
}

async function keychainMasked($, service) {
  const result = await $.process.run([SECURITY, 'find-generic-password', '-s', service, '-a', KEYCHAIN_ACCOUNT], { timeoutMs: 10000 });
  const match = /"icmt"<blob>=(?:0x([0-9A-Fa-f]+)\s+"[^\n]*"|"([^"\n]*)")/.exec(result.stdout || '');
  const masked = match ? (match[1] ? decodeKeychainBlob(match[1]) : match[2]) : '';
  return MASKED_PATTERN.test(masked) ? masked : undefined;
}

// The token reaches `security` on stdin only, never in the argument list.
async function keychainSave($, service, token, masked) {
  if (!TOKEN_PATTERN.test(token) || !MASKED_PATTERN.test(masked)) throw new Error('unsafe keychain value');
  const result = await $.process.run([SECURITY, '-i'], {
    stdin: `add-generic-password -U -s "${service}" -a "${KEYCHAIN_ACCOUNT}" -j "${masked}" -w "${token}"\n`,
    timeoutMs: 10000,
  });
  if (result.exitCode !== 0 || (await keychainToken($, service)) !== token) throw new Error('keychain write failed');
}

async function keychainForget($, service) {
  try { await $.process.run([SECURITY, 'delete-generic-password', '-s', service, '-a', KEYCHAIN_ACCOUNT], { timeoutMs: 10000 }); } catch {}
}

async function request($, method, path, { body, token } = {}) {
  const { api } = await target($);
  const headers = { 'x-attentionfarm-mod': MOD_VERSION };
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  let deadline;
  const timeout = new Promise(resolve => { deadline = $.clock.after(REQUEST_TIMEOUT_MS, () => resolve(undefined)); });
  try {
    const init = body ? { method, headers, body: JSON.stringify(body) } : { method, headers };
    const response = await Promise.race([$.http.fetch(`${api}${path}`, init), timeout]);
    if (!response) return { status: 0, data: {} };
    let data = {};
    try { data = JSON.parse(response.text) || {}; } catch {}
    return { status: response.status, data };
  } catch {
    return { status: 0, data: {} };
  } finally {
    deadline?.cancel();
  }
}

async function sessionToken($) {
  const { service } = await target($);
  return keychainToken($, service).catch(() => undefined);
}

// What the server said about earning, kept for the band. `enabled`: earning exists at all; `available`: an ad
// can be watched now; `message`: why not, when a limit is reached; `earned`: tokens earned and not yet spent.
// From /ad/status and an ad's start (the whole picture), its finish (a limit it met), the backup key and each
// paid reply (the balance alone).
const SAFE_COPY = /^[a-z0-9 .,']{1,120}$/;
const LIMITS = new Set(['daily_limit', 'account_limit']);
async function rememberEarn($, data = {}) {
  const { value: current = INITIAL_EARN } = await $.state.get(EARN);
  const next = { ...current };
  const message = typeof data.message === 'string' && SAFE_COPY.test(data.message) ? data.message : undefined;
  if (typeof data.available === 'boolean') {
    next.enabled = data.available || LIMITS.has(data.reason);
    next.available = data.available;
    next.message = data.available ? undefined : message;
  } else if (LIMITS.has(data.reason)) {
    next.available = false;
    next.message = message;
  }
  if (data.earn_available === true) next.enabled = true;
  if (Number.isInteger(data.earned_tokens) && data.earned_tokens >= 0) next.earned = data.earned_tokens;
  if (Number.isInteger(data.tokens_per_ad) && data.tokens_per_ad > 0) next.tokensPerAd = data.tokens_per_ad;
  if (Number.isInteger(data.ads_left_today) && data.ads_left_today >= 0) next.adsLeft = data.ads_left_today;
  await $.state.set(EARN, defined(next));
}

async function loadEarn($, token) {
  const result = await request($, 'GET', '/ad/status', { token });
  if (result.status === 200) await rememberEarn($, result.data);
}

// The surface the band was last drawn on: where a command's ad plays.
let lastSurface = 'terminal';

async function watchAd($, surface = lastSurface) {
  if (!(await sessionToken($))) {
    await openFlow($, 'signup', 'band');
    return { text: 'sign up first: tokens are earned to your account.' };
  }
  const played = await playAd($, surface);
  if (!adPlaying() && played?.text) $.ui.toast(played.text);
  return played;
}

function errorCopy(result) {
  if (result.status === 0) return COPY.network;
  const error = result.data?.error || {};
  const serverCopy = typeof error.message === 'string' && /^[a-z0-9 .,']{1,120}$/.test(error.message) ? error.message : undefined;
  switch (error.code) {
    case 'invalid_email': return COPY.invalidEmail;
    case 'rate_limited': return serverCopy || COPY.rateLimited;
    case 'invalid_code': {
      const left = Number(error.attempts_left);
      return Number.isInteger(left) && left > 0 ? `that code didn't match. ${left} ${left === 1 ? 'try' : 'tries'} left.` : "that code didn't match.";
    }
    case 'expired': return COPY.expired;
    case 'locked': return COPY.locked;
    case 'email_failed': return COPY.emailFailed;
    case 'login_unavailable': return COPY.unavailable;
    case 'unauthorized': return COPY.sessionEnded;
  }
  if (result.status === 404 || result.status === 503) return COPY.unavailable;
  return COPY.generic;
}

function defined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

async function setPane($, patch) {
  const { value: current = INITIAL_PANE } = await $.state.get(PANE);
  const next = { ...current, ...patch };
  for (const key of Object.keys(patch)) if (patch[key] === undefined) delete next[key];
  await $.state.set(PANE, defined(next));
}

async function focus($, key) {
  const { value: pane = INITIAL_PANE } = await $.state.get(PANE);
  if (pane.site === 'none') return;
  try { await $.ui.focus({ requestId: pane.site === 'band' ? bandRequestId : PANE_ID, key }); } catch {}
}

const FIRST_KEY = { email: 'attentionfarm-email', code: 'attentionfarm-code', account: 'attentionfarm-logout', delete: 'attentionfarm-delete' };

// Show the flow where the person is: the band they pressed, or a pane for a command.
async function show($, site) {
  const { value: pane = INITIAL_PANE } = await $.state.get(PANE);
  await $.state.set(PANE, { ...pane, site });
  if (site === 'pane') await openPane($);
  else await $.ui.close({ id: PANE_ID }).catch(() => {});
  await focus($, FIRST_KEY[pane.step]);
}

async function closeFlow($) {
  await setPane($, { site: 'none', busy: false, error: undefined, note: undefined });
  await $.ui.close({ id: PANE_ID }).catch(() => {});
}

function resetFlow() {
  flow.gen += 1;
  flow.resendTimer?.cancel();
  Object.assign(flow, { email: '', typedCode: '', challengeId: undefined, expiresAt: 0, devCode: undefined, busy: false, resendTimer: undefined });
}

async function openPane($) {
  await $.ui.open({ id: PANE_ID, title: 'attentionfarm', focus: true, closeOnEscape: true, rows: 8 });
}

// The desktop app hosts its session through the sdk, so session.start reports no surface and no
// person; the band drawing on a login surface is what says someone is there. Restore once, from
// whichever comes first, and never from a render itself (a render hook may not write state).
function ensureRestore($) {
  if (restoring) return;
  restoring = true;
  $.clock.after(0, () => restore($));
}

async function usableAccount($) {
  const { value: account = INITIAL_ACCOUNT } = await $.state.get(ACCOUNT);
  return account.status === 'unsupported' || account.status === 'unknown' ? undefined : account;
}

async function openFlow($, intent, site = 'pane') {
  const account = await usableAccount($);
  if (!account) {
    $.ui.toast(COPY.unsupported);
    return false;
  }
  if (account.status === 'in' || account.status === 'offline') {
    await setPane($, { step: 'account', error: undefined, note: undefined, busy: false });
  } else if (flow.challengeId && (await $.clock.now()) < flow.expiresAt) {
    await setPane($, { step: 'code', busy: false });
  } else {
    resetFlow();
    await $.state.set(PANE, { ...INITIAL_PANE });
  }
  await show($, site);
  return true;
}

async function openAccount($, site = 'pane') {
  const account = await usableAccount($);
  if (!account) {
    $.ui.toast(COPY.unsupported);
    return false;
  }
  if (account.status === 'out') return openFlow($, 'login', site);
  await setPane($, { step: 'account', error: undefined, note: undefined, busy: false });
  await show($, site);
  return true;
}

async function sendCode($, typed, { resend = false } = {}) {
  if (flow.busy) return;
  const email = resend ? flow.email : typed.trim().toLowerCase();
  if (!resend) flow.typedEmail = typed;
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    await setPane($, { error: COPY.invalidEmail, note: undefined });
    return;
  }
  const gen = flow.gen;
  flow.busy = true;
  await setPane($, { busy: true, error: undefined, note: undefined });
  // One door: the server creates the account only when the email is new and logs in otherwise.
  const body = { email, intent: 'signup' };
  const result = await request($, 'POST', '/auth/start', { body });
  if (gen !== flow.gen) return;
  flow.busy = false;
  if (result.status !== 202 || typeof result.data.challenge_id !== 'string') {
    await setPane($, { busy: false, error: errorCopy(result) });
    return;
  }
  const { dev } = await target($);
  flow.email = email;
  flow.challengeId = result.data.challenge_id;
  flow.expiresAt = (await $.clock.now()) + CODE_LIFETIME_MS;
  flow.typedCode = '';
  flow.devCode = dev && /^\d{6}$/.test(result.data.dev_code || '') ? result.data.dev_code : undefined;
  flow.resendTimer?.cancel();
  flow.resendTimer = $.clock.after(RESEND_AFTER_MS, () => { if (gen === flow.gen) void setPane($, { canResend: true }); });
  await setPane($, { step: 'code', busy: false, canResend: false, sentTo: maskEmail(email), error: undefined, note: resend ? 'sent a new code.' : undefined });
  await focus($, 'attentionfarm-code');
}

async function useDifferentEmail($) {
  resetFlow();
  await setPane($, { step: 'email', busy: false, canResend: false, error: undefined, note: undefined, sentTo: undefined });
  await focus($, 'attentionfarm-email');
}

async function verifyCode($, typed) {
  if (flow.busy) return;
  const code = typed.replace(/[\s-]/g, '');
  if (!/^\d{6}$/.test(code)) {
    await setPane($, { error: COPY.enterCode, note: undefined });
    return;
  }
  if (!flow.challengeId) {
    await setPane($, { error: COPY.expired, canResend: true });
    return;
  }
  const gen = flow.gen;
  flow.busy = true;
  await setPane($, { busy: true, error: undefined, note: undefined });
  const result = await request($, 'POST', '/auth/verify', { body: { challenge_id: flow.challengeId, code } });
  if (gen !== flow.gen) return;
  flow.busy = false;
  const token = result.data?.token;
  const email = result.data?.account?.email;
  if (result.status !== 200 || typeof token !== 'string' || !TOKEN_PATTERN.test(token) || typeof email !== 'string' || !email.includes('@')) {
    const reason = result.data?.error?.code;
    await setPane($, { busy: false, error: errorCopy(result), ...(reason === 'expired' || reason === 'locked' ? { canResend: true } : {}) });
    return;
  }
  const masked = maskEmail(email);
  const { service } = await target($);
  try {
    await keychainSave($, service, token, masked);
  } catch {
    await setPane($, { busy: false, error: COPY.keychain });
    return;
  }
  const created = result.data.account.created === true;
  resetFlow();
  flow.typedEmail = '';
  await $.state.set(ACCOUNT, { status: 'in', masked, flash: created ? 'new' : 'back' });
  await $.state.set(PANE, { ...INITIAL_PANE });
  loadModels($, token).catch(() => {});
  await $.ui.close({ id: PANE_ID }).catch(() => {});
  // The band says "you're in." for a few seconds, then settles; no toast to miss.
  $.clock.after(FLASH_MS, async () => {
    const { value: account = INITIAL_ACCOUNT } = await $.state.get(ACCOUNT);
    if (account.flash) await $.state.set(ACCOUNT, { status: account.status, masked: account.masked });
  });
}

async function signedOut($, toast) {
  const { service } = await target($);
  await switchBack($);
  await keychainForget($, service);
  resetFlow();
  await $.state.set(ACCOUNT, { status: 'out' });
  await $.state.set(PANE, { ...INITIAL_PANE });
  await $.ui.close({ id: PANE_ID }).catch(() => {});
  $.ui.toast(toast);
}

async function logout($) {
  const { service } = await target($);
  const token = await keychainToken($, service).catch(() => undefined);
  if (token) await request($, 'POST', '/auth/logout', { token });
  // Local logout happens even when the server cannot be reached.
  await signedOut($, 'logged out of attentionfarm.');
}

async function deleteAccount($, typed) {
  if (flow.busy) return;
  if (typed.trim().toLowerCase() !== 'delete') {
    await setPane($, { error: 'type delete to confirm.' });
    return;
  }
  const { service } = await target($);
  const token = await keychainToken($, service).catch(() => undefined);
  if (!token) {
    await signedOut($, COPY.sessionEnded);
    return;
  }
  flow.busy = true;
  await setPane($, { busy: true, error: undefined });
  const result = await request($, 'DELETE', '/account', { token, body: { confirm: 'delete' } });
  flow.busy = false;
  if (result.status === 401) {
    await signedOut($, COPY.sessionEnded);
  } else if (result.status !== 200) {
    await setPane($, { busy: false, error: errorCopy(result) });
  } else {
    await signedOut($, 'your attentionfarm account is deleted.');
  }
}

// --- free backup -----------------------------------------------------------

// Free backup answers each model step itself: it reads this step's conversation, the system prompt
// and the tools, sends them to attentionfarm's free-model proxy with a backup key, and hands Claude
// Code the reply. Claude Code makes no request of its own for that step, so the person's Claude login
// is never used or sent anywhere, in the terminal and the desktop app alike. The backup key lives in
// this module's memory only; after a reload the next step asks for a new one.
let backupKey;
let systemPrompt = '';
// Tool calls the free model asked for. Each one is put to the person (or their mode's decider) before it
// runs, never allowed silently, since its source is a model reached over the network.
const freeToolIds = new Set();
const STEP_TIMEOUT_MS = 180000;
const STEP_MAX_TOKENS = 16000;
const STOP_REASONS = new Set(['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'refusal']);
const ANY_INPUT = { type: 'object', additionalProperties: true };

function tokenTotal(tokens = NO_TOKENS) {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;
}

function formatTokens(count) {
  if (count < 1000) return String(count);
  const [scaled, unit] = count < 1_000_000 ? [count / 1000, 'k'] : [count / 1_000_000, 'm'];
  return `${scaled < 10 ? scaled.toFixed(1).replace(/\.0$/, '') : Math.round(scaled)}${unit}`;
}

function addUsage(tokens = NO_TOKENS, usage) {
  const count = value => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
  return {
    input: tokens.input + count(usage.input_tokens),
    output: tokens.output + count(usage.output_tokens),
    cacheRead: tokens.cacheRead + count(usage.cache_read_input_tokens),
    cacheCreation: tokens.cacheCreation + count(usage.cache_creation_input_tokens),
    steps: tokens.steps + 1,
  };
}

async function backupState($) {
  const { value = INITIAL_BACKUP } = await $.state.get(BACKUP);
  return value;
}

// Asks attentionfarm for a backup key for this login session. A new key replaces the last.
async function mintBackupKey($) {
  const { service } = await target($);
  const token = await keychainToken($, service).catch(() => undefined);
  if (!token) return { signedOut: true };
  const result = await request($, 'POST', '/backup/key', { token });
  if (result.status === 401) {
    await signedOut($, COPY.sessionEnded);
    return { signedOut: true };
  }
  const key = result.data?.key;
  if (result.status !== 200 || !BACKUP_KEY_PATTERN.test(key || '')) {
    return { note: result.status === 503 ? COPY.backupUnavailable : errorCopy(result) };
  }
  backupKey = key;
  await rememberModels($, result.data).catch(() => {});
  await rememberEarn($, result.data).catch(() => {});
  const picked = await pickedModel($).catch(() => undefined);
  return {
    label: picked?.label || (typeof result.data?.model?.label === 'string' ? result.data.model.label.toLowerCase().slice(0, 40) : 'a free model'),
    remaining: Number.isInteger(result.data?.remaining_today) ? result.data.remaining_today : undefined,
  };
}

// The roster from a /backup reply: free ids only, short labels. A pick the roster no longer holds is dropped.
async function rememberModels($, data) {
  if (!Array.isArray(data?.models)) return;
  const models = data.models
    .filter(model => FREE_MODEL_PATTERN.test(model?.id || '') && typeof model.label === 'string')
    .slice(0, 20)
    .map(model => ({ id: model.id, label: model.label.toLowerCase().slice(0, 40) }));
  if (!models.length) return;
  await $.state.set(FREE_MODELS, models);
  const stored = await $.store.get(FREE_MODEL_STORE).catch(() => undefined);
  // '' is no pick: the server's own order.
  await $.state.set(FREE_MODEL, models.some(model => model.id === stored) ? stored : '');
}

async function loadModels($, token) {
  const result = await request($, 'GET', '/backup/status', { token });
  if (result.status === 200) await rememberModels($, result.data);
}

// A pick from the band. The next free step asks that model first; while free tokens are on, the band names it.
async function pickModel($, id) {
  const { value: models = [] } = await $.state.get(FREE_MODELS);
  const model = models.find(item => item.id === id);
  if (!model) return;
  await $.state.set(FREE_MODEL, id);
  await $.store.set(FREE_MODEL_STORE, id).catch(() => {});
  const backup = await backupState($);
  if (backup.status === 'on') await setBackup($, { ...backup, label: model.label });
}

async function pickedModel($) {
  const { value: id } = await $.state.get(FREE_MODEL);
  const { value: models = [] } = await $.state.get(FREE_MODELS);
  return models.find(model => model.id === id);
}

// Which half sits up: 0 claude, 1 free af tokens. The band draws the switch from this number alone.
function switchTarget(backup) {
  return backup.status === 'on' || backup.status === 'switching' ? 1 : 0;
}

// Every write of the backup state goes through here, so a change of side starts the one move it
// should. switching → on, a token count, a note: the side stays the same, and nothing moves again.
async function setBackup($, value) {
  const before = switchTarget(await backupState($));
  await $.state.set(BACKUP, value);
  moveSwitch($, before, switchTarget(value)).catch(() => {});
}

// The move, in still frames: the band redraws the pose each step, so a redraw in the middle shows the
// same frame instead of starting the move over. A newer move takes over from wherever this one is.
const SWITCH_FRAMES = 10;
const SWITCH_FRAME_MS = 40;
let switchTimer;
let switchHeading;
async function moveSwitch($, before, target) {
  // A move already heading there carries on untouched (switching, then on, is one move).
  if (switchTimer && switchHeading === target) return;
  // Where the halves are now: mid-move, or (before any move this session) the side the state was on.
  const { value: start = before } = await $.state.get(SWITCH);
  if (start === target) return;
  switchTimer?.cancel();
  switchHeading = target;
  let frame = 0;
  const timer = $.clock.every(SWITCH_FRAME_MS, async () => {
    frame += 1;
    const p = Math.min(1, frame / SWITCH_FRAMES);
    const eased = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
    if (p >= 1) {
      timer.cancel();
      if (switchTimer === timer) switchTimer = undefined;
    }
    await $.state.set(SWITCH, p >= 1 ? target : start + (target - start) * eased);
  });
  switchTimer = timer;
}

async function switchToBackup($) {
  if (switching) return;
  const { reason = 'manual' } = await backupState($);
  const { service } = await target($);
  if (!(await keychainToken($, service).catch(() => undefined))) {
    await openFlow($, 'signup', 'band');
    return;
  }
  switching = true;
  await setBackup($, { status: 'switching' });
  try {
    const minted = await mintBackupKey($);
    if (minted.signedOut) return;
    if (minted.note) {
      // After a limit the offer stays up with the reason; a switch by choice goes back to the band and says why.
      if (reason === 'limit') await setBackup($, { status: 'offer', reason, note: minted.note });
      else {
        await setBackup($, INITIAL_BACKUP);
        $.ui.toast(minted.note);
      }
      return;
    }
    await setBackup($, defined({ status: 'on', label: minted.label, remaining: minted.remaining }));
    // After a limit stop the turn Claude could not finish carries on; a switch by choice waits for the person.
    if (reason === 'limit') await $.prompt.submit({ text: 'continue where you left off.' }).catch(() => {});
  } finally {
    switching = false;
  }
}

async function switchBack($) {
  backupKey = undefined;
  await setBackup($, INITIAL_BACKUP);
}

async function offerBackup($) {
  await setBackup($, { status: 'offer', reason: 'limit' });
}

async function setBackupNote($, note) {
  const current = await backupState($);
  if (current.status === 'on') await setBackup($, defined({ ...current, note }));
}

// One step to the free model: Claude Code's own request, rebuilt from what a mod can read.
async function askFreeModel($, e) {
  const { api } = await target($);
  const found = e.agentId ? await $.session.messages({ agentId: e.agentId, as: 'api' }) : await $.session.messages({ as: 'api' });
  if (!Array.isArray(found)) return { note: COPY.backupUnavailable };
  const tools = (await $.tool.list()).map(tool => ({ name: tool.name, description: tool.description, input_schema: TOOL_SCHEMAS[tool.name] || ANY_INPUT }));
  // The picked model goes first at the server; with no pick, the server's own order.
  const picked = await pickedModel($).catch(() => undefined);
  const body = JSON.stringify(defined({ model: picked?.id || 'attentionfarm-free', max_tokens: STEP_MAX_TOKENS, system: systemPrompt || undefined, messages: found, tools, stream: false }));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!backupKey) {
      const minted = await mintBackupKey($);
      if (minted.signedOut) return { note: COPY.sessionEnded };
      if (minted.note) return { note: minted.note };
    }
    let deadline;
    const timeout = new Promise(resolve => { deadline = $.clock.after(STEP_TIMEOUT_MS, () => resolve(undefined)); });
    let response;
    try {
      response = await Promise.race([$.http.fetch(`${api}/backup/v1/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${backupKey}`, 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-attentionfarm-mod': MOD_VERSION },
        body,
      }), timeout]);
    } catch {
      response = undefined;
    } finally {
      deadline?.cancel();
    }
    if (!response) return { note: COPY.network };
    let data = {};
    try { data = JSON.parse(response.text) || {}; } catch {}
    // A key that ended (a new one elsewhere, a logout) is replaced once.
    if (response.status === 401 && attempt === 0) { backupKey = undefined; continue; }
    if (response.status === 429 && /used up/.test(data?.error?.message || '')) {
      const { value: earn = INITIAL_EARN } = await $.state.get(EARN);
      return { note: earn.enabled ? COPY.backupUsedUpEarn : COPY.backupUsedUp };
    }
    if (response.status !== 200) {
      return { note: response.status === 400 ? COPY.backupRejected : response.status === 503 ? COPY.backupUnavailable : COPY.backupBusy };
    }
    // Which free model of attentionfarm's roster answered.
    const label = String(response.headers?.['x-attentionfarm-model-label'] || '').toLowerCase().slice(0, 40) || undefined;
    const left = Number.parseInt(response.headers?.['x-attentionfarm-earned-tokens'] ?? '', 10);
    if (Number.isInteger(left) && left >= 0) await rememberEarn($, { earned_tokens: left }).catch(() => {});
    return { data, label };
  }
  return { note: COPY.backupUnavailable };
}

// Streams a free-model reply into the step as Claude Code's own would arrive: text, tool calls with
// their arguments, then the stop with what it used. Thinking is shown and not kept.
async function* answerStep($, e) {
  const asked = await askFreeModel($, e);
  if (asked.note) {
    await setBackupNote($, asked.note);
    const text = `attentionfarm free backup: ${asked.note}`;
    yield { kind: 'text', index: 0, text };
    yield { kind: 'stop', stopReason: 'end_turn', usage: null };
    return { turnId: e.turnId, index: e.index, answer: text, toolUses: [], stopReason: 'end_turn', usage: null };
  }
  const { data, label } = asked;
  let answer = '';
  const toolUses = [];
  let index = 0;
  for (const block of Array.isArray(data.content) ? data.content : []) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text) {
      answer += block.text;
      yield { kind: 'text', index, text: block.text };
      index += 1;
    } else if (block?.type === 'thinking' && typeof block.thinking === 'string' && block.thinking) {
      yield { kind: 'thinking', index, text: block.thinking };
      index += 1;
    } else if (block?.type === 'tool_use' && typeof block.name === 'string' && typeof block.id === 'string') {
      const input = block.input && typeof block.input === 'object' ? block.input : {};
      freeToolIds.add(block.id);
      yield { kind: 'tool', index, id: block.id, name: block.name };
      yield { kind: 'input', index, json: JSON.stringify(input) };
      toolUses.push({ name: block.name, input });
      index += 1;
    }
  }
  const stopReason = toolUses.length ? 'tool_use' : STOP_REASONS.has(data.stop_reason) ? data.stop_reason : 'end_turn';
  const reported = data.usage && typeof data.usage === 'object' ? data.usage : {};
  const usage = {
    input_tokens: Number(reported.input_tokens) || 0,
    output_tokens: Number(reported.output_tokens) || 0,
    cache_read_input_tokens: Number(reported.cache_read_input_tokens) || 0,
    cache_creation_input_tokens: Number(reported.cache_creation_input_tokens) || 0,
    model: typeof data.model === 'string' ? data.model : 'attentionfarm-free',
  };
  // Counted before the stop is yielded: the engine may stop reading at the stop, and nothing after it runs.
  try { await update($, TOKENS, tokens => addUsage(tokens, usage)); } catch {}
  try {
    const current = await backupState($);
    if (current.status === 'on') await setBackup($, defined({ ...current, note: undefined, label: label || current.label, remaining: Number.isInteger(current.remaining) ? Math.max(0, current.remaining - 1) : undefined }));
  } catch {}
  yield { kind: 'stop', stopReason, usage };
  return { turnId: e.turnId, index: e.index, answer, toolUses, stopReason, usage };
}

async function refreshBackup($) {
  const backup = await backupState($);
  if (backup.status !== 'on') return;
  const { service } = await target($);
  const token = await keychainToken($, service).catch(() => undefined);
  if (!token) return;
  const result = await request($, 'GET', '/backup/status', { token });
  if (result.status === 200 && Number.isInteger(result.data?.remaining_today)) {
    const current = await backupState($);
    if (current.status === 'on') await setBackup($, { ...current, remaining: result.data.remaining_today });
  }
}

// On a terminal session: read the keychain, then ask the server whether the session still stands.
async function restore($) {
  const { service } = await target($);
  let token;
  try {
    token = await keychainToken($, service);
  } catch {
    await $.state.set(ACCOUNT, { status: 'unsupported' });
    return;
  }
  if (!token) {
    await $.state.set(ACCOUNT, { status: 'out' });
    return;
  }
  const masked = (await keychainMasked($, service).catch(() => undefined)) || 'your account';
  await $.state.set(ACCOUNT, { status: 'in', masked });
  const result = await request($, 'GET', '/me', { token });
  const email = result.data?.account?.email;
  if (result.status === 200 && typeof email === 'string' && email.includes('@')) {
    await $.state.set(ACCOUNT, { status: 'in', masked: maskEmail(email) });
    await loadModels($, token).catch(() => {});
    await loadEarn($, token).catch(() => {});
  } else if (result.status === 401) {
    await keychainForget($, service);
    await $.state.set(ACCOUNT, { status: 'out' });
    $.ui.toast(COPY.sessionEnded);
  } else {
    await $.state.set(ACCOUNT, { status: 'offline', masked });
  }
}

function line(Text, value, props = {}) {
  return Text({ ...props, children: [value] });
}

// A Button blank to the eye, laid over something drawn: the desktop paints a Button's text in its own
// style, so a tide chip or a picture inside one would lose its look. Over it, the look stays and it presses.
const BLANK = '\u2800';
function overlay(ui, { key, width, onPress }) {
  const { Box, Text, Button } = ui;
  return Box({ position: 'absolute', left: 0, top: 0, children: [
    Button({ key, plain: true, onPress, children: [Text({ children: [BLANK.repeat(width)] })] }),
  ] });
}

// The wordmark: the tide chip, opening the website. The terminal keeps a Button's chip as drawn.
function wordmark($, ui, surface) {
  const { Box, Text, Button } = ui;
  const chip = Text({ bold: true, backgroundColor: TIDE, color: TIDE_INK, children: [' attentionfarm '] });
  const onPress = () => openUrl($, SITE_URL, 'attentionfarm.com');
  if (surface === 'terminal') return Button({ key: 'attentionfarm-site', plain: true, onPress, children: [chip] });
  return Box({ key: 'attentionfarm-wordmark', children: [chip, overlay(ui, { key: 'attentionfarm-site', width: 15, onPress })] });
}

// Every attentionfarm band wears a tide outline. The desktop app draws its own padded card around
// the band, so there the outline is pulled out over that padding to sit at the card's edge.
function frame(Box, children, surface) {
  const pull = surface === 'terminal' ? {} : { margin: -1 };
  return Box({ flexDirection: 'column', borderStyle: 'round', borderColor: TIDE, paddingX: 1, ...pull, children });
}

function openUrl($, url, name) {
  return $.process.run(['open', url]).then(result => {
    if (result.exitCode !== 0) throw new Error('open-failed');
  }).catch(() => $.ui.toast(`could not open ${name} in your browser.`));
}

function openPrivacy($) {
  return openUrl($, PRIVACY_URL, 'attentionfarm.com/privacy');
}

function heading(Box, Text, Button, $, title, detail, { close = true, detailWrap = 'truncate-end' } = {}) {
  const parts = [line(Text, title, { bold: true })];
  if (detail) parts.push(line(Text, detail, { dimColor: true, wrap: detailWrap }));
  parts.push(Box({ flexGrow: 1 }));
  if (close) parts.push(Button({ key: 'attentionfarm-close', plain: true, dimColor: true, label: 'close', onPress: () => closeFlow($) }));
  return Box({ flexDirection: 'row', alignItems: 'center', columnGap: 2, children: parts });
}

// A field spans the band's width rather than sizing to its placeholder.
function field(Box, input) {
  return Box({ flexDirection: 'row', width: '100%', children: [input] });
}

// Controls under a field: all Buttons, so the app draws them at one size on one baseline.
function controls(Box, children) {
  return Box({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, children });
}

function renderFlow($, e, pane, account) {
  const { Box, Text, Button, Input } = $.ui.resolve(e);
  const head = (title, detail, options) => heading(Box, Text, Button, $, title, detail, options);
  const lines = [];
  const status = pane.busy ? line(Text, pane.step === 'code' ? 'checking…' : pane.step === 'email' ? 'sending your code…' : 'one moment…', { dimColor: true })
    : pane.error ? line(Text, pane.error, { bold: true })
    : pane.note ? line(Text, pane.note, { dimColor: true })
    : undefined;
  if (pane.step === 'email') {
    lines.push(head('sign up or log in', 'one code by email. no password.'));
    lines.push(field(Box, Input({
      key: 'attentionfarm-email', placeholder: 'you@example.com', value: flow.typedEmail, submitLabel: 'send code', autoFocus: true,
      onInput: value => { flow.typedEmail = value; },
      onSubmit: value => sendCode($, value),
    })));
    if (status) lines.push(status);
    lines.push(controls(Box, [
      Box({ flexGrow: 1 }),
      Button({ key: 'attentionfarm-privacy', plain: true, dimColor: true, label: 'privacy', onPress: () => openPrivacy($) }),
    ]));
  } else if (pane.step === 'code') {
    lines.push(head('check your email', `sent to ${pane.sentTo || 'your inbox'}`, { detailWrap: 'truncate-middle' }));
    lines.push(field(Box, Input({
      key: 'attentionfarm-code', placeholder: '6-digit code', value: flow.typedCode, submitLabel: 'verify', autoFocus: true,
      onInput: value => {
        flow.typedCode = value;
        const digits = value.replace(/[\s-]/g, '');
        if (/^\d{6}$/.test(digits)) return verifyCode($, digits);
      },
      onSubmit: value => { flow.typedCode = value; return verifyCode($, value); },
    })));
    if (status) lines.push(status);
    if (flow.devCode) lines.push(line(Text, `local dev code: ${flow.devCode}`, { dimColor: true }));
    lines.push(controls(Box, [
      pane.canResend
        ? Button({ key: 'attentionfarm-resend', plain: true, label: 'resend code', onPress: () => sendCode($, '', { resend: true }) })
        : Button({ key: 'attentionfarm-resend-wait', plain: true, dimColor: true, label: 'resend in a minute', onPress: () => setPane($, { note: 'you can resend a minute after the last code.', error: undefined }) }),
      Button({ key: 'attentionfarm-change-email', plain: true, dimColor: true, label: 'wrong email?', onPress: () => useDifferentEmail($) }),
    ]));
  } else if (pane.step === 'delete') {
    lines.push(head('delete your account?'));
    lines.push(line(Text, "this removes your email from attentionfarm. it can't be undone.", { dimColor: true }));
    lines.push(field(Box, Input({ key: 'attentionfarm-delete', placeholder: 'type delete', submitLabel: 'delete', autoFocus: true, onSubmit: value => deleteAccount($, value) })));
    if (status) lines.push(status);
    lines.push(controls(Box, [Button({ key: 'attentionfarm-cancel', plain: true, label: 'cancel', onPress: () => setPane($, { step: 'account', error: undefined }) })]));
  } else {
    lines.push(head(account.masked || 'your account', account.status === 'offline' ? 'offline' : undefined));
    lines.push(line(Text, 'watch an ad, get tokens for claude code.', { dimColor: true }));
    if (status) lines.push(status);
    lines.push(controls(Box, [
      Button({ key: 'attentionfarm-logout', plain: true, label: 'log out', onPress: () => logout($) }),
      Box({ flexGrow: 1 }),
      Button({ key: 'attentionfarm-delete-account', plain: true, dimColor: true, label: 'delete account', onPress: async () => { await setPane($, { step: 'delete', error: undefined }); await focus($, 'attentionfarm-delete'); } }),
    ]));
  }
  // On desktop a row of breathing room between rows; in a terminal one cell is a whole blank line.
  return Box({ flexDirection: 'column', rowGap: e.surface === 'terminal' ? 0 : 1, children: lines });
}

// The session's free tokens: the number first and bold, the words quiet.
function tokenCount(Box, Text, used, rest = '') {
  return Box({ key: 'attentionfarm-tokens', flexDirection: 'row', flexShrink: 1, children: [
    line(Text, formatTokens(used), { bold: true }),
    line(Text, ` free tokens${rest}`, { dimColor: true, wrap: 'truncate-end' }),
  ] });
}

// Tokens earned from ads, still to spend: the same look as the free-token count.
function earnedCount(Box, Text, earned) {
  return Box({ key: 'attentionfarm-earned', flexDirection: 'row', flexShrink: 0, children: [
    line(Text, formatTokens(earned), { bold: true }),
    line(Text, ' earned', { dimColor: true }),
  ] });
}

// The way to earn: one button, and what an ad is worth beside it; or, when ads are done for now, why.
function watchRow($, Box, Text, Button, earn, surface, label = 'watch ad, get tokens') {
  if (!earn.available) return earn.message ? line(Text, earn.message, { dimColor: true, wrap: 'truncate-end' }) : undefined;
  return Box({ flexDirection: 'row', alignItems: 'center', columnGap: 1, children: [
    Button({ key: 'attentionfarm-watch', plain: true, onPress: () => watchAd($, surface), children: [Text({ bold: true, children: [label] })] }),
    line(Text, `${formatTokens(earn.tokensPerAd || 1_000_000)} tokens for 15 seconds`, { dimColor: true, wrap: 'truncate-end' }),
  ] });
}

// Free backup in the band: the offer after a limit stop, then which model is answering and the way back.
function backupRows($, Box, Text, Button, account, backup, used, picker, pickedLabel, earn = INITIAL_EARN, surface = 'terminal') {
  if (backup.status === 'switching') return [line(Text, 'switching to free backup…', { dimColor: true })];
  if (backup.status === 'on') {
    const left = Number.isInteger(backup.remaining) ? ` · ${backup.remaining} left today` : '';
    // The day's free requests used up: earned tokens carry on, and the way to earn more sits right here.
    const usedUp = backup.note === COPY.backupUsedUpEarn || backup.remaining === 0;
    const offer = earn.enabled && usedUp ? watchRow($, Box, Text, Button, earn, surface, 'watch ad, get more') : undefined;
    // The picker names the model; the line adds one only when a different model answered (the pick was busy).
    const via = !picker ? ` · ${backup.label || 'a free model'}` : backup.label && backup.label !== pickedLabel ? ` · via ${backup.label}` : '';
    return [
      Box({ flexDirection: 'row', alignItems: 'center', columnGap: 2, children: [
        tokenCount(Box, Text, used, `${left}${via}`),
        ...(earn.earned > 0 ? [earnedCount(Box, Text, earn.earned)] : []),
        ...(picker ? [Box({ flexGrow: 1 }), Box({ key: 'attentionfarm-model-slot', flexShrink: 0, children: [picker] })] : []),
      ] }),
      ...(offer ? [offer] : backup.note ? [line(Text, backup.note, { dimColor: true, wrap: 'truncate-end' })] : []),
    ];
  }
  if (backup.status !== 'offer') return undefined;
  const loggedIn = account.status === 'in' || account.status === 'offline';
  return [
    Box({ flexDirection: 'row', columnGap: 1, children: [
      line(Text, 'you hit your claude limit.', { bold: true }),
      line(Text, 'keep going on a free model through attentionfarm, or wait for claude.', { dimColor: true, wrap: 'truncate-end' }),
    ] }),
    controls(Box, [
      Button({ key: 'attentionfarm-backup-on', variant: 'secondary', label: loggedIn ? 'continue free' : 'sign up to continue free', onPress: () => switchToBackup($) }),
      Button({ key: 'attentionfarm-backup-dismiss', plain: true, dimColor: true, label: 'not now', onPress: () => setBackup($, INITIAL_BACKUP) }),
      Box({ flexGrow: 1 }),
      Button({ key: 'attentionfarm-backup-privacy', plain: true, dimColor: true, label: "what's shared", onPress: () => openPrivacy($) }),
    ]),
    line(Text, backup.note || "free models' hosts may learn from what they receive.", { dimColor: true, wrap: 'truncate-end' }),
  ];
}

// The exchange: two halves, ink for claude and tide for free af tokens. Whichever side is answering sits
// up; halfway through a switch they line up into one circle. Offsets are in the 64-unit drawing.
const LIFT = 5;

// One still frame of the pose (0 claude up, 1 free up). No animation inside the picture: a picture that
// animates itself starts over each time the desktop rebuilds it, and one switch rebuilds it several times.
function exchangeSvg(t) {
  const dy = Number((LIFT * (2 * t - 1)).toFixed(2));
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    + `<style>.ink{fill:#111111}.tide{fill:${TIDE}}@media (prefers-color-scheme: dark){.ink{fill:#F2F2F2}}</style>`
    + `<path class="ink" d="M30 10 A22 22 0 0 0 30 54 Z" transform="translate(0 ${dy})"/>`
    + `<path class="tide" d="M34 10 A22 22 0 0 1 34 54 Z" transform="translate(0 ${-dy})"/>`
    + '</svg>';
}

// The terminal draws the same idea in one row of text: a half block is a half up or down.
function glyphs(t) {
  return t < 0.34 ? ['▀', '▄'] : t > 0.66 ? ['▄', '▀'] : ['█', '█'];
}

// The labels the switch shows; its label box is as wide as the longest, so a shorter one leaves room
// instead of moving the halves.
const SWITCH_LABELS = ['use free af tokens', 'switching…', 'back to claude'];
const SWITCH_LABEL_WIDTH = Math.max(...SWITCH_LABELS.map(label => label.length));

// The halves first, then the label, on the right beside the account. Only the label presses: anything laid over the
// picture to make it press gets a box of the desktop's own drawn behind it, and that box flickers with
// every frame of the move.
function exchangeButton(ui, surface, { key, label, pose: t, onPress }) {
  const { Box, Text, Button, Svg } = ui;
  // The terminal has no vector drawing (an Svg there draws nothing), so it gets the half blocks.
  if (Svg && surface !== 'terminal') {
    // Drawn as an image, not in a frame: a frame reloads its document on every new source and blanks while
    // it does. The keyed boxes keep the same picture element from frame to frame and across states.
    return Box({ key: 'attentionfarm-switch', flexDirection: 'row', alignItems: 'center', columnGap: 1, children: [
      Box({ key: 'attentionfarm-switch-icon', flexDirection: 'row', alignItems: 'center', children: [
        Svg({ source: exchangeSvg(t), alt: t >= 0.5 ? 'on free af tokens' : 'on claude', width: 16, height: 16 }),
      ] }),
      Box({ key: 'attentionfarm-switch-label', minWidth: SWITCH_LABEL_WIDTH, children: [
        Button({ key, plain: true, onPress, children: [Text({ children: [label] })] }),
      ] }),
    ] });
  }
  const [ink, tide] = glyphs(t);
  // Two half blocks, a space, then the label: the box holds the longest label so nothing shifts.
  return Box({ key: 'attentionfarm-switch', minWidth: SWITCH_LABEL_WIDTH + 3, children: [
    Button({ key, plain: true, label, onPress, children: [Text({ children: [ink, Text({ color: TIDE, children: [tide] }), ` ${label}`] })] }),
  ] });
}

// The model picker, under the email: the free models attentionfarm offers, one picked. Desktop draws it as a
// dropdown; the terminal as a picker the arrows move through.
function modelPicker($, ui, models, picked) {
  const { Select } = ui;
  if (!Select || !models.length) return undefined;
  return Select({
    key: 'attentionfarm-model',
    options: models.map(model => ({ value: model.id, label: model.label })),
    value: (picked || models[0]).id,
    onSelect: value => pickModel($, value),
  });
}

// The resting band: two lines, the wordmark and one action, then the honest line.
function renderBand($, e, account, backup = INITIAL_BACKUP, used = 0, canBackup = false, pose = switchTarget(backup), free = { models: [] }, earn = INITIAL_EARN) {
  const ui = $.ui.resolve(e);
  const { Box, Text, Button } = ui;
  const canLogin = LOGIN_SURFACES.has(e.surface) && account.status !== 'unsupported';
  const top = [wordmark($, ui, e.surface), Box({ flexGrow: 1 })];
  const loggedIn = account.status === 'in' || account.status === 'offline';
  // One slot, three states, on the right beside the account: use free af tokens while on claude (free tokens by
  // choice, not only after a limit), switching… mid-way, back to claude while on free tokens.
  if (backup.status === 'on') {
    top.push(exchangeButton(ui, e.surface, { key: 'attentionfarm-backup-off', label: 'back to claude', pose, onPress: () => switchBack($) }));
  } else if (backup.status === 'switching') {
    top.push(exchangeButton(ui, e.surface, { key: 'attentionfarm-switching', label: 'switching…', pose, onPress: () => {} }));
  } else if (loggedIn && canBackup && backup.status === 'off') {
    top.push(exchangeButton(ui, e.surface, { key: 'attentionfarm-free', label: 'use free af tokens', pose, onPress: () => switchToBackup($) }));
  }
  let second;
  if (loggedIn) {
    top.push(Button({
      key: 'attentionfarm-account', plain: true, dimColor: true,
      label: `${account.masked || 'your account'}${account.status === 'offline' ? ' · offline' : ''}`,
      onPress: () => openAccount($, 'band'),
    }));
    second = account.flash
      ? Box({ flexDirection: 'row', columnGap: 1, children: [
        line(Text, account.flash === 'new' ? "you're in." : 'welcome back.', { bold: true }),
        line(Text, account.flash === 'new' ? 'your account is ready.' : 'good to see you again.', { dimColor: true, wrap: 'truncate-end' }),
      ] })
      : (canBackup && earn.enabled && watchRow($, Box, Text, Button, earn, e.surface)) || line(Text, 'watch an ad, get tokens for claude code.', { dimColor: true, wrap: 'truncate-end' });
  } else {
    if (canLogin && account.status === 'out') {
      top.push(Button({ key: 'attentionfarm-signup', variant: 'secondary', label: 'sign up or log in', onPress: () => openFlow($, 'signup', 'band') }));
    }
    // Where login cannot happen, the band never asks for a sign-up it can't take.
    second = !canLogin ? line(Text, 'watch an ad, get tokens for claude code.', { dimColor: true, wrap: 'truncate-end' }) : Box({ flexDirection: 'row', columnGap: 1, children: [
      line(Text, 'watch an ad, get tokens', { bold: true }),
      line(Text, 'for claude code. one email code, no password.', { dimColor: true, wrap: 'truncate-end' }),
    ] });
  }
  // After backup, the session's free tokens stay in view at the end of the band's second line, and so do
  // tokens earned from ads and not yet spent.
  const earnedLeft = loggedIn && earn.earned > 0;
  if (used > 0 || earnedLeft) {
    second = Box({ flexDirection: 'row', alignItems: 'center', columnGap: 2, children: [
      Box({ flexShrink: 1, children: [second] }),
      Box({ flexGrow: 1 }),
      ...(used > 0 ? [tokenCount(Box, Text, used)] : []),
      ...(earnedLeft ? [earnedCount(Box, Text, earn.earned)] : []),
    ] });
  }
  // The picker sits at the right end of the second line, under the email, only while on free tokens: on claude
  // there is no free model to choose.
  const picker = loggedIn && canBackup && backup.status === 'on' ? modelPicker($, ui, free.models, free.picked) : undefined;
  const pickedLabel = (free.picked || free.models[0])?.label;
  const rows = backupRows($, Box, Text, Button, account, backup, used, picker, pickedLabel, earn, e.surface) || [second];
  return frame(Box, [Box({ flexDirection: 'row', alignItems: 'center', columnGap: 2, children: top }), ...rows], e.surface);
}

// --- watch ad, get tokens ---------------------------------------------------

// The 15 second house ad, played in the place attentionfarm gave this account (the side pane or the band above
// the text box). It cannot be stopped. While it plays the chat is frosted (each character drawn as ░, its shape
// kept), the band counts down, and anything sent waits for the end: in its own hook when little of the ad is
// left, otherwise turned away and sent again once it ends. At the end the server is told, and pays the tokens
// only if its own clock saw the 15 seconds pass. What it is told: the view, whether it played to the end, the
// seconds, the surface, and how many messages waited (a count, never their text).

// The ad's two calls to attentionfarm, on the person's session.
async function adServer($, path, body) {
  const token = await sessionToken($);
  return token ? request($, 'POST', path, { token, body }) : { status: 401, data: {} };
}

const AD_PANE_ID = 'attentionfarm-ad';
const AD_FPS = 12;
const AD_FRAMES = 180;
const AD_SECONDS = AD_FRAMES / AD_FPS;
// Claude's own drawing, its text frosted.
const FROSTED_TEXT = new Set(['UserMessage', 'AssistantMessage']);
// One frosted line of the ad's own: these carry structured props, not a text to frost.
const FROSTED_ROW = new Set(['ToolUse', 'ToolResult', 'ToolGroup', 'ToolProgress', 'CommandOutput', 'Spinner', 'TurnDuration', 'InfoNotice']);
// A hook has about ten seconds of its own: a prompt sent with this much or less of the ad left waits in place.
const HOLD_IN_PLACE_SECONDS = 8;
const AD_AUDIO = 'assets/ad/house-ad.m4a';

const adFramePath = (root, i) => `${root}/assets/ad/f${String(i).padStart(3, '0')}.png`;
// Every letter, digit and mark becomes ░; spaces and line breaks stay, so the text keeps its shape.
const frostText = text => String(text ?? '').replace(/\S/gu, '░');

const adPlaying = () => adIsPlaying;

let adIsPlaying = false;
let adFrame = 0;
let adStartedAt = 0;
let adTimer;
let adSound;
let adGeneration = 0;
let adView;
let adPlacement = 'pane';
let adSurface = '';
let adBandSite = '';
let adHeld = 0;
let adDesktopFrames;
let adWaiting = [];
const adReleases = new Set();

const adSecondsLeft = () => Math.max(1, Math.ceil(AD_SECONDS - adFrame / AD_FPS));

async function loadAdDesktopFrames($) {
  if (adDesktopFrames) return adDesktopFrames;
  const out = [];
  for (let i = 0; i < AD_FRAMES; i += 1) out.push((await $.fs.read(adFramePath($.plugin.root, i), { as: 'bytes' })).base64);
  adDesktopFrames = out;
  return out;
}

function stopAdPlayback($) {
  adGeneration += 1;
  adTimer?.cancel(); adTimer = undefined;
  adSound?.abort(); adSound = undefined;
  adIsPlaying = false;
  for (const release of adReleases) release();
  adReleases.clear();
  $.ui.invalidate('ui.render');
}

async function sendAdWaiting($) {
  while (!adIsPlaying && adWaiting.length) {
    const text = adWaiting.shift();
    try { await $.prompt.submit({ text, asUser: true }); } catch { adWaiting.unshift(text); break; }
  }
}

async function reportAd($, completed) {
  const body = { view_id: adView, completed, seconds_watched: completed ? AD_SECONDS : Math.round(adFrame / AD_FPS * 10) / 10, held_messages: adHeld, surface: adSurface };
  adView = undefined;
  return adServer($, '/ad/finish', body).catch(() => ({ status: 0, data: {} }));
}

async function endAd($) {
  if (!adIsPlaying) return;
  adFrame = AD_FRAMES - 1;
  stopAdPlayback($);
  const result = await reportAd($, true);
  if (result.status === 200) {
    await rememberEarn($, result.data);
    const data = result.data || {};
    $.ui.toast(data.earned > 0 ? `+${formatTokens(data.earned)} tokens. ${formatTokens(data.earned_tokens ?? data.earned)} earned to spend.` : (data.message || "this ad didn't earn tokens."));
  } else {
    $.ui.toast("couldn't reach attentionfarm to count this ad.");
  }
  if (adPlacement === 'pane') await $.ui.close({ id: AD_PANE_ID }).catch(() => {});
  void sendAdWaiting($);
}

async function playAd($, from) {
  if (adIsPlaying) return { text: `the ad is already playing: ${adSecondsLeft()}s left.` };
  const started = await adServer($, '/ad/start', { surface: from });
  if (started.status !== 200) return { text: started.status === 0 ? "couldn't reach attentionfarm." : "watching ads for tokens isn't available right now." };
  const data = started.data || {};
  await rememberEarn($, data);
  if (!data.available || !data.view_id) return { text: data.message || "watching ads for tokens isn't available right now." };
  adGeneration += 1;
  const adMine = adGeneration;
  adView = data.view_id;
  adPlacement = data.placement === 'band' ? 'band' : 'pane';
  adSurface = from;
  adHeld = 0;
  if (adPlacement === 'pane') await $.ui.open({ id: AD_PANE_ID, title: 'attentionfarm' }).catch(() => {});
  if (adSurface !== 'terminal') { try { await loadAdDesktopFrames($); } catch {} }
  if (adMine !== adGeneration) return { text: 'the ad could not start.' };
  adIsPlaying = true; adFrame = 0;
  adStartedAt = await $.clock.now();
  adSound = new AbortController();
  $.audio.play({ asset: AD_AUDIO }, { signal: adSound.signal }).catch(() => {});
  $.ui.invalidate('ui.render');
  adTimer = $.clock.every(1000 / AD_FPS, async () => {
    if (adMine !== adGeneration) return;
    const elapsed = (await $.clock.now()) - adStartedAt;
    if (elapsed >= AD_SECONDS * 1000) { await endAd($); return; }
    const next = Math.min(AD_FRAMES - 1, Math.floor(elapsed * AD_FPS / 1000));
    if (next === adFrame) return;
    const second = Math.floor(adFrame / AD_FPS) !== Math.floor(next / AD_FPS);
    adFrame = next;
    // The pane cannot be put away while the ad plays: closed, it opens again within the second.
    if (second && adPlacement === 'pane') {
      const panes = await $.ui.panes().catch(() => []);
      if (adMine === adGeneration && !panes.some(pane => pane.id === AD_PANE_ID)) await $.ui.open({ id: AD_PANE_ID, title: 'attentionfarm' }).catch(() => {});
    }
    if (adMine !== adGeneration) return;
    if (adSurface !== 'terminal') { $.ui.invalidate('ui.render'); return; }
    // Terminal: swap the Image in place; redraw only when the countdown's second changes or a swap is refused.
    const swapped = await $.ui.blit({ requestId: adPlacement === 'pane' ? AD_PANE_ID : adBandSite, key: 'attentionfarm-ad', source: { file: adFramePath($.plugin.root, adFrame), format: 'png' } }).catch(() => ({ deny: 'threw' }));
    if (adMine !== adGeneration) return;
    if (second || swapped.deny) $.ui.invalidate('ui.render');
  });
  return { text: `playing a 15 second ad${adPlacement === 'band' ? ' above the text box' : ' in the side panel'}. the chat is back when it ends.` };
}

function adPicture(ui, e, room) {
  const { Text } = ui;
  if (e.surface === 'terminal' && ui.Image) {
    const rows = Math.max(6, Math.min(room.rows, Math.round(room.columns * 9 / 32)));
    const columns = Math.min(room.columns, Math.round(rows * 32 / 9));
    return ui.Image({ key: 'attentionfarm-ad', columns, rows, source: { file: adFramePath(room.root, adFrame), format: 'png' }, alt: 'attentionfarm ad (this terminal cannot show pictures; it still counts down)' });
  }
  if (ui.Svg) {
    const png = adDesktopFrames?.[adFrame];
    const size = room.height ? { width: Math.round(room.height * 16 / 9), height: room.height } : {};
    return png
      ? ui.Svg({ alt: 'attentionfarm ad', ...size, source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"${room.height ? '' : ' width="640" height="360"'}><image width="640" height="360" href="data:image/png;base64,${png}"/></svg>` })
      : Text({ dimColor: true, children: ['loading the ad…'] });
  }
  return Text({ dimColor: true, children: ['an ad is playing.'] });
}

const adCountdown = () => `ad · ${adSecondsLeft()}s · the chat is back when it ends${adWaiting.length ? ` · ${adWaiting.length} message${adWaiting.length === 1 ? '' : 's'} waiting` : ''}`;


function renderAdBand($, e) {
  const ui = $.ui.resolve(e);
  const { Box, Text } = ui;
  if (adPlacement !== 'band') return Text({ dimColor: true, children: [adCountdown()] });
  adSurface = e.surface;
  adBandSite = e.requestId || adBandSite;
  const rows = Math.max(4, (e.props?.maxRows ?? 12) - 1);
  return Box({ flexDirection: 'column', alignItems: 'center', children: [
    adPicture(ui, e, { root: $.plugin.root, columns: e.props?.bodyColumns ?? 80, rows, height: Math.min(rows * 20, 720) }),
    Text({ dimColor: true, children: [adCountdown()] }),
  ] });
}

// A session that ends mid-ad: the view is reported as left, never as watched. Called from the mod's own
// session.end hook (a plugin registers that event once).
function endAdSession($) {
  if (!adIsPlaying) return;
  stopAdPlayback($);
  adWaiting = [];
  void reportAd($, false);
}

function registerAd(on) {
  on('ui.render', { component: 'Pane', requestId: AD_PANE_ID }, async ($, e) => {
    const ui = $.ui.resolve(e);
    const { Box, Text } = ui;
    adSurface = e.surface;
    const columns = Math.max(20, Math.min(120, e.props?.bodyColumns ?? 64));
    return Box({ flexDirection: 'column', rowGap: 1, children: [
      adIsPlaying ? adPicture(ui, e, { root: $.plugin.root, columns, rows: Math.round(columns * 9 / 32) }) : Text({ dimColor: true, children: ['watch ad, get tokens: /attentionfarm ad'] }),
      Text({ dimColor: true, children: [adIsPlaying ? `ad · ${adSecondsLeft()}s` : 'the ad has ended.'] }),
    ] });
  });

  // The chat, frosted while the ad plays.
  on('ui.render', async ($, e, next) => {
    if (!adIsPlaying) return next(e);
    if (FROSTED_TEXT.has(e.component)) return next({ ...e, props: { ...e.props, text: frostText(e.props?.text) } });
    if (FROSTED_ROW.has(e.component)) {
      const { Text } = $.ui.resolve(e);
      return Text({ dimColor: true, children: ['░'.repeat(8 + (String(e.props?.tool ?? e.component).length % 9) * 3)] });
    }
    return next(e);
  });

  // What is sent during the ad waits for its end.
  on('prompt.submit', async ($, e, next) => {
    if (!adIsPlaying || !['composer', 'bridge'].includes(e.origin?.kind)) return next(e);
    adHeld += 1;
    if (AD_SECONDS - adFrame / AD_FPS <= HOLD_IN_PLACE_SECONDS) {
      await new Promise(resolve => {
        adReleases.add(resolve);
        next.signal?.addEventListener('abort', () => { adReleases.delete(resolve); resolve(); }, { once: true });
      });
      if (next.signal?.aborted) return { drop: 'not sent while the ad played; send it again.' };
      return next(e);
    }
    if (e.attachments?.length || e.context?.length) return { drop: `the ad ends in ${adSecondsLeft()}s. send it again then.` };
    adWaiting.push(e.text);
    $.ui.invalidate('ui.render');
    return { drop: `held until the ad ends (${adSecondsLeft()}s); it sends itself then.` };
  });

}


const USAGE = 'use /attentionfarm signup, login, account, logout, free or ad, or /attentionfarm ticker on, off, pause or resume.';

export function register(on) {
  // The ad's own hooks: its pane, the frosted chat, prompts waiting for its end, and a view left mid-ad.
  registerAd(on);

  on('session.start', async ($, e, next) => {
    const result = await next(e);
    await $.command.register({ name: 'attentionfarm', description: 'sign up, log in, your account, free tokens, watch ad to get tokens, and the scrolling status line ticker.' });
    interactive = e.isInteractive;
    await syncTicker($);
    // $.state outlives a reload; start every load from unknown so a stale answer is never trusted,
    // unless this load already asked: a terminal can draw the band before session.start runs.
    if (!restoring) await $.state.set(ACCOUNT, INITIAL_ACCOUNT);
    if (e.isInteractive && LOGIN_SURFACES.has(e.surface)) ensureRestore($);
    return result;
  });

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e);
    if (['clear', 'resume', 'fork'].includes(e.source)) {
      await syncTicker($);
      // A new session id: its free tokens start again, as /cost does.
      await $.state.set(TOKENS, NO_TOKENS);
    }
    return result;
  });

  // Free backup keeps the system prompt Claude Code composed, to send with each free step.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e);
    try { systemPrompt = result.sections.map(section => section.text).join('\n\n'); } catch {}
    return result;
  });

  // While free backup is on, the mod answers the step itself and Claude Code sends nothing; otherwise
  // every chunk passes through untouched. Main loop and subagents alike.
  on('turn.step', async function* ($, e, next) {
    let free = false;
    try { free = (await backupState($)).status === 'on'; } catch {}
    if (!free) return yield* next(e);
    return yield* answerStep($, e);
  });

  // A tool call the free model asked for never runs on an allow it did not earn: an allow becomes an
  // ask, a deny stays a deny. Claude's own calls keep the person's settings untouched.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e);
    if (!e.tool_use_id || !freeToolIds.has(e.tool_use_id) || verdict.decision === 'deny') return verdict;
    return { ...verdict, decision: 'ask', reason: COPY.freeToolAsk };
  }).catch(() => ({ decision: 'ask', reason: COPY.freeToolAsk }));

  // A limit stop offers free backup.
  on('classic.StopFailure', async ($, e, next) => {
    const result = await next(e);
    const backup = await backupState($);
    if (backup.status === 'off' && BACKUP_STOPS.has(e.error)) await offerBackup($);
    return result;
  });

  on('classic.Stop', async ($, e, next) => {
    const result = await next(e);
    const backup = await backupState($);
    if (backup.status === 'on') {
      if (backup.note) await setBackup($, defined({ ...backup, note: undefined }));
      await refreshBackup($).catch(() => {});
    }
    return result;
  });

  on('session.end', ($, e, next) => {
    endAdSession($);
    stopTicker();
    flow.resendTimer?.cancel();
    $.ui.status(undefined);
    return next(e);
  });

  // Command output is a transcript row the model reads: it never carries an email, code or token.
  on('command.run', { command: 'attentionfarm' }, async ($, e) => {
    const args = e.args.trim().toLowerCase().replace(/\s+/g, ' ');
    const ticker = /^ticker (on|off|pause|resume)$/.exec(args);
    if (ticker) {
      await setTicker($, ticker[1]);
      return { text: `attentionfarm ticker: ${ticker[1]}.` };
    }
    if (['signup', 'sign up', 'login', 'log in'].includes(args)) {
      return { text: (await openFlow($, args.startsWith('sign') ? 'signup' : 'login')) ? 'opened.' : COPY.unsupported };
    }
    if (args === 'account') return { text: (await openAccount($)) ? 'opened.' : COPY.unsupported };
    if (args === 'free' || args === 'backup') {
      if ((await backupState($)).status === 'on') return { text: 'free tokens are already on. use back to claude in the band to switch back.' };
      if (!(await usableAccount($))) return { text: COPY.unsupported };
      await switchToBackup($);
      const now = await backupState($);
      return { text: now.status === 'on' ? 'free tokens on. use back to claude in the band to switch back.' : 'free tokens could not start.' };
    }
    if (args === 'ad' || args === 'watch' || args === 'earn') {
      if (!(await usableAccount($))) return { text: COPY.unsupported };
      return (await watchAd($)) || { text: "watching ads for tokens isn't available right now." };
    }
    if (args === 'logout' || args === 'log out') {
      if (!(await usableAccount($))) return { text: COPY.unsupported };
      await logout($);
      return { text: 'logged out.' };
    }
    return { text: USAGE };
  });

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { value: pane = INITIAL_PANE } = await $.state.get(PANE);
    const { value: account = INITIAL_ACCOUNT } = await $.state.get(ACCOUNT);
    return renderFlow($, e, pane, account);
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const native = await next(e);
    if (e.props.hasSurvey) return native;
    const { Box } = $.ui.resolve(e);
    const { value: account = INITIAL_ACCOUNT } = await $.state.get(ACCOUNT);
    const backup = await backupState($);
    const { value: tokens = NO_TOKENS } = await $.state.get(TOKENS);
    const used = tokenTotal(tokens);
    const { value: pose = switchTarget(backup) } = await $.state.get(SWITCH);
    const { value: models = [] } = await $.state.get(FREE_MODELS);
    const { value: pickedId } = await $.state.get(FREE_MODEL);
    const free = { models, picked: models.find(model => model.id === pickedId) };
    const canBackup = LOGIN_SURFACES.has(e.surface);
    // While the ad plays the band is the ad's: the ad itself, or its countdown.
    if (adPlaying()) return Box({ flexDirection: 'column', children: [native, frame(Box, [renderAdBand($, e)], e.surface)] });
    const { value: earn = INITIAL_EARN } = await $.state.get(EARN);
    if (LOGIN_SURFACES.has(e.surface)) {
      lastSurface = e.surface;
      bandRequestId = e.requestId;
      if (account.status === 'unknown') ensureRestore($);
      const { value: pane = INITIAL_PANE } = await $.state.get(PANE);
      if (pane.site === 'band') {
        return Box({ flexDirection: 'column', children: [native, frame(Box, [renderFlow($, e, pane, account)], e.surface)] });
      }
    }
    return Box({ flexDirection: 'column', children: [native, renderBand($, e, account, backup, used, canBackup, pose, free, earn)] });
  });
}
