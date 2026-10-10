import { expect, test } from 'claude-code/testing';

test('the tide wordmark composes with native content on desktop and terminal and yields to surveys', async ($, on) => {
  const received: string[] = [];
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
    expect((await band.find({ type: 'Text', text: ' attentionfarm ' }))?.props).toMatchObject({ bold: true, backgroundColor: '#2EC4B6', color: '#03211F' });
    expect(await band.find({ type: 'Text', text: 'Native content' })).toBeDefined();
    expect(await band.find({ type: 'Link' })).toBeUndefined();
    await band.unmount();
    const survey = await $.ui.mount({ ...target, requestId: `${surface}-survey`, props: { ...target.props, hasSurvey: true } });
    expect(await survey.find({ type: 'Text', text: ' attentionfarm ' })).toBeUndefined();
    expect(await survey.find({ type: 'Text', text: 'Native content' })).toBeDefined();
    await survey.unmount();
  }
  expect(received).toEqual(['desktop', 'desktop-survey', 'terminal', 'terminal-survey']);
});
