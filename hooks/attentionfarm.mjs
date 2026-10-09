const TICKER_STATE = { plugin: 'attentionfarm', key: 'ticker' };
const TICKER_OFFSET = { plugin: 'attentionfarm', key: 'tickerOffset' };
const ACCOUNT = { plugin: 'attentionfarm', key: 'account' };
const PANE = { plugin: 'attentionfarm', key: 'pane' };
const TICKER_COPY = 'watch ad, get tokens | attentionfarm | ';
const TICKER_WIDTH = 60;
const INITIAL_TICKER = { enabled: true, paused: false };

const MOD_VERSION = '0.2.0';
const PANE_ID = 'attentionfarm-account';
const PRODUCTION_API = 'https://api.attentionfarm.com/api/mod';
const PRODUCTION_SERVICE = 'attentionfarm-mod';
const DEV_SERVICE = 'attentionfarm-mod-dev';
const SECURITY = '/usr/bin/security';
const KEYCHAIN_ACCOUNT = 'session';
const REQUEST_TIMEOUT_MS = 10000;
const RESEND_AFTER_MS = 60000;
const CODE_LIFETIME_MS = 10 * 60 * 1000;
const TOKEN_PATTERN = /^afm_[A-Za-z0-9_-]{43}$/;
const MASKED_PATTERN = /^[a-z0-9]?•••@[a-z0-9.-]+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INITIAL_ACCOUNT = { status: 'unknown' };
// `site` is where the flow is drawn: a pane opened by a command, or the band itself after one of
// its buttons is pressed (the band then holds the keyboard, so a pane could not take it).
const INITIAL_PANE = { site: 'none', step: 'email', intent: 'signup', updates: false, busy: false, canResend: false };

const COPY = {
  unsupported: 'login works in the claude code terminal on macos for now.',
  network: "couldn't reach attentionfarm. check your connection and try again.",
  unavailable: "login isn't available right now.",
  invalidEmail: 'enter a valid email.',
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
    await $.state.set(PANE, { ...INITIAL_PANE, intent });
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
  const { value: pane = INITIAL_PANE } = await $.state.get(PANE);
  const gen = flow.gen;
  flow.busy = true;
  await setPane($, { busy: true, error: undefined, note: undefined });
  const body = pane.intent === 'signup' ? { email, intent: 'signup', updates: pane.updates === true } : { email, intent: 'login' };
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
  const { value: pane = INITIAL_PANE } = await $.state.get(PANE);
  const created = result.data.account.created === true;
  resetFlow();
  flow.typedEmail = '';
  await $.state.set(ACCOUNT, { status: 'in', masked });
  await $.state.set(PANE, { ...INITIAL_PANE });
  await $.ui.close({ id: PANE_ID }).catch(() => {});
  $.ui.toast(!created ? `welcome back, ${masked}.`
    : pane.updates ? `you're in, ${masked}. we'll email you when earning opens.`
    : `you're in, ${masked}. earning is coming soon.`);
}

async function signedOut($, toast) {
  const { service } = await target($);
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

function renderFlow($, e, pane, account) {
  const { Box, Text, Button, Input } = $.ui.resolve(e);
  const lines = [];
  // In the band there is no pane frame to close, so the heading carries its own close.
  const heading = value => e.component !== 'AbovePrompt' ? line(Text, value, { bold: true }) : Box({ flexDirection: 'row', gap: 3, children: [
    line(Text, value, { bold: true }),
    Button({ key: 'attentionfarm-close', plain: true, dimColor: true, label: 'close', onPress: () => closeFlow($) }),
  ] });
  const status = pane.busy ? line(Text, pane.step === 'code' ? 'checking...' : pane.step === 'email' ? 'sending your code...' : 'one moment...', { dimColor: true })
    : pane.error ? line(Text, pane.error)
    : pane.note ? line(Text, pane.note, { dimColor: true })
    : undefined;
  if (pane.step === 'email') {
    const signup = pane.intent === 'signup';
    lines.push(heading(signup ? 'sign up for attentionfarm' : 'log in to attentionfarm'));
    lines.push(line(Text, "we'll email you a 6-digit code. no password.", { dimColor: true }));
    lines.push(Input({
      key: 'attentionfarm-email', label: 'email', placeholder: 'you@example.com', value: flow.typedEmail, submitLabel: 'send code', autoFocus: true,
      onInput: value => { flow.typedEmail = value; },
      onSubmit: value => sendCode($, value),
    }));
    if (status) lines.push(status);
    if (signup) {
      lines.push(Button({
        key: 'attentionfarm-updates', plain: true, label: `${pane.updates ? '[x]' : '[ ]'} also email me when earning launches`,
        onPress: () => setPane($, { updates: !pane.updates }),
      }));
      lines.push(line(Text, "earning isn't live yet. your account will be ready when it is.", { dimColor: true }));
    }
    lines.push(line(Text, 'privacy: attentionfarm.com/privacy', { dimColor: true }));
  } else if (pane.step === 'code') {
    lines.push(heading(`check ${pane.sentTo || 'your inbox'} for a 6-digit code`));
    lines.push(Input({
      key: 'attentionfarm-code', label: 'code', placeholder: '6 digits', value: flow.typedCode, submitLabel: 'verify', autoFocus: true,
      onInput: value => {
        flow.typedCode = value;
        const digits = value.replace(/[\s-]/g, '');
        if (/^\d{6}$/.test(digits)) return verifyCode($, digits);
      },
      onSubmit: value => { flow.typedCode = value; return verifyCode($, value); },
    }));
    if (status) lines.push(status);
    if (flow.devCode) lines.push(line(Text, `local dev code: ${flow.devCode}`, { dimColor: true }));
    lines.push(Box({ flexDirection: 'row', gap: 3, children: [
      pane.canResend
        ? Button({ key: 'attentionfarm-resend', plain: true, label: 'resend code', onPress: () => sendCode($, '', { resend: true }) })
        : line(Text, 'resend in a minute', { dimColor: true }),
      Button({ key: 'attentionfarm-change-email', plain: true, label: 'use a different email', onPress: () => useDifferentEmail($) }),
    ] }));
  } else if (pane.step === 'delete') {
    lines.push(heading('type delete to remove your account and email from attentionfarm.'));
    lines.push(Input({ key: 'attentionfarm-delete', submitLabel: 'delete', autoFocus: true, onSubmit: value => deleteAccount($, value) }));
    if (status) lines.push(status);
    lines.push(Button({ key: 'attentionfarm-cancel', plain: true, label: 'cancel', onPress: () => setPane($, { step: 'account', error: undefined }) }));
  } else {
    lines.push(heading('attentionfarm account'));
    lines.push(line(Text, `logged in as ${account.masked || 'your account'}${account.status === 'offline' ? ' (offline)' : ''}`));
    lines.push(line(Text, 'earning is coming soon. nothing to collect yet.', { dimColor: true }));
    if (status) lines.push(status);
    lines.push(Box({ flexDirection: 'row', gap: 3, children: [
      Button({ key: 'attentionfarm-logout', plain: true, label: 'log out', onPress: () => logout($) }),
      Button({ key: 'attentionfarm-logout-all', plain: true, label: 'log out everywhere', onPress: () => logout($, { all: true }) }),
      Button({ key: 'attentionfarm-delete-account', plain: true, dimColor: true, label: 'delete account', onPress: async () => { await setPane($, { step: 'delete', error: undefined }); await focus($, 'attentionfarm-delete'); } }),
    ] }));
  }
  return Box({ flexDirection: 'column', children: lines });
}

const USAGE = 'use /attentionfarm signup, login, account or logout, or /attentionfarm ticker on, off, pause or resume.';

export function register(on) {
  on('session.start', async ($, e, next) => {
    const result = await next(e);
    await $.command.register({ name: 'attentionfarm', description: 'sign up, log in, your account, and the scrolling status line ticker.' });
    interactive = e.isInteractive;
    await syncTicker($);
    if (e.isInteractive && e.surface === 'terminal') {
      $.clock.after(0, () => restore($));
    } else {
      await $.state.set(ACCOUNT, { status: 'unsupported' });
    }
    return result;
  });

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e);
    if (['clear', 'resume', 'fork'].includes(e.source)) await syncTicker($);
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
    const { Box, Button } = $.ui.resolve(e);
    if (e.surface === 'terminal') {
      bandRequestId = e.requestId;
      const { value: pane = INITIAL_PANE } = await $.state.get(PANE);
      if (pane.site === 'band') {
        const { value: account = INITIAL_ACCOUNT } = await $.state.get(ACCOUNT);
        return Box({ flexDirection: 'column', children: [native, renderFlow($, e, pane, account)] });
      }
    }
    const label = Button({
      key: 'attentionfarm-website',
      plain: true,
      label: 'powered by attentionfarm',
      onPress: async () => {
        try {
          const result = await $.process.run(['open', 'https://attentionfarm.com/?utm_source=mod&utm_campaign=mod-waitlist-v0']);
          if (result.exitCode !== 0) throw new Error('open-failed');
        } catch {
          $.ui.toast('could not open attentionfarm in your browser.');
        }
      },
    });
    const controls = [label];
    if (e.surface === 'terminal') {
      const { value: account = INITIAL_ACCOUNT } = await $.state.get(ACCOUNT);
      if (account.status === 'out') {
        controls.push(Button({ key: 'attentionfarm-login', plain: true, label: 'log in', onPress: () => openFlow($, 'login', 'band') }));
        controls.push(Button({ key: 'attentionfarm-signup', plain: true, label: 'sign up', onPress: () => openFlow($, 'signup', 'band') }));
      } else if (account.status === 'in' || account.status === 'offline') {
        controls.push(Button({
          key: 'attentionfarm-account', plain: true, dimColor: true,
          label: `${account.masked || 'your account'}${account.status === 'offline' ? ' (offline)' : ''}`,
          onPress: () => openAccount($, 'band'),
        }));
      }
    }
    return Box({
      flexDirection: 'column',
      children: [native, controls.length === 1 ? label : Box({ flexDirection: 'row', gap: 3, children: controls })],
    });
  });
}
