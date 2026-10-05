import { expect, test } from 'claude-code/testing';

test('the website link composes with native content on desktop and terminal and yields to surveys', async ($, on) => {
  const received: string[] = [];
  const opened: string[][] = [];
  on('process.run', ($, e) => {
    opened.push([...e.argv]);
    return { exitCode: 0, stdout: '', stderr: '' };
  });
  on('ui.render', ($, e) => {
    received.push(e.requestId);
    return { type: 'Text', props: {}, children: ['Native content'] };
  });
  for (const surface of ['desktop', 'terminal'] as const) {
    const target = {
      plugin: 'attentionfarm', surface, component: 'AbovePrompt', requestId: surface,
      props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 60, scroll: { offset: 0, bodyRows: 8 }, view: {} },
    } as const;
    const band = await $.ui.mount(target);
    expect(await band.find({ type: 'Button', text: 'powered by attentionfarm' })).toMatchObject({
      props: { plain: true, label: 'powered by attentionfarm' },
    });
    expect(await band.find({ type: 'Text', text: 'Native content' })).toBeDefined();
    expect(await band.find({ type: 'Link' })).toBeUndefined();
    expect(opened).toHaveLength(surface === 'desktop' ? 0 : 1);
    await band.press({ key: 'attentionfarm-website' });
    expect(opened[opened.length - 1]).toEqual(['open', 'https://attentionfarm.com/?utm_source=mod&utm_campaign=mod-waitlist-v0']);
    await band.unmount();
    const survey = await $.ui.mount({ ...target, requestId: `${surface}-survey`, props: { ...target.props, hasSurvey: true } });
    expect(await survey.find({ type: 'Button', text: 'powered by attentionfarm' })).toBeUndefined();
    expect(await survey.find({ type: 'Text', text: 'Native content' })).toBeDefined();
    await survey.unmount();
  }
  expect(received).toEqual(['desktop', 'desktop-survey', 'terminal', 'terminal-survey']);
});
