import { layoutStack } from '../src/components/MessageBubble/messageMenuLayout';

const AREA = { areaTop: 100, areaBottom: 800 };
const BAR = 48;
const MENU = 200;
const GAP = 8;

describe('context menu stack (reactions / message / menu)', () => {
  it('leaves a message with room around it where it is', () => {
    const l = layoutStack({ bubble: { top: 300, bottom: 360 }, barHeight: BAR, menuHeight: MENU, ...AREA });
    expect(l.previewTop).toBe(300);
    expect(l.barTop).toBe(300 - GAP - BAR);
    expect(l.menuTop).toBe(360 + GAP);
  });

  it('lifts a message near the input so the menu fits under it, without covering the reactions', () => {
    const l = layoutStack({ bubble: { top: 700, bottom: 780 }, barHeight: BAR, menuHeight: MENU, ...AREA });
    expect(l.menuTop + MENU).toBeLessThanOrEqual(AREA.areaBottom);
    // Bar above the message, menu below it: no overlap anywhere.
    expect(l.barTop + BAR).toBeLessThanOrEqual(l.previewTop);
    expect(l.previewTop + l.previewHeight).toBeLessThanOrEqual(l.menuTop);
    expect(l.previewHeight).toBe(80);
  });

  it('drops a message under the header so the reaction bar is on screen', () => {
    const l = layoutStack({ bubble: { top: 90, bottom: 150 }, barHeight: BAR, menuHeight: MENU, ...AREA });
    expect(l.barTop).toBe(AREA.areaTop);
    expect(l.previewTop).toBe(AREA.areaTop + BAR + GAP);
  });

  it('cuts a message taller than the screen to what is left', () => {
    const l = layoutStack({ bubble: { top: 50, bottom: 1500 }, barHeight: BAR, menuHeight: MENU, ...AREA });
    expect(l.barTop).toBe(AREA.areaTop);
    expect(l.menuTop + MENU).toBe(AREA.areaBottom);
    expect(l.previewHeight).toBe(AREA.areaBottom - AREA.areaTop - BAR - MENU - 2 * GAP);
  });

  it('without reactions the message sits right under the top edge', () => {
    const l = layoutStack({ bubble: { top: 80, bottom: 140 }, barHeight: 0, menuHeight: MENU, ...AREA });
    expect(l.previewTop).toBe(AREA.areaTop);
    expect(l.barTop).toBe(AREA.areaTop);
  });
});
