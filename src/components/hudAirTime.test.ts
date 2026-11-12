import { airTimeParts, writeAirTime, type AirTimeWriter } from './hudAirTime';
import { t } from '../i18n/i18n';

function fakeElement() {
  let text = '';
  const writes = { count: 0 };
  const el = {
    classList: { add: vi.fn(), remove: vi.fn() },
    get textContent() {
      return text;
    },
    set textContent(value: string) {
      writes.count++;
      text = value;
    },
  };
  return { el: el as unknown as HTMLElement, writes, read: () => text };
}

describe('hudAirTime', () => {
  it('splits the English message around the seconds', () => {
    expect(airTimeParts(t)).toEqual({ prefix: 'AIR! ', suffix: 's', decimal: '.' });
  });

  it('writes the same text toFixed(1) gave', () => {
    const { el, read } = fakeElement();
    const writer: AirTimeWriter = { parts: airTimeParts(t), bucket: -1 };
    writeAirTime(el, 1.23, writer);
    expect(read()).toBe('AIR! 1.2s');
    writeAirTime(el, 0.96, writer);
    expect(read()).toBe('AIR! 1.0s');
  });

  it('does not touch textContent while the tenth-second bucket is unchanged', () => {
    const { el, writes } = fakeElement();
    const writer: AirTimeWriter = { parts: airTimeParts(t), bucket: -1 };
    writeAirTime(el, 1.21, writer);
    expect(writes.count).toBe(1);
    for (const s of [1.22, 1.23, 1.24, 1.18, 1.15]) writeAirTime(el, s, writer);
    expect(writes.count).toBe(1);
    writeAirTime(el, 1.31, writer);
    expect(writes.count).toBe(2);
    writeAirTime(el, 0, writer);
    writeAirTime(el, 0, writer);
    expect(writes.count).toBe(3);
  });
});
