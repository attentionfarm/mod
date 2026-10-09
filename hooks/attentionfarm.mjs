import { update } from 'claude-code';

const TICKER_STATE = { plugin: 'attentionfarm', key: 'ticker' };
const TICKER_OFFSET = { plugin: 'attentionfarm', key: 'tickerOffset' };
const ACCOUNT = { plugin: 'attentionfarm', key: 'account' };
const PANE = { plugin: 'attentionfarm', key: 'pane' };
const BACKUP = { plugin: 'attentionfarm', key: 'backup' };
// Free tokens this Claude Code session used through attentionfarm, counted here from each model
// request's own usage. Its own key, so switching back to claude keeps it.
const TOKENS = { plugin: 'attentionfarm', key: 'backupTokens' };
const NO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, steps: 0 };
const TICKER_COPY = 'watch ad, get tokens | attentionfarm | ';
const TICKER_WIDTH = 60;
const INITIAL_TICKER = { enabled: true, paused: false };

const MOD_VERSION = '0.3.0';
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
const PRIVACY_URL = 'https://attentionfarm.com/privacy';
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
  backupTerminalOnly: 'free backup works in claude code in a terminal for now.',
  backupOwnKey: 'free backup is off while claude code uses your own api key or gateway.',
  backupUnavailable: "free backup isn't available right now.",
  backupBusy: "the free model is busy, or today's free backup is used up.",
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
let terminalSession = false;
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

async function logout($, { all = false } = {}) {
  const { service } = await target($);
  let reached = true;
  const token = await keychainToken($, service).catch(() => undefined);
  if (token) {
    const result = await request($, 'POST', '/auth/logout', all ? { token, body: { all: true } } : { token });
    reached = result.status === 200 || result.status === 401;
  }
  // Local logout happens even when the server cannot be reached.
  await signedOut($, !all ? 'logged out of attentionfarm.'
    : reached ? 'logged out on every device.'
    : "logged out here. couldn't reach attentionfarm to end your other devices.");
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

// Claude Code sends ANTHROPIC_AUTH_TOKEN in place of the person's own login only when nothing else
// owns that login. Where a host (the desktop app, a remote session, a cloud provider) or the person's
// own key or gateway does, moving the address would send their credential to attentionfarm, so the
// switch is never offered there.
async function backupBlocked($) {
  if (!terminalSession) return COPY.backupTerminalOnly;
  const hosted = [
    await $.env.get('CLAUDE_CODE_SIMPLE'),
    await $.env.get('CLAUDE_CODE_REMOTE'),
    await $.env.get('CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST'),
    await $.env.get('CLAUDE_CODE_USE_BEDROCK'),
    await $.env.get('CLAUDE_CODE_USE_VERTEX'),
    await $.env.get('CLAUDE_CODE_USE_FOUNDRY'),
  ];
  if (hosted.some(value => value && !/^(?:0|false|no|off)$/i.test(value))) return COPY.backupTerminalOnly;
  const entry = await $.env.get('CLAUDE_CODE_ENTRYPOINT');
  if (entry && entry !== 'cli') return COPY.backupTerminalOnly;
  const own = [await $.env.get('ANTHROPIC_BASE_URL'), await $.env.get('ANTHROPIC_AUTH_TOKEN'), await $.env.get('ANTHROPIC_API_KEY')];
  if (own.some(Boolean)) return COPY.backupOwnKey;
  const settings = await $.settings.read().catch(() => ({}));
  if (settings.apiKeyHelper) return COPY.backupOwnKey;
  return undefined;
}

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

async function switchToBackup($) {
  if (switching) return;
  const blocked = await backupBlocked($);
  if (blocked) {
    await $.state.set(BACKUP, { status: 'offer', note: blocked });
    return;
  }
  const { service, api } = await target($);
  const token = await keychainToken($, service).catch(() => undefined);
  if (!token) {
    await openFlow($, 'signup', 'band');
    return;
  }
  switching = true;
  await $.state.set(BACKUP, { status: 'switching' });
  try {
    const result = await request($, 'POST', '/backup/key', { token });
    if (result.status === 401) {
      await signedOut($, COPY.sessionEnded);
      return;
    }
    const key = result.data?.key;
    if (result.status !== 200 || !BACKUP_KEY_PATTERN.test(key || '')) {
      await $.state.set(BACKUP, { status: 'offer', note: result.status === 503 ? COPY.backupUnavailable : errorCopy(result) });
      return;
    }
    const betasWereOff = Boolean(await $.env.get('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'));
    await $.env.set('ANTHROPIC_BASE_URL', `${api}/backup`);
    await $.env.set('ANTHROPIC_AUTH_TOKEN', key);
    if (!betasWereOff) await $.env.set('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS', '1');
    const label = typeof result.data?.model?.label === 'string' ? result.data.model.label.toLowerCase().slice(0, 40) : 'a free model';
    const remaining = Number.isInteger(result.data?.remaining_today) ? result.data.remaining_today : undefined;
    await $.state.set(BACKUP, defined({ status: 'on', label, remaining, ownsBetas: !betasWereOff }));
    await $.prompt.submit({ text: 'continue where you left off.' }).catch(() => {});
  } finally {
    switching = false;
  }
}

// Puts back only what the switch set, so a value the person set since is left alone.
async function switchBack($) {
  const backup = await backupState($);
  if (backup.status === 'on' || backup.status === 'switching') {
    const { api } = await target($);
    if ((await $.env.get('ANTHROPIC_BASE_URL')) === `${api}/backup`) {
      await $.env.set('ANTHROPIC_BASE_URL', undefined);
      if (BACKUP_KEY_PATTERN.test((await $.env.get('ANTHROPIC_AUTH_TOKEN')) || '')) await $.env.set('ANTHROPIC_AUTH_TOKEN', undefined);
      if (backup.ownsBetas) await $.env.set('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS', undefined);
    }
  }
  await $.state.set(BACKUP, INITIAL_BACKUP);
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
    if (current.status === 'on') await $.state.set(BACKUP, { ...current, remaining: result.data.remaining_today });
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

function wordmark(Text) {
  return Text({ bold: true, backgroundColor: TIDE, color: TIDE_INK, children: [' attentionfarm '] });
}

// Every attentionfarm band wears a tide outline. The desktop app draws its own padded card around
// the band, so there the outline is pulled out over that padding to sit at the card's edge.
function frame(Box, children, surface) {
  const pull = surface === 'terminal' ? {} : { margin: -1 };
  return Box({ flexDirection: 'column', borderStyle: 'round', borderColor: TIDE, paddingX: 1, ...pull, children });
}

function openPrivacy($) {
  return $.process.run(['open', PRIVACY_URL]).then(result => {
    if (result.exitCode !== 0) throw new Error('open-failed');
  }).catch(() => $.ui.toast('could not open attentionfarm.com/privacy in your browser.'));
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
      Button({ key: 'attentionfarm-logout-all', plain: true, dimColor: true, label: 'log out everywhere', onPress: () => logout($, { all: true }) }),
      Box({ flexGrow: 1 }),
      Button({ key: 'attentionfarm-delete-account', plain: true, dimColor: true, label: 'delete account', onPress: async () => { await setPane($, { step: 'delete', error: undefined }); await focus($, 'attentionfarm-delete'); } }),
    ]));
  }
  // On desktop a row of breathing room between rows; in a terminal one cell is a whole blank line.
  return Box({ flexDirection: 'column', rowGap: e.surface === 'terminal' ? 0 : 1, children: lines });
}

// Free backup in the band: the offer after a limit stop, then which model is answering and the way back.
function backupRows($, Box, Text, Button, account, backup, used) {
  if (backup.status === 'switching') return [line(Text, 'switching to free backup…', { dimColor: true })];
  if (backup.status === 'on') {
    const spent = ` · ${formatTokens(used)} tokens this session`;
    const left = Number.isInteger(backup.remaining) ? ` · ${backup.remaining} requests left today` : '';
    return [
      Box({ flexDirection: 'row', alignItems: 'center', columnGap: 1, children: [
        line(Text, 'free backup', { bold: true }),
        line(Text, `${backup.label || 'a free model'}${spent}${left}`, { dimColor: true, wrap: 'truncate-end' }),
        Box({ flexGrow: 1 }),
        Button({ key: 'attentionfarm-backup-off', plain: true, label: 'back to claude', onPress: () => switchBack($) }),
      ] }),
      ...(backup.note ? [line(Text, backup.note, { dimColor: true, wrap: 'truncate-end' })] : []),
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
      Button({ key: 'attentionfarm-backup-dismiss', plain: true, dimColor: true, label: 'not now', onPress: () => $.state.set(BACKUP, INITIAL_BACKUP) }),
      Box({ flexGrow: 1 }),
      Button({ key: 'attentionfarm-backup-privacy', plain: true, dimColor: true, label: "what's shared", onPress: () => openPrivacy($) }),
    ]),
    line(Text, backup.note || "free models' hosts may learn from what they receive.", { dimColor: true, wrap: 'truncate-end' }),
  ];
}

// The resting band: two lines, the wordmark and one action, then the honest line.
function renderBand($, e, account, backup = INITIAL_BACKUP, used = 0) {
  const { Box, Text, Button } = $.ui.resolve(e);
  const canLogin = LOGIN_SURFACES.has(e.surface) && account.status !== 'unsupported';
  const top = [wordmark(Text), Box({ flexGrow: 1 })];
  let second;
  if (account.status === 'in' || account.status === 'offline') {
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
      : line(Text, 'watch an ad, get tokens for claude code.', { dimColor: true, wrap: 'truncate-end' });
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
  // After backup, the session's free tokens stay in view at the end of the band's second line.
  if (used > 0) {
    second = Box({ flexDirection: 'row', alignItems: 'center', columnGap: 2, children: [
      Box({ flexShrink: 1, children: [second] }),
      Box({ flexGrow: 1 }),
      line(Text, `${formatTokens(used)} free tokens this session`, { dimColor: true }),
    ] });
  }
  const rows = backupRows($, Box, Text, Button, account, backup, used) || [second];
  return frame(Box, [Box({ flexDirection: 'row', alignItems: 'center', columnGap: 2, children: top }), ...rows], e.surface);
}

const USAGE = 'use /attentionfarm signup, login, account or logout, or /attentionfarm ticker on, off, pause or resume.';

export function register(on) {
  on('session.start', async ($, e, next) => {
    const result = await next(e);
    await $.command.register({ name: 'attentionfarm', description: 'sign up, log in, your account, and the scrolling status line ticker.' });
    interactive = e.isInteractive;
    terminalSession = e.isInteractive === true && e.surface === 'terminal';
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

  // Counts each model request answered while free backup was on when it started, main loop and
  // subagents alike, from the usage the response itself reported. A step Claude answered (the switch
  // did not take) is not free and is not counted. Chunks pass through untouched.
  on('turn.step', async function* ($, e, next) {
    let counting = false;
    try { counting = (await backupState($)).status === 'on'; } catch {}
    const result = yield* next(e);
    const usage = result?.usage;
    if (counting && usage && !/^claude-/i.test(usage.model || '')) {
      try { await update($, TOKENS, tokens => addUsage(tokens, usage)); } catch {}
    }
    return result;
  });

  // A limit stop offers free backup; a failure while on backup says the free model is busy or used up.
  on('classic.StopFailure', async ($, e, next) => {
    const result = await next(e);
    const backup = await backupState($);
    if (backup.status === 'on') await $.state.set(BACKUP, { ...backup, note: COPY.backupBusy });
    else if (BACKUP_STOPS.has(e.error) && !(await backupBlocked($))) await $.state.set(BACKUP, { status: 'offer' });
    return result;
  });

  on('classic.Stop', async ($, e, next) => {
    const result = await next(e);
    const backup = await backupState($);
    if (backup.status === 'on') {
      if (backup.note) await $.state.set(BACKUP, defined({ ...backup, note: undefined }));
      await refreshBackup($).catch(() => {});
    }
    return result;
  });

  on('session.end', ($, e, next) => {
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
    // Local testing only: shows the backup offer without waiting for a real limit stop.
    if (args === 'backup' && (await target($)).dev) {
      const blocked = await backupBlocked($);
      if (blocked) return { text: blocked };
      await $.state.set(BACKUP, { status: 'offer' });
      return { text: 'free backup offered (local worker only).' };
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
    if (LOGIN_SURFACES.has(e.surface)) {
      bandRequestId = e.requestId;
      if (account.status === 'unknown') ensureRestore($);
      const { value: pane = INITIAL_PANE } = await $.state.get(PANE);
      if (pane.site === 'band') {
        return Box({ flexDirection: 'column', children: [native, frame(Box, [renderFlow($, e, pane, account)], e.surface)] });
      }
    }
    return Box({ flexDirection: 'column', children: [native, renderBand($, e, account, backup, used)] });
  });
}
