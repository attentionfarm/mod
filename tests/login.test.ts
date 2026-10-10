import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';
import { TOOL_SCHEMAS } from '../hooks/tool-schemas.mjs';

const API = 'https://api.attentionfarm.com/api/mod';
const TOKEN = `afm_${'A'.repeat(43)}`;
const EMAIL = 'you@example.com';
const MASKED = 'y•••@example.com';
const CODE = '482913';
const CHALLENGE = `mch_${'c'.repeat(24)}`;
const BACKUP_KEY = `afb_${'B'.repeat(43)}`;
const CONVERSATION = [{ role: 'user', content: [{ type: 'text', text: 'list the files' }] }];
const FREE_USAGE = { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 };
const FREE_REPLY = { id: 'gen-1', type: 'message', role: 'assistant', model: 'nvidia/nemotron-3-ultra-550b-a55b:free', content: [{ type: 'thinking', thinking: 'let me look' }, { type: 'text', text: 'here they are' }], stop_reason: 'end_turn', usage: FREE_USAGE };
const FREE_TOOL_REPLY = { ...FREE_REPLY, content: [{ type: 'tool_use', id: 'toolu_free_1', name: 'Bash', input: { command: 'ls', description: 'list files' } }], stop_reason: 'tool_use' };
const SURFACES = ['terminal', 'desktop'] as const;
const ROSTER = [
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'nemotron 3 ultra' },
  { id: 'cohere/north-mini-code:free', label: 'north mini code' },
  { id: 'poolside/laguna-s-2.1:free', label: 'laguna s 2.1' },
];
const LISTED = {
  '/backup/status': { status: 200, body: { available: true, model: ROSTER[0], models: ROSTER, daily_requests: 100, remaining_today: 87 } },
  '/backup/key': { status: 200, body: { key: BACKUP_KEY, base_path: '/api/mod/backup', model: ROSTER[0], models: ROSTER, daily_requests: 100, remaining_today: 100 } },
} as const;
const BAND = { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 80, scroll: { offset: 0, bodyRows: 8 }, view: {} } as const;
const PANE_PROPS = { title: 'attentionfarm', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 8 }, view: {} } as const;
const ALLOWED_KEYS: Record<string, string[]> = {
  '/auth/start': ['email', 'intent'],
  '/auth/verify': ['challenge_id', 'code'],
  '/auth/logout': ['all'],
  '/account': ['confirm'],
  '/me': [],
  '/backup/key': [],
  '/backup/v1/messages': ['model', 'max_tokens', 'system', 'messages', 'tools', 'stream'],
  '/backup/status': [],
};

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | 'offline';
type Sent = { path: string; method: string; headers: Record<string, string>; body?: Record<string, unknown> };

function world(on: On, options: { keychain?: { token: string; comment: string }; replies?: Record<string, Reply | Reply[]>; security?: boolean; toolCheck?: Record<string, unknown>; store?: Record<string, unknown> } = {}) {
  const clock = mock.clock(on, { now: 1_000_000 });
  mock.env(on, {});
  // The plugin's store between sessions, answered from memory so a test can read what was kept.
  const stored: Record<string, unknown> = { ...options.store };
  on('store.get', ($, e: any) => ({ value: stored[e.key] }) as any);
  on('store.set', ($, e: any) => { stored[e.key] = e.value; return { value: undefined } as any; });
  const submitted: string[] = [];
  on('prompt.submit', ($, e) => { submitted.push(e.text); return { text: e.text, context: [] } as any; });
  on('classic.StopFailure', () => ({}));
  on('classic.Stop', () => ({}));
  // Claude's own model beneath every step: counts the requests the engine would have sent.
  const engine = { steps: 0 };
  on('turn.step', async function* ($: any, e: any) {
    engine.steps += 1;
    yield { kind: 'text', index: 0, text: 'claude answered' };
    return { turnId: e.turnId, index: e.index, answer: 'claude answered', toolUses: [], stopReason: 'end_turn', usage: null };
  } as any);
  // What a free step reads: the conversation, the system prompt and the tools.
  on('session.messages', () => ({ value: CONVERSATION }) as any);
  on('tool.list', () => ({ value: [{ name: 'Bash', description: 'runs a command', mcp: false }, { name: 'mcp__docs__search', description: 'searches docs', mcp: true }] }) as any);
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'SYSTEM PROMPT', scope: 'shared' }] }) as any);
  on('tool.check', () => (options.toolCheck ?? { decision: 'allow' }) as any);
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
    '/backup/key': { status: 200, body: { key: BACKUP_KEY, base_path: '/api/mod/backup', model: { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'nemotron 3 ultra' }, daily_requests: 100, remaining_today: 100 } },
    '/backup/v1/messages': { status: 200, body: FREE_REPLY },
    '/backup/status': { status: 200, body: { available: true, model: { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'nemotron 3 ultra' }, daily_requests: 100, remaining_today: 87 } },
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
    return { value: { status: reply.status, ok: reply.status < 300, headers: reply.headers ?? {}, text: JSON.stringify(reply.body ?? {}) } };
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
  return { stored, clock, sent, toasts, opened, closed, focused, runs, written, submitted, engine, keychain: () => keychain };
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
  for (const secret of [TOKEN, EMAIL, CODE, CHALLENGE, BACKUP_KEY]) expect(text.includes(secret)).toBe(false);
}

for (const surface of SURFACES) {
  test(`logged out on ${surface}: tide wordmark, one door, the honest line, and the band still yields to surveys`, async ($, on) => {
    const { clock } = world(on);
    await start($, clock, surface);
    const drawn = await band($, surface);
    expect((await drawn.find({ type: 'Text', text: ' attentionfarm ' }))?.props).toMatchObject({ bold: true, backgroundColor: '#2EC4B6', color: '#03211F' });
    expect(await drawn.find({ type: 'Text', text: 'native content' })).toBeDefined();
    expect((await drawn.find({ type: 'Button', key: 'attentionfarm-signup', text: 'sign up or log in' }))?.props.variant).toBe('secondary');
    expect(await drawn.find({ type: 'Button', key: 'attentionfarm-login' })).toBeUndefined();
    expect((await drawn.find({ type: 'Text', text: 'watch an ad, get tokens' }))?.props.bold).toBe(true);
    expect(await drawn.find({ type: 'Text', text: 'for claude code. one email code, no password.' })).toBeDefined();
    expect(JSON.stringify(await drawn.drawn())).not.toMatch(/soon|powered by|waitlist|on the list|spot|isn't live/);
    await drawn.unmount();
    const survey = await $.ui.mount({ plugin: 'attentionfarm', surface, component: 'AbovePrompt', requestId: `survey-${surface}`, props: { ...BAND, hasSurvey: true } });
    expect(await survey.find({ type: 'Button', key: 'attentionfarm-signup' })).toBeUndefined();
    expect(await survey.find({ type: 'Text', text: ' attentionfarm ' })).toBeUndefined();
    await survey.unmount();
  });
}

test('sign up: email, code (auto-submitted when six digits are pasted), keychain over stdin, the band says you\'re in', async ($, on) => {
  const { clock, sent, toasts, opened, runs, written, keychain } = world(on);
  await start($, clock);
  const view = await band($, 'terminal');
  await view.press({ key: 'attentionfarm-signup' });
  // The band holds the keyboard after its own press, so the flow is drawn right there.
  expect(opened).toEqual([]);
  expect((await view.find({ type: 'Input', key: 'attentionfarm-email' }))?.props.autoFocus).toBe(true);
  expect(await view.find({ type: 'Text', text: 'sign up or log in' })).toBeDefined();
  expect(await view.find({ type: 'Text', text: 'one code by email. no password.' })).toBeDefined();
  expect(await view.find({ type: 'Button', key: 'attentionfarm-close', text: 'close' })).toBeDefined();
  expect(await view.find({ type: 'Button', key: 'attentionfarm-signup' })).toBeUndefined();
  expect((await view.find({ type: 'Input', key: 'attentionfarm-email' }))?.props).toMatchObject({ autoFocus: true, submitLabel: 'send code', placeholder: 'you@example.com' });
  // No waitlist: nothing to opt in to on the way in.
  expect(await view.find({ type: 'Button', key: 'attentionfarm-updates' })).toBeUndefined();
  await view.input({ key: 'attentionfarm-email', text: '  You@Example.com ' });
  expect(sent[0]).toMatchObject({ path: '/auth/start', method: 'POST', body: { email: EMAIL, intent: 'signup' } });
  expect(await view.find({ type: 'Text', text: 'check your email' })).toBeDefined();
  expect(await view.find({ type: 'Text', text: `sent to ${MASKED}` })).toBeDefined();
  expect((await view.find({ type: 'Input', key: 'attentionfarm-code' }))?.props.autoFocus).toBe(true);
  expect(await view.find({ type: 'Button', key: 'attentionfarm-resend-wait', text: 'resend in a minute' })).toBeDefined();
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
  // The band itself is the moment: no toast, then it settles after five seconds.
  expect(toasts).toEqual([]);
  expect(await view.find({ type: 'Text', text: 'check your email' })).toBeUndefined();
  expect(await view.find({ type: 'Text', text: "you're in." })).toBeDefined();
  expect(await view.find({ type: 'Text', text: 'your account is ready.' })).toBeDefined();
  await clock.advance(5_000);
  expect(await view.find({ type: 'Text', text: "you're in." })).toBeUndefined();
  expect(await view.find({ type: 'Text', text: 'watch an ad, get tokens for claude code.' })).toBeDefined();
  for (const request of sent) {
    expect(request.headers['x-attentionfarm-mod']).toBe('0.3.13');
    expect(Object.keys(request.body ?? {}).every(key => ALLOWED_KEYS[request.path].includes(key))).toBe(true);
  }
  const after = view;
  expect(await after.find({ type: 'Button', key: 'attentionfarm-account', text: MASKED })).toBeDefined();
  expect(await after.find({ type: 'Button', key: 'attentionfarm-signup' })).toBeUndefined();
  expect(written.length > 0).toBe(true);
  for (const copy of [...toasts, JSON.stringify(await after.drawn())]) expect(/\$|balance|credits|earn now/.test(copy)).toBe(false);
  stateHasNoSecrets([written, toasts, await after.drawn()]);
});

test('log in: the same flow for an existing account, welcome back', async ($, on) => {
  const { clock, sent, toasts, opened, closed } = world(on, { replies: { '/auth/verify': { status: 200, body: { token: TOKEN, account: { email: EMAIL, created: false } } } } });
  await start($, clock);
  const result = await $.command.run({ command: 'attentionfarm', args: 'login' });
  expect(result).toMatchObject({ text: 'opened.' });
  expect(opened).toEqual(['attentionfarm-account']);
  const view = await pane($);
  // One door: log in is the same step.
  expect(await view.find({ type: 'Text', text: 'sign up or log in' })).toBeDefined();
  await view.input({ key: 'attentionfarm-email', text: EMAIL });
  expect(sent[0].body).toEqual({ email: EMAIL, intent: 'signup' });
  await view.input({ key: 'attentionfarm-code', text: CODE });
  expect(toasts).toEqual([]);
  expect(closed).toEqual(['attentionfarm-account']);
  const after = await band($, 'terminal', 'back');
  expect(await after.find({ type: 'Text', text: 'welcome back.' })).toBeDefined();
  expect(await after.find({ type: 'Text', text: 'good to see you again.' })).toBeDefined();
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
  expect(sent.map(request => request.body)).toEqual([{ email: EMAIL, intent: 'signup' }, { email: EMAIL, intent: 'signup' }]);
  expect(await view.find({ type: 'Text', text: 'sent a new code.' })).toBeDefined();
  expect(await view.find({ type: 'Button', key: 'attentionfarm-resend' })).toBeUndefined();
});

test('session start: restores from the keychain and confirms the session with the server', async ($, on) => {
  const live = world(on, { keychain: { token: TOKEN, comment: MASKED } });
  await start($, live.clock);
  // The session, then the free models for the picker.
  expect(live.sent).toEqual(['/me', '/backup/status'].map(path => ({ path, method: 'GET', headers: { 'x-attentionfarm-mod': '0.3.13', authorization: `Bearer ${TOKEN}` }, body: undefined })));
  expect(await (await band($, 'terminal', 'live')).find({ type: 'Button', key: 'attentionfarm-account', text: MASKED })).toBeDefined();
});

test('session start: a 401 deletes the keychain item', async ($, on) => {
  const dead = world(on, { keychain: { token: TOKEN, comment: MASKED }, replies: { '/me': { status: 401, body: { error: { code: 'unauthorized' } } } } });
  await start($, dead.clock);
  expect(dead.keychain()).toBeUndefined();
  expect(dead.toasts).toEqual(['your attentionfarm session ended. log in again.']);
  expect(await (await band($, 'terminal', 'dead')).find({ type: 'Button', key: 'attentionfarm-signup' })).toBeDefined();
});

test('session start: offline keeps the session and says so', async ($, on) => {
  const away = world(on, { keychain: { token: TOKEN, comment: MASKED }, replies: { '/me': 'offline' } });
  await start($, away.clock);
  expect(away.keychain()).toBeDefined();
  expect(await (await band($, 'terminal', 'away')).find({ type: 'Button', text: `${MASKED} · offline` })).toBeDefined();
});

test('account pane: log out and delete, and no log out everywhere', async ($, on) => {
  const { clock, sent, toasts, keychain } = world(on, { keychain: { token: TOKEN, comment: MASKED } });
  await start($, clock);
  const view = await band($, 'terminal');
  await view.press({ key: 'attentionfarm-account' });
  expect((await view.find({ type: 'Text', text: MASKED }))?.props.bold).toBe(true);
  expect(await view.find({ type: 'Text', text: 'watch an ad, get tokens for claude code.' })).toBeDefined();
  expect(await view.find({ type: 'Button', key: 'attentionfarm-logout' })).toBeDefined();
  expect(await view.find({ type: 'Button', key: 'attentionfarm-logout-all' })).toBeUndefined();
  await view.press({ key: 'attentionfarm-delete-account' });
  await view.input({ key: 'attentionfarm-delete', text: 'yes' });
  expect(await view.find({ type: 'Text', text: 'delete your account?' })).toBeDefined();
  expect(await view.find({ type: 'Text', text: 'type delete to confirm.' })).toBeDefined();
  await view.input({ key: 'attentionfarm-delete', text: 'delete' });
  expect(sent.at(-1)).toMatchObject({ path: '/account', method: 'DELETE', body: { confirm: 'delete' } });
  expect(keychain()).toBeUndefined();
  expect(toasts.at(-1)).toBe('your attentionfarm account is deleted.');
  expect(await view.find({ type: 'Button', key: 'attentionfarm-signup' })).toBeDefined();
});

test('log out still logs out here when the server is unreachable', async ($, on) => {
  const second = world(on, { keychain: { token: TOKEN, comment: MASKED }, replies: { '/auth/logout': 'offline' } });
  await start($, second.clock);
  expect(await $.command.run({ command: 'attentionfarm', args: 'account' })).toMatchObject({ text: 'opened.' });
  const view = await pane($);
  await view.press({ key: 'attentionfarm-logout' });
  expect(second.sent.at(-1)).toMatchObject({ path: '/auth/logout', method: 'POST' });
  expect(second.keychain()).toBeUndefined();
  expect(second.toasts.at(-1)).toBe('logged out of attentionfarm.');
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
  expect(await drawn.find({ type: 'Button', key: 'attentionfarm-signup' })).toBeUndefined();
  // Where login cannot happen, the band never asks for a sign-up it can't take.
  expect(await drawn.find({ type: 'Text', text: 'watch an ad, get tokens for claude code.' })).toBeDefined();
  expect(await $.command.run({ command: 'attentionfarm', args: 'signup' })).toMatchObject({ text: 'login works in claude code on macos for now.' });
});

test('desktop: every step has the same shape (quiet close, full-width field, one row of buttons, spaced rows)', async ($, on) => {
  const desktop = world(on, { replies: { '/auth/verify': [{ status: 400, body: { error: { code: 'invalid_code', attempts_left: 4 } } }] } });
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false });
  const view = await band($, 'desktop');
  await desktop.clock.advance(0);
  const walk = (node: any, fn: (n: any, parent: any) => void, parent?: any) => {
    if (!node || typeof node !== 'object') return;
    fn(node, parent);
    for (const child of node.children ?? []) walk(child, fn, node);
  };
  const check = async (step: string) => {
    const tree = await view.drawn();
    let closes = 0;
    walk(tree, (node, parent) => {
      if (node.type === 'Button' && node.props?.key === 'attentionfarm-close') {
        closes += 1;
        expect(node.props).toMatchObject({ plain: true, dimColor: true });
        expect(node.props.role).toBeUndefined();
      }
      if (node.type === 'Input') expect(parent?.props?.width).toBe('100%');
      if (node.type === 'Box' && node.props?.alignItems === 'center' && node.props?.flexWrap === 'wrap') {
        for (const child of node.children ?? []) if (child?.type !== 'Box') expect(child?.type).toBe('Button');
      }
      if (node.type === 'Box' && node.props?.rowGap !== undefined) expect(node.props.rowGap).toBe(1);
    });
    expect(closes).toBe(step === 'band' ? 0 : 1);
  };
  await view.press({ key: 'attentionfarm-signup' });
  await check('email');
  await view.input({ key: 'attentionfarm-email', text: EMAIL });
  await check('code');
  await view.input({ key: 'attentionfarm-code', text: '111111' });
  expect(await view.find({ type: 'Text', text: "that code didn't match. 4 tries left." })).toBeDefined();
  await check('error');
});

// --- free backup -------------------------------------------------------------

const LIMIT = { error: 'rate_limit' } as const;

async function step($: any, extra: Record<string, unknown> = {}) {
  const stream = $.turn.step({ turnId: 'turn-1', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...extra });
  const chunks = [];
  for (let read = await stream.next(); ; read = await stream.next()) {
    if (read.done) return { chunks, result: read.value };
    chunks.push(read.value);
  }
}

async function freeOn($: any, view: any) {
  await $.classic.StopFailure(LIMIT);
  await view.press({ key: 'attentionfarm-backup-on' });
}

for (const surface of SURFACES) {
  test(`free backup on ${surface}: the mod answers the step itself, claude sends nothing, and the band counts the tokens`, async ($, on) => {
    const { clock, sent, submitted, engine, written } = world(on, { keychain: { token: TOKEN, comment: MASKED } });
    await start($, clock, surface);
    const view = await band($, surface);
    await $.classic.StopFailure(LIMIT);
    expect(await view.find({ type: 'Text', text: 'you hit your claude limit.' })).toBeDefined();
    await view.press({ key: 'attentionfarm-backup-on' });
    expect(submitted).toEqual(['continue where you left off.']);
    expect(await view.find({ type: 'Text', text: 'nemotron 3 ultra · 0 tokens this session · 100 requests left today' })).toBeDefined();
    await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [surface], tools: ['Bash'], outputStyle: null, traits: [] });
    const { chunks, result } = await step($);
    expect(engine.steps).toBe(0);
    const asked = sent.find(request => request.path === '/backup/v1/messages')!;
    expect(asked.headers.authorization).toBe(`Bearer ${BACKUP_KEY}`);
    expect(asked.body).toMatchObject({ system: 'SYSTEM PROMPT', messages: CONVERSATION, stream: false });
    expect((asked.body as any).tools).toEqual([
      { name: 'Bash', description: 'runs a command', input_schema: TOOL_SCHEMAS.Bash },
      { name: 'mcp__docs__search', description: 'searches docs', input_schema: { type: 'object', additionalProperties: true } },
    ]);
    expect(chunks).toEqual([
      { kind: 'thinking', index: 0, text: 'let me look' },
      { kind: 'text', index: 1, text: 'here they are' },
      { kind: 'stop', stopReason: 'end_turn', usage: { ...FREE_USAGE, model: 'nvidia/nemotron-3-ultra-550b-a55b:free' } },
    ]);
    expect(result).toMatchObject({ answer: 'here they are', toolUses: [], stopReason: 'end_turn' });
    expect(await view.find({ type: 'Text', text: 'nemotron 3 ultra · 1.9k tokens this session · 99 requests left today' })).toBeDefined();
    await view.press({ key: 'attentionfarm-backup-off' });
    await step($);
    expect(engine.steps).toBe(1);
    expect(await view.find({ type: 'Text', text: '1.9k free tokens this session' })).toBeDefined();
    stateHasNoSecrets([written]);
  });
}

test('free backup: a tool call the free model asks for is always put to the person, never allowed silently', async ($, on) => {
  const { clock } = world(on, { keychain: { token: TOKEN, comment: MASKED }, replies: { '/backup/v1/messages': { status: 200, body: FREE_TOOL_REPLY } } });
  await start($, clock);
  const view = await band($, 'terminal');
  await freeOn($, view);
  const { chunks, result } = await step($);
  expect(chunks.slice(0, 2)).toEqual([
    { kind: 'tool', index: 0, id: 'toolu_free_1', name: 'Bash' },
    { kind: 'input', index: 0, json: JSON.stringify({ command: 'ls', description: 'list files' }) },
  ]);
  expect(result).toMatchObject({ stopReason: 'tool_use', toolUses: [{ name: 'Bash', input: { command: 'ls', description: 'list files' } }] });
  const free = await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_free_1' } as any);
  expect(free).toMatchObject({ decision: 'ask', reason: 'the free model (through attentionfarm) asked for this. check it before allowing.' });
  // Claude's own calls keep the person's settings.
  expect(await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_claude_1' } as any)).toMatchObject({ decision: 'allow' });
});

test('free backup: a deny stays a deny for the free model too', async ($, on) => {
  const { clock } = world(on, { keychain: { token: TOKEN, comment: MASKED }, replies: { '/backup/v1/messages': { status: 200, body: FREE_TOOL_REPLY } }, toolCheck: { decision: 'deny', reason: 'blocked by a rule' } });
  await start($, clock);
  const view = await band($, 'terminal');
  await freeOn($, view);
  await step($);
  expect(await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_free_1' } as any)).toMatchObject({ decision: 'deny' });
});

test('free backup: busy and used-up answers say so in the step and the band, and a good step clears it', async ($, on) => {
  const { clock } = world(on, { keychain: { token: TOKEN, comment: MASKED }, replies: { '/backup/v1/messages': [
    { status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'busy' } } },
    { status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: "today's free attentionfarm backup is used up. it resets at midnight utc." } } },
    { status: 200, body: FREE_REPLY },
  ] } });
  await start($, clock);
  const view = await band($, 'terminal');
  await freeOn($, view);
  const busy = await step($);
  expect(busy.result).toMatchObject({ answer: 'attentionfarm free backup: the free model is busy right now. try again in a minute, or switch back to claude.', usage: null });
  expect(await view.find({ type: 'Text', text: 'the free model is busy right now. try again in a minute, or switch back to claude.' })).toBeDefined();
  const usedUp = await step($);
  expect(usedUp.result.answer).toBe("attentionfarm free backup: today's free requests are used up. they reset at midnight utc; switch back to claude meanwhile.");
  await step($);
  expect(JSON.stringify(await view.drawn())).not.toMatch(/used up|busy right now/);
});

test('free backup: a key that ended is replaced once', async ($, on) => {
  const { clock, sent } = world(on, { keychain: { token: TOKEN, comment: MASKED }, replies: { '/backup/v1/messages': [{ status: 401, body: {} }, { status: 200, body: FREE_REPLY }] } });
  await start($, clock);
  const view = await band($, 'terminal');
  await freeOn($, view);
  const { result } = await step($);
  expect(result.answer).toBe('here they are');
  expect(sent.filter(request => request.path === '/backup/key')).toHaveLength(2);
});

test('free backup: logging out ends it and the next step goes to claude', async ($, on) => {
  const { clock, engine } = world(on, { keychain: { token: TOKEN, comment: MASKED } });
  await start($, clock);
  const view = await band($, 'terminal');
  await freeOn($, view);
  await $.command.run({ command: 'attentionfarm', args: 'logout' });
  await step($);
  expect(engine.steps).toBe(1);
});

test('free backup: other stops do not offer it, and not now dismisses it', async ($, on) => {
  const { clock } = world(on, { keychain: { token: TOKEN, comment: MASKED } });
  await start($, clock);
  await $.classic.StopFailure({ error: 'invalid_request' });
  const view = await band($, 'terminal');
  expect(await view.find({ type: 'Button', key: 'attentionfarm-backup-on' })).toBeUndefined();
  await $.classic.StopFailure({ error: 'oauth_org_not_allowed' });
  expect(await view.find({ type: 'Button', key: 'attentionfarm-backup-on' })).toBeDefined();
  await view.press({ key: 'attentionfarm-backup-dismiss' });
  expect(await view.find({ type: 'Button', key: 'attentionfarm-backup-on' })).toBeUndefined();
});

test('free backup: logged out, the offer asks for sign-up first; an unavailable service changes nothing', async ($, on) => {
  const out = world(on, { replies: { '/backup/key': { status: 503, body: { error: { code: 'backup_unavailable', message: 'x' } } } } });
  await start($, out.clock);
  await $.classic.StopFailure(LIMIT);
  const view = await band($, 'terminal');
  await view.press({ key: 'attentionfarm-backup-on' });
  expect(await view.find({ type: 'Input', key: 'attentionfarm-email' })).toBeDefined();
  await view.input({ key: 'attentionfarm-email', text: EMAIL });
  await view.input({ key: 'attentionfarm-code', text: CODE });
  await out.clock.advance(5_000);
  await view.press({ key: 'attentionfarm-backup-on' });
  expect(await view.find({ type: 'Text', text: "free backup isn't available right now." })).toBeDefined();
  expect(out.submitted).toEqual([]);
  await step($);
  expect(out.engine.steps).toBe(1);
});

test('free tokens by choice: the band button and /attentionfarm free switch at once, with no confirmation, and nothing is sent for the person', async ($, on) => {
  const { clock, submitted, engine } = world(on, { keychain: { token: TOKEN, comment: MASKED } });
  await start($, clock, 'desktop');
  const view = await band($, 'desktop');
  const slot = async () => (JSON.stringify(await view.drawn()).match(/"key":"(attentionfarm-[a-z-]+)"/g) || []).map(k => k.slice(7, -1));
  const before = await slot();
  await view.press({ key: 'attentionfarm-free' });
  expect(await view.find({ type: 'Button', key: 'attentionfarm-backup-on' })).toBeUndefined();
  expect(await view.find({ type: 'Button', key: 'attentionfarm-backup-off', text: 'back to claude' })).toBeDefined();
  // back to claude sits exactly where use free af tokens was: same row, same place before the account.
  const after = await slot();
  expect(after.indexOf('attentionfarm-backup-off')).toBe(before.indexOf('attentionfarm-free'));
  expect(after.indexOf('attentionfarm-account')).toBe(before.indexOf('attentionfarm-account'));
  expect(submitted).toEqual([]);
  expect(await $.command.run({ command: 'attentionfarm', args: 'free' })).toMatchObject({ text: 'free tokens are already on. use back to claude in the band to switch back.' });
  await step($);
  expect(engine.steps).toBe(0);
  await view.press({ key: 'attentionfarm-backup-off' });
  expect(await view.find({ type: 'Button', key: 'attentionfarm-free', text: 'use free af tokens' })).toBeDefined();
  expect(await $.command.run({ command: 'attentionfarm', args: 'free' })).toMatchObject({ text: 'free tokens on. use back to claude in the band to switch back.' });
  expect(await view.find({ type: 'Button', key: 'attentionfarm-backup-off' })).toBeDefined();
});

test('free tokens by choice: a service that cannot start says so in a toast and leaves the band as it was', async ($, on) => {
  const { clock, toasts } = world(on, { keychain: { token: TOKEN, comment: MASKED }, replies: { '/backup/key': { status: 503, body: { error: { code: 'backup_unavailable', message: 'x' } } } } });
  await start($, clock);
  const view = await band($, 'terminal');
  await view.press({ key: 'attentionfarm-free' });
  expect(toasts).toContain("free backup isn't available right now.");
  expect(await view.find({ type: 'Button', key: 'attentionfarm-backup-on' })).toBeUndefined();
  expect(await view.find({ type: 'Button', key: 'attentionfarm-free', text: 'use free af tokens' })).toBeDefined();
  expect(await $.command.run({ command: 'attentionfarm', args: 'free' })).toMatchObject({ text: 'free tokens could not start.' });
});

for (const surface of SURFACES) {
  test(`the attentionfarm wordmark is its tide chip and opens the website on ${surface}`, async ($, on) => {
    const { clock, runs } = world(on);
    await start($, clock, surface);
    const view = await band($, surface);
    expect((await view.find({ type: 'Text', text: ' attentionfarm ' }))?.props).toMatchObject({ backgroundColor: '#2EC4B6', color: '#03211F' });
    await view.press({ key: 'attentionfarm-site' });
    expect(runs.at(-1)?.argv).toEqual(['open', 'https://attentionfarm.com']);
  });
}

test('the switch on desktop: one press moves the halves once, one way, and redraws never move them again', async ($, on) => {
  const { clock, written } = world(on, { keychain: { token: TOKEN, comment: MASKED } });
  const poseLog = () => (written as any[]).filter(e => e.key === 'switchPose').map(e => e.value as number);
  await start($, clock, 'desktop');
  const view = await band($, 'desktop');
  const svg = async () => (await view.find({ type: 'Svg' }))?.props;
  expect(await svg()).toMatchObject({ alt: 'on claude', width: 16, height: 16 });
  expect((await svg()).isInteractive).toBeUndefined();
  expect((await svg()).source).toContain('class="ink" d="M30 10 A22 22 0 0 0 30 54 Z" transform="translate(0 -5)"');
  expect(await view.find({ type: 'Button', key: 'attentionfarm-free-icon' })).toBeUndefined();
  await view.press({ key: 'attentionfarm-free' });
  await clock.advance(1_000);
  let poses = poseLog();
  // switching, then on, then the token count: one move from claude to free, never back and forth.
  // One eased move: ten frames, the last exactly on the far side.
  expect(poses.length).toBe(10);
  expect(poses.every((p, i) => i === 0 || p >= poses[i - 1])).toBe(true);
  expect(poses.at(-1)).toBe(1);
  const free = await svg();
  expect(free.alt).toBe('on free af tokens');
  expect(free.source).toContain('transform="translate(0 5)"');
  expect(free.source).not.toContain('animate');
  const moved = poses.length;
  await step($);
  await clock.advance(1_000);
  expect(poseLog().length).toBe(moved);
  expect((await svg()).source).toBe(free.source);
  await view.press({ key: 'attentionfarm-backup-off' });
  await clock.advance(1_000);
  const back = poseLog().slice(moved);
  expect(back.every((p, i) => i === 0 || p <= back[i - 1])).toBe(true);
  expect(back.at(-1)).toBe(0);
  expect((await svg()).alt).toBe('on claude');
});

for (const surface of SURFACES) {
  test(`the switch keeps one width on ${surface}, so its halves never move when the label changes`, async ($, on) => {
    const { clock } = world(on, { keychain: { token: TOKEN, comment: MASKED } });
    await start($, clock, surface);
    const view = await band($, surface);
    const box = async () => (await view.find({ type: 'Box', key: surface === 'terminal' ? 'attentionfarm-switch' : 'attentionfarm-switch-label' }))?.props.minWidth;
    const width = await box();
    expect(width).toBe(surface === 'terminal' ? 21 : 18);
    await view.press({ key: 'attentionfarm-free' });
    await clock.advance(1_000);
    expect(await box()).toBe(width);
  });
}

test('the switch in the terminal: half blocks show which side is up', async ($, on) => {
  const { clock } = world(on, { keychain: { token: TOKEN, comment: MASKED } });
  await start($, clock, 'terminal');
  const view = await band($, 'terminal');
  expect(await view.find({ type: 'Svg' })).toBeUndefined();
  const button = async (key: string) => JSON.stringify(await view.find({ type: 'Button', key }));
  expect(await button('attentionfarm-free')).toMatch(/▀.*▄.* use free af tokens/);
  await view.press({ key: 'attentionfarm-free' });
  expect(await button('attentionfarm-backup-off')).toMatch(/▄.*▀.* back to claude/);
});

test('free tokens by choice: no button while logged out', async ($, on) => {
  const { clock } = world(on);
  await start($, clock);
  const view = await band($, 'terminal');
  expect(await view.find({ type: 'Button', key: 'attentionfarm-signup' })).toBeDefined();
  expect(await view.find({ type: 'Button', key: 'attentionfarm-free' })).toBeUndefined();
});

test('free tokens: /clear starts the count again', async ($, on) => {
  const { clock } = world(on, { keychain: { token: TOKEN, comment: MASKED } });
  await start($, clock);
  const view = await band($, 'terminal');
  await freeOn($, view);
  await step($);
  await view.press({ key: 'attentionfarm-backup-off' });
  expect(await view.find({ type: 'Text', text: '1.9k free tokens this session' })).toBeDefined();
  await $.classic.SessionStart({ source: 'clear' });
  expect(JSON.stringify(await view.drawn())).not.toMatch(/tokens this session/);
});

test('terminal: a band drawn before session.start still ends up offering sign up', async ($, on) => {
  const { clock } = world(on);
  const early = await band($, 'terminal', 'early');
  await clock.advance(0);
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true });
  await clock.advance(0);
  expect(await early.find({ type: 'Button', key: 'attentionfarm-signup', text: 'sign up or log in' })).toBeDefined();
});

test('free backup: the band names the roster model that answered', async ($, on) => {
  const { clock } = world(on, { keychain: { token: TOKEN, comment: MASKED }, replies: { '/backup/v1/messages': { status: 200, body: FREE_REPLY, headers: { 'x-attentionfarm-model-label': 'inkling' } } } });
  await start($, clock);
  const view = await band($, 'terminal');
  await freeOn($, view);
  await step($);
  expect(await view.find({ type: 'Text', text: 'inkling · 1.9k tokens this session · 99 requests left today' })).toBeDefined();
});

test('free backup: tokens are counted even when the engine stops reading at the stop', async ($, on) => {
  const { clock } = world(on, { keychain: { token: TOKEN, comment: MASKED } });
  await start($, clock);
  const view = await band($, 'terminal');
  await freeOn($, view);
  const stream = $.turn.step({ turnId: 'turn-9', index: 0, model: 'claude-opus-5-5', messageCount: 1 });
  for (let read = await stream.next(); !read.done; read = await stream.next()) {
    if (read.value.kind === 'stop') { await stream.return(undefined); break; }
  }
  expect(await view.find({ type: 'Text', text: 'nemotron 3 ultra · 1.9k tokens this session · 99 requests left today' })).toBeDefined();
});

for (const surface of SURFACES) {
  test(`model picker on ${surface}: under the email, every free model attentionfarm offers, the first by default`, async ($, on) => {
    const { clock } = world(on, { keychain: { token: TOKEN, comment: MASKED }, replies: { ...LISTED } });
    await start($, clock, surface);
    const view = await band($, surface);
    const picker = await view.find({ type: 'Select', key: 'attentionfarm-model' });
    expect(picker?.props).toMatchObject({ label: 'model', value: ROSTER[0].id, options: ROSTER.map(model => ({ value: model.id, label: model.label })) });
    // The email ends the first line, the picker the second: one under the other, at the right.
    const tree = JSON.stringify(await view.drawn());
    expect(tree.indexOf(MASKED)).toBeLessThan(tree.indexOf('attentionfarm-model'));
  });
}

test('model picker: a pick is asked first by the next free step, kept for the next session, and named in the band', async ($, on) => {
  const { clock, sent, stored } = world(on, { keychain: { token: TOKEN, comment: MASKED }, replies: { ...LISTED } });
  await start($, clock);
  const view = await band($, 'terminal');
  await view.select({ key: 'attentionfarm-model', value: ROSTER[2].id });
  expect((await view.find({ type: 'Select', key: 'attentionfarm-model' }))?.props.value).toBe(ROSTER[2].id);
  expect(stored.freeModel).toBe(ROSTER[2].id);
  await freeOn($, view);
  // On free tokens the picker stays beside the line, and the line doesn't name the model twice.
  expect((await view.find({ type: 'Select', key: 'attentionfarm-model' }))?.props.value).toBe(ROSTER[2].id);
  await step($);
  expect(sent.filter(request => request.path === '/backup/v1/messages').map(request => request.body?.model)).toEqual([ROSTER[2].id]);
  expect(await view.find({ type: 'Text', text: '1.9k tokens this session · 99 requests left today' })).toBeDefined();
});

test('model picker: when the pick was busy and another model answered, the band says which', async ($, on) => {
  const { clock } = world(on, { keychain: { token: TOKEN, comment: MASKED }, store: { freeModel: ROSTER[2].id }, replies: { ...LISTED, '/backup/v1/messages': { status: 200, body: FREE_REPLY, headers: { 'x-attentionfarm-model-label': 'nemotron 3 ultra' } } } });
  await start($, clock);
  const view = await band($, 'terminal');
  expect((await view.find({ type: 'Select', key: 'attentionfarm-model' }))?.props.value).toBe(ROSTER[2].id);
  await freeOn($, view);
  await step($);
  expect(await view.find({ type: 'Text', text: 'answered by nemotron 3 ultra · 1.9k tokens this session · 99 requests left today' })).toBeDefined();
});

test('model picker: a kept pick the roster dropped falls back to the server order', async ($, on) => {
  const gone = world(on, { keychain: { token: TOKEN, comment: MASKED }, store: { freeModel: 'retired/model:free' }, replies: { ...LISTED } });
  await start($, gone.clock);
  const view = await band($, 'terminal', 'gone');
  expect((await view.find({ type: 'Select', key: 'attentionfarm-model' }))?.props.value).toBe(ROSTER[0].id);
  await freeOn($, view);
  await step($);
  expect(gone.sent.filter(request => request.path === '/backup/v1/messages').map(request => request.body?.model)).toEqual(['attentionfarm-free']);
});

test('model picker: hidden when the server lists no models, and when logged out', async ($, on) => {
  const old = world(on, { keychain: { token: TOKEN, comment: MASKED } });
  await start($, old.clock);
  expect(await (await band($, 'terminal', 'old')).find({ type: 'Select', key: 'attentionfarm-model' })).toBeUndefined();
});

test('model picker: hidden when logged out', async ($, on) => {
  const { clock } = world(on, { replies: { ...LISTED } });
  await start($, clock);
  expect(await (await band($, 'desktop')).find({ type: 'Select', key: 'attentionfarm-model' })).toBeUndefined();
});
