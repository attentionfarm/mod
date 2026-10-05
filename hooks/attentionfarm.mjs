const TICKER_STATE = { plugin: 'attentionfarm', key: 'ticker' };
const TICKER_OFFSET = { plugin: 'attentionfarm', key: 'tickerOffset' };
const TICKER_COPY = 'watch ad, get tokens | attentionfarm | ';
const TICKER_WIDTH = 60;
const INITIAL_TICKER = { enabled: true, paused: false };

// Session state survives hot reload; timer handles do not.
let timer;
let generation = 0;
let interactive = false;

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

export function register(on) {
  on('session.start', async ($, e, next) => {
    const result = await next(e);
    await $.command.register({ name: 'attentionfarm', description: 'scrolling status line: ticker on, off, pause, resume.' });
    interactive = e.isInteractive;
    await syncTicker($);
    return result;
  });

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e);
    if (['clear', 'resume', 'fork'].includes(e.source)) await syncTicker($);
    return result;
  });

  on('session.end', ($, e, next) => {
    stopTicker();
    $.ui.status(undefined);
    return next(e);
  });

  on('command.run', { command: 'attentionfarm' }, async ($, e) => {
    const match = /^ticker (on|off|pause|resume)$/.exec(e.args.trim().toLowerCase());
    if (!match) return { text: 'use /attentionfarm ticker on, off, pause or resume.' };
    await setTicker($, match[1]);
    return { text: `attentionfarm ticker: ${match[1]}.` };
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const native = await next(e);
    if (e.props.hasSurvey) return native;
    const { Box, Button } = $.ui.resolve(e);
    return Box({
      flexDirection: 'column',
      children: [native, Button({
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
      })],
    });
  });
}
