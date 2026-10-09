import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';

const API = 'https://api.attentionfarm.com/api/mod';
const TOKEN = `afm_${'A'.repeat(43)}`;
const EMAIL = 'you@example.com';
const MASKED = 'y•••@example.com';
const CODE = '482913';
const CHALLENGE = `mch_${'c'.repeat(24)}`;
const SURFACES = ['terminal', 'desktop'] as const;
const BAND = { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 80, scroll: { offset: 0, bodyRows: 8 }, view: {} } as const;
const PANE_PROPS = { title: 'attentionfarm', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 8 }, view: {} } as const;
const ALLOWED_KEYS: Record<string, string[]> = {
  '/auth/start': ['email', 'intent', 'updates'],
  '/auth/verify': ['challenge_id', 'code'],
  '/auth/logout': ['all'],
  '/account': ['confirm'],
  '/me': [],
};

type Reply = { status: number; body?: unknown } | 'offline';
type Sent = { path: string; method: string; headers: Record<string, string>; body?: Record<string, unknown> };

function world(on: On, options: { keychain?: { token: string; comment: string }; replies?: Record<string, Reply | Reply[]>; security?: boolean } = {}) {
  const clock = mock.clock(on, { now: 1_000_000 });
  mock.env(on, {});
  const sent: Sent[] = [];
  const toasts: string[] = [];
  const opened: string[] = [];
  const closed: string[] = [];
  const focused: { requestId: string; key?: string }[] = [];
  const runs: { argv: string[]; stdin?: string }[] = [];
  const written: unknown[] = [];
  on('state.set', ($, e, next) => { written.push(e); return next(e); });
  let keychain = options.keychain;
  const replies: Record<string, Reply | Reply[]> = {
    '/auth/start': { status: 202, body: { challenge_id: CHALLENGE, expires_at: '2026-10-09T12:10:00.000Z', resend_after_s: 60 } },
    '/auth/verify': { status: 200, body: { token: TOKEN, expires_at: '2027-01-07T12:00:00.000Z', account: { email: EMAIL, created: true } } },
    '/me': { status: 200, body: { account: { email: EMAIL, created_at: '2026-10-09T12:00:00.000Z' }, session: { expires_at: '2027-01-07T12:00:00.000Z' }, earning: 'coming_soon' } },
    '/auth/logout': { status: 200, body: { revoked: 1 } },
    '/account': { status: 200, body: { deleted: true } },
    ...options.replies,
  };
  on('session.start', () => ({ cwd: '/work' }));
  on('session.end', ($, e) => ({ sessionId: e.sessionId }));
  on('classic.SessionStart', () => ({}));
  on('command.register', ($, e) => ({ value: { command: e.name } }));
  on('ui.status', () => ({ value: undefined }));
  on('ui.toast', ($, e) => { toasts.push(e.text); return { value: undefined }; });
  on('ui.open', ($, e) => { opened.push(e.id); return { value: { isPlaced: true } }; });
  on('ui.close', ($, e) => { closed.push(e.id); return { value: undefined }; });
  on('ui.focus', ($, e) => { focused.push({ requestId: e.requestId, key: e.element }); return { value: {} }; });
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Text', props: {}, children: ['native content'] }));
  on('http.fetch', ($, e) => {
    const path = e.url.slice(API.length);
    expect(e.url.startsWith(API)).toBe(true);
    const body = e.init?.body ? JSON.parse(e.init.body) : undefined;
    sent.push({ path, method: e.init?.method ?? 'GET', headers: { ...e.init?.headers }, body });
    const queued = replies[path];
    const reply = Array.isArray(queued) ? queued.shift() ?? queued[0] : queued;
    if (!reply || reply === 'offline') return { deny: 'network down' };
    return { value: { status: reply.status, ok: reply.status < 300, headers: {}, text: JSON.stringify(reply.body ?? {}) } };
  });
  on('process.run', ($, e) => {
    const argv = [...e.argv];
    runs.push({ argv, stdin: e.init?.stdin });
    if (options.security === false) return { deny: 'cannot start' };
    if (argv[0] !== '/usr/bin/security') return { value: { exitCode: 0, stdout: '', stderr: '' } };
    if (argv[1] === '-i') {
      const match = /-j "([^"]*)" -w "([^"]*)"/.exec(e.init?.stdin ?? '');
      keychain = { comment: match![1], token: match![2] };
      return { value: { exitCode: 0, stdout: '', stderr: '' } };
    }
    if (argv[1] === 'delete-generic-password') { keychain = undefined; return { value: { exitCode: 0, stdout: '', stderr: '' } }; }
    if (!keychain) return { value: { exitCode: 44, stdout: '', stderr: 'not found' } };
    if (argv.includes('-w')) return { value: { exitCode: 0, stdout: `${keychain.token}\n`, stderr: '' } };
    const hex = [...new TextEncoder().encode(keychain.comment)].map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
    return { value: { exitCode: 0, stdout: `    "icmt"<blob>=0x${hex}  "escaped"\n`, stderr: '' } };
  });
  return { clock, sent, toasts, opened, closed, focused, runs, written, keychain: () => keychain };
}

async function start($: any, clock: { advance: (ms: number) => Promise<void> }, surface: 'terminal' | 'desktop' = 'terminal') {
  await $.session.start({ cwd: '/work', surface, isInteractive: true });
  await clock.advance(0);
}

const band = ($: any, surface: 'terminal' | 'desktop', requestId = `band-${surface}`) =>
  $.ui.mount({ plugin: 'attentionfarm', surface, component: 'AbovePrompt', requestId, props: BAND });
const pane = ($: any, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'attentionfarm', surface, component: 'Pane', requestId: 'attentionfarm-account', props: PANE_PROPS });

function stateHasNoSecrets(values: unknown[]) {
  const text = JSON.stringify(values);
  for (const secret of [TOKEN, EMAIL, CODE, CHALLENGE]) expect(text.includes(secret)).toBe(false);
}

for (const surface of SURFACES) {
  test(`logged out on ${surface}: three controls, and the band still yields to surveys`, async ($, on) => {
    const { clock } = world(on);
    await start($, clock, surface);
    const drawn = await band($, surface);
    expect(await drawn.find({ type: 'Button', text: 'powered by attentionfarm' })).toBeDefined();
    expect(await drawn.find({ type: 'Text', text: 'native content' })).toBeDefined();
    expect(Boolean(await drawn.find({ type: 'Button', key: 'attentionfarm-login', text: 'log in' }))).toBe(true);
    expect(Boolean(await drawn.find({ type: 'Button', key: 'attentionfarm-signup', text: 'sign up' }))).toBe(true);
    await drawn.unmount();
    const survey = await $.ui.mount({ plugin: 'attentionfarm', surface, component: 'AbovePrompt', requestId: `survey-${surface}`, props: { ...BAND, hasSurvey: true } });
    expect(await survey.find({ type: 'Button', key: 'attentionfarm-signup' })).toBeUndefined();
    expect(await survey.find({ type: 'Button', text: 'powered by attentionfarm' })).toBeUndefined();
    await survey.unmount();
  });
}

test('sign up: email, code (auto-submitted when six digits are pasted), keychain over stdin, warm toast', async ($, on) => {
  const { clock, sent, toasts, opened, runs, written, keychain } = world(on);
  await start($, clock);
  const view = await band($, 'terminal');
  await view.press({ key: 'attentionfarm-signup' });
  // The band holds the keyboard after its own press, so the flow is drawn right there.
  expect(opened).toEqual([]);
  expect((await view.find({ type: 'Input', key: 'attentionfarm-email' }))?.props.autoFocus).toBe(true);
  expect(await view.find({ type: 'Text', text: 'sign up for attentionfarm' })).toBeDefined();
  expect(await view.find({ type: 'Button', key: 'attentionfarm-close', text: 'close' })).toBeDefined();
  expect(await view.find({ type: 'Button', key: 'attentionfarm-signup' })).toBeUndefined();
  expect((await view.find({ type: 'Input', key: 'attentionfarm-email' }))?.props).toMatchObject({ autoFocus: true, submitLabel: 'send code', placeholder: 'you@example.com' });
  expect(await view.find({ type: 'Button', text: '[ ] also email me when earning launches' })).toBeDefined();
  await view.press({ key: 'attentionfarm-updates' });
  expect(await view.find({ type: 'Button', text: '[x] also email me when earning launches' })).toBeDefined();
  await view.input({ key: 'attentionfarm-email', text: '  You@Example.com ' });
  expect(sent[0]).toMatchObject({ path: '/auth/start', method: 'POST', body: { email: EMAIL, intent: 'signup', updates: true } });
  expect(await view.find({ type: 'Text', text: `check ${MASKED} for a 6-digit code` })).toBeDefined();
  expect((await view.find({ type: 'Input', key: 'attentionfarm-code' }))?.props.autoFocus).toBe(true);
  expect(await view.find({ type: 'Text', text: 'resend in a minute' })).toBeDefined();
  expect(await view.find({ type: 'Button', key: 'attentionfarm-resend' })).toBeUndefined();
  await clock.advance(60_000);
  expect(await view.find({ type: 'Button', key: 'attentionfarm-resend', text: 'resend code' })).toBeDefined();
  await view.input({ key: 'attentionfarm-code', text: '482', kind: 'change' });
  expect(sent).toHaveLength(1);
  await view.input({ key: 'attentionfarm-code', text: '482 - 913', kind: 'change' });
  expect(sent[1]).toMatchObject({ path: '/auth/verify', body: { challenge_id: CHALLENGE, code: CODE } });
  expect(keychain()).toEqual({ token: TOKEN, comment: MASKED });
  const write = runs.find(run => run.argv[1] === '-i')!;
  expect(write.argv).toEqual(['/usr/bin/security', '-i']);
  expect(write.stdin).toContain(TOKEN);
  for (const run of runs) expect(run.argv.join(' ').includes(TOKEN)).toBe(false);
  expect(toasts).toEqual([`you're in, ${MASKED}. we'll email you when earning opens.`]);
  expect(await view.find({ type: 'Text', text: `check ${MASKED} for a 6-digit code` })).toBeUndefined();
  for (const request of sent) {
    expect(request.headers['x-attentionfarm-mod']).toBe('0.2.1');
    expect(Object.keys(request.body ?? {}).every(key => ALLOWED_KEYS[request.path].includes(key))).toBe(true);
  }
  const after = view;
  expect(await after.find({ type: 'Button', key: 'attentionfarm-account', text: MASKED })).toBeDefined();
  expect(await after.find({ type: 'Button', key: 'attentionfarm-signup' })).toBeUndefined();
  expect(written.length > 0).toBe(true);
  for (const copy of [...toasts, JSON.stringify(await after.drawn())]) expect(/\$|balance|credits|earn now/.test(copy)).toBe(false);
  stateHasNoSecrets([written, toasts, await after.drawn()]);
});

test('log in: the same flow for an existing account, opt-in absent, welcome back', async ($, on) => {
  const { clock, sent, toasts, opened, closed } = world(on, { replies: { '/auth/verify': { status: 200, body: { token: TOKEN, account: { email: EMAIL, created: false } } } } });
  await start($, clock);
  const result = await $.command.run({ command: 'attentionfarm', args: 'login' });
  expect(result).toMatchObject({ text: 'opened.' });
  expect(opened).toEqual(['attentionfarm-account']);
  const view = await pane($);
  expect(await view.find({ type: 'Text', text: 'log in to attentionfarm' })).toBeDefined();
  expect(await view.find({ type: 'Button', key: 'attentionfarm-updates' })).toBeUndefined();
  await view.input({ key: 'attentionfarm-email', text: EMAIL });
  expect(sent[0].body).toEqual({ email: EMAIL, intent: 'login' });
  await view.input({ key: 'attentionfarm-code', text: CODE });
  expect(toasts).toEqual([`welcome back, ${MASKED}.`]);
  expect(closed).toEqual(['attentionfarm-account']);
});

test('every error is one line, and what was typed stays', async ($, on) => {
  const { clock, sent } = world(on, {
    replies: {
      '/auth/start': [
        'offline',
        { status: 429, body: { error: { code: 'rate_limited', message: 'too many codes for this email. try again in 12 minutes.', retry_after_s: 700 } } },
        { status: 503, body: { error: { code: 'login_unavailable' } } },
        { status: 502, body: { error: { code: 'email_failed' } } },
        { status: 404, body: {} },
        { status: 202, body: { challenge_id: CHALLENGE } },
      ],
      '/auth/verify': [
        { status: 400, body: { error: { code: 'invalid_code', attempts_left: 4 } } },
        { status: 400, body: { error: { code: 'invalid_code', attempts_left: 1 } } },
        { status: 429, body: { error: { code: 'locked' } } },
        { status: 410, body: { error: { code: 'expired' } } },
      ],
    },
  });
  await start($, clock);
  await $.command.run({ command: 'attentionfarm', args: 'signup' });
  const view = await pane($);
  const error = async (copy: string) => expect(await view.find({ type: 'Text', text: copy })).toBeDefined();
  await view.input({ key: 'attentionfarm-email', text: 'not-an-email' });
  await error('enter a valid email.');
  expect(sent).toHaveLength(0);
  expect((await view.find({ type: 'Input', key: 'attentionfarm-email' }))?.props.value).toBe('not-an-email');
  for (const copy of [
    "couldn't reach attentionfarm. check your connection and try again.",
    'too many codes for this email. try again in 12 minutes.',
    "login isn't available right now.",
    "we couldn't send the email. try again in a minute.",
    "login isn't available right now.",
  ]) {
    await view.input({ key: 'attentionfarm-email', text: EMAIL });
    await error(copy);
    expect((await view.find({ type: 'Input', key: 'attentionfarm-email' }))?.props.value).toBe(EMAIL);
  }
  await view.input({ key: 'attentionfarm-email', text: EMAIL });
  await view.input({ key: 'attentionfarm-code', text: '12345' });
  await error('enter the 6-digit code from the email.');
  await view.input({ key: 'attentionfarm-code', text: '111111' });
  await error("that code didn't match. 4 tries left.");
  expect((await view.find({ type: 'Input', key: 'attentionfarm-code' }))?.props.value).toBe('111111');
  await view.input({ key: 'attentionfarm-code', text: '222222' });
  await error("that code didn't match. 1 try left.");
  await view.input({ key: 'attentionfarm-code', text: '333333' });
  await error('too many tries. send a new code.');
  expect(await view.find({ type: 'Button', key: 'attentionfarm-resend' })).toBeDefined();
  await view.input({ key: 'attentionfarm-code', text: '444444' });
  await error('that code expired. send a new one.');
  await view.press({ key: 'attentionfarm-change-email' });
  expect((await view.find({ type: 'Input', key: 'attentionfarm-email' }))?.props.value).toBe(EMAIL);
});

test('resend sends the same email again and says so', async ($, on) => {
  const { clock, sent } = world(on);
  await start($, clock);
  await $.command.run({ command: 'attentionfarm', args: 'signup' });
  const view = await pane($);
  await view.input({ key: 'attentionfarm-email', text: EMAIL });
  await clock.advance(60_000);
  await view.press({ key: 'attentionfarm-resend' });
  expect(sent.map(request => request.body)).toEqual([{ email: EMAIL, intent: 'signup', updates: false }, { email: EMAIL, intent: 'signup', updates: false }]);
  expect(await view.find({ type: 'Text', text: 'sent a new code.' })).toBeDefined();
  expect(await view.find({ type: 'Button', key: 'attentionfarm-resend' })).toBeUndefined();
});

test('session start: restores from the keychain and confirms the session with the server', async ($, on) => {
  const live = world(on, { keychain: { token: TOKEN, comment: MASKED } });
  await start($, live.clock);
  expect(live.sent).toEqual([{ path: '/me', method: 'GET', headers: { 'x-attentionfarm-mod': '0.2.1', authorization: `Bearer ${TOKEN}` }, body: undefined }]);
  expect(await (await band($, 'terminal', 'live')).find({ type: 'Button', key: 'attentionfarm-account', text: MASKED })).toBeDefined();
});

test('session start: a 401 deletes the keychain item', async ($, on) => {
  const dead = world(on, { keychain: { token: TOKEN, comment: MASKED }, replies: { '/me': { status: 401, body: { error: { code: 'unauthorized' } } } } });
  await start($, dead.clock);
  expect(dead.keychain()).toBeUndefined();
  expect(dead.toasts).toEqual(['your attentionfarm session ended. log in again.']);
  expect(await (await band($, 'terminal', 'dead')).find({ type: 'Button', key: 'attentionfarm-login' })).toBeDefined();
});

test('session start: offline keeps the session and says so', async ($, on) => {
  const away = world(on, { keychain: { token: TOKEN, comment: MASKED }, replies: { '/me': 'offline' } });
  await start($, away.clock);
  expect(away.keychain()).toBeDefined();
  expect(await (await band($, 'terminal', 'away')).find({ type: 'Button', text: `${MASKED} (offline)` })).toBeDefined();
});

test('account pane: log out, log out everywhere, and delete', async ($, on) => {
  const { clock, sent, toasts, keychain } = world(on, { keychain: { token: TOKEN, comment: MASKED } });
  await start($, clock);
  const view = await band($, 'terminal');
  await view.press({ key: 'attentionfarm-account' });
  expect(await view.find({ type: 'Text', text: `logged in as ${MASKED}` })).toBeDefined();
  expect(await view.find({ type: 'Text', text: 'earning is coming soon. nothing to collect yet.' })).toBeDefined();
  await view.press({ key: 'attentionfarm-delete-account' });
  await view.input({ key: 'attentionfarm-delete', text: 'yes' });
  expect(await view.find({ type: 'Text', text: 'type delete to confirm.' })).toBeDefined();
  await view.input({ key: 'attentionfarm-delete', text: 'delete' });
  expect(sent.at(-1)).toMatchObject({ path: '/account', method: 'DELETE', body: { confirm: 'delete' } });
  expect(keychain()).toBeUndefined();
  expect(toasts.at(-1)).toBe('your attentionfarm account is deleted.');
  expect(await view.find({ type: 'Button', key: 'attentionfarm-signup' })).toBeDefined();
});

test('log out everywhere still logs out here when the server is unreachable', async ($, on) => {
  const second = world(on, { keychain: { token: TOKEN, comment: MASKED }, replies: { '/auth/logout': 'offline' } });
  await start($, second.clock);
  expect(await $.command.run({ command: 'attentionfarm', args: 'account' })).toMatchObject({ text: 'opened.' });
  const view = await pane($);
  await view.press({ key: 'attentionfarm-logout-all' });
  expect(second.sent.at(-1)).toMatchObject({ path: '/auth/logout', body: { all: true } });
  expect(second.keychain()).toBeUndefined();
  expect(second.toasts.at(-1)).toBe("logged out here. couldn't reach attentionfarm to end your other devices.");
});

test('log out ends this session on the server', async ($, on) => {
  const { clock, sent, toasts, keychain } = world(on, { keychain: { token: TOKEN, comment: MASKED } });
  await start($, clock);
  await $.command.run({ command: 'attentionfarm', args: 'account' });
  await (await pane($)).press({ key: 'attentionfarm-logout' });
  expect(sent.at(-1)).toMatchObject({ path: '/auth/logout', method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: undefined });
  expect(keychain()).toBeUndefined();
  expect(toasts.at(-1)).toBe('logged out of attentionfarm.');
  expect(await (await band($, 'terminal', 'after-logout')).find({ type: 'Button', key: 'attentionfarm-signup' })).toBeDefined();
});

test('logout command works offline and never prints the email, code or token', async ($, on) => {
  const { clock, sent, keychain } = world(on, { keychain: { token: TOKEN, comment: MASKED }, replies: { '/auth/logout': 'offline' } });
  await start($, clock);
  const result = await $.command.run({ command: 'attentionfarm', args: 'logout' });
  expect(result).toMatchObject({ text: 'logged out.' });
  expect(sent.at(-1)).toMatchObject({ path: '/auth/logout', body: undefined });
  expect(keychain()).toBeUndefined();
  stateHasNoSecrets([result]);
});

test('desktop: the band restores the session, offers sign up, and the command opens the flow', async ($, on) => {
  const desktop = world(on);
  // The desktop app's session starts through the sdk: no surface and no person at session.start.
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false });
  await desktop.clock.advance(0);
  const drawn = await band($, 'desktop');
  await desktop.clock.advance(0);
  expect(await drawn.find({ type: 'Button', key: 'attentionfarm-signup', text: 'sign up' })).toBeDefined();
  await drawn.press({ key: 'attentionfarm-signup' });
  expect(await drawn.find({ type: 'Input', key: 'attentionfarm-email' })).toBeDefined();
  await drawn.unmount();
  expect(await $.command.run({ command: 'attentionfarm', args: 'login' })).toMatchObject({ text: 'opened.' });
  expect(desktop.sent).toEqual([]);
});

test('a terminal without the security tool shows the label only', async ($, on) => {
  const bare = world(on, { security: false });
  await start($, bare.clock);
  const drawn = await band($, 'terminal', 'bare');
  expect(await drawn.find({ type: 'Button', key: 'attentionfarm-login' })).toBeUndefined();
  expect(await $.command.run({ command: 'attentionfarm', args: 'signup' })).toMatchObject({ text: 'login works in claude code on macos for now.' });
});
