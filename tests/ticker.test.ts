import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';

const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const;

function world(on: On) {
  const clock = mock.clock(on);
  const frames: (string | undefined)[] = [];
  on('session.start', () => ({ cwd: '/work' }));
  on('session.end', ($, e) => ({ sessionId: e.sessionId }));
  on('classic.SessionStart', () => ({}));
  on('command.register', ($, e) => ({ value: { command: e.name } }));
  on('ui.status', ($, e) => { if (e.text !== undefined || frames.length) frames.push(e.text); return { value: undefined }; });
  return { clock, frames };
}

test('ticker immediately draws, scrolls left at one frame per second, and wraps without blank gaps', async ($, on) => {
  const { clock, frames } = world(on);
  await $.session.start(START);
  expect(frames.length).toBe(1);
  expect(frames[0]).toContain('watch ad, get tokens');
  await clock.advance(999);
  expect(frames.length).toBe(1);
  await clock.advance(1);
  expect(frames[1]!.slice(0, -2)).toBe(frames[0]!.slice(2));
  await clock.advance(240000);
  expect(frames.length).toBe(242);
  expect(frames.slice(1).some(frame => frame === frames[0])).toBe(true);
  for (const frame of frames) {
    expect(frame!.length).toBe(60);
    expect(/^[\x20-\x7e]+$/.test(frame!)).toBe(true);
  }
});

test('pause freezes the current frame, hide clears it, and resume cannot unhide it', async ($, on) => {
  const { clock, frames } = world(on);
  await $.session.start(START);
  await clock.advance(2000);
  const paused = frames[frames.length - 1];
  await $.command.run({ command: 'attentionfarm', args: 'ticker pause' });
  expect(frames[frames.length - 1]).toBe(paused);
  const pausedCount = frames.length;
  await clock.advance(5000);
  expect(frames.length).toBe(pausedCount);
  await $.command.run({ command: 'attentionfarm', args: 'ticker resume' });
  await clock.advance(1000);
  expect(frames[frames.length - 1]).not.toBe(paused);
  await $.command.run({ command: 'attentionfarm', args: 'ticker off' });
  expect(frames[frames.length - 1]).toBeUndefined();
  const hiddenCount = frames.length;
  await clock.advance(5000);
  expect(frames.length).toBe(hiddenCount);
  await $.command.run({ command: 'attentionfarm', args: 'ticker resume' });
  expect(frames[frames.length - 1]).toBeUndefined();
  await $.command.run({ command: 'attentionfarm', args: 'ticker on' });
  const shown = frames[frames.length - 1];
  expect(shown).toBeDefined();
  await clock.advance(1000);
  expect(frames[frames.length - 1]!.slice(0, -2)).toBe(shown!.slice(2));
});

test('repeated startup keeps one timer, session end clears it, and clear restarts it', async ($, on) => {
  const { clock, frames } = world(on);
  await $.session.start(START);
  await $.session.start(START);
  await $.classic.SessionStart({ source: 'startup' });
  const startupCount = frames.length;
  await clock.advance(1000);
  expect(frames.length).toBe(startupCount + 1);
  await $.session.end({ reason: 'clear', sessionId: 'test-session', resume: { id: 'test-session' } });
  expect(frames[frames.length - 1]).toBeUndefined();
  const endedCount = frames.length;
  await clock.advance(3000);
  expect(frames.length).toBe(endedCount);
  await $.classic.SessionStart({ source: 'clear' });
  expect(frames[frames.length - 1]).toBeDefined();
  await $.classic.SessionStart({ source: 'resume' });
  await $.classic.SessionStart({ source: 'fork' });
  const restartCount = frames.length;
  await clock.advance(1000);
  expect(frames.length).toBe(restartCount + 1);
});

test('repeated startup preserves hidden and paused preferences, while noninteractive startup never animates', async ($, on) => {
  const { clock, frames } = world(on);
  await $.session.start(START);
  await $.command.run({ command: 'attentionfarm', args: 'ticker pause' });
  await $.session.start(START);
  const pausedCount = frames.length;
  await clock.advance(3000);
  expect(frames.length).toBe(pausedCount);
  await $.command.run({ command: 'attentionfarm', args: 'ticker off' });
  await $.session.start(START);
  expect(frames[frames.length - 1]).toBeUndefined();
  const hiddenCount = frames.length;
  await clock.advance(3000);
  expect(frames.length).toBe(hiddenCount);
  await $.session.start({ ...START, surface: null, isInteractive: false });
  await $.command.run({ command: 'attentionfarm', args: 'ticker on' });
  expect(frames[frames.length - 1]).toBeUndefined();
  const printCount = frames.length;
  await clock.advance(3000);
  expect(frames.length).toBe(printCount);
});
