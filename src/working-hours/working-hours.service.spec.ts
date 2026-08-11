import { toHhMm, toMinutes } from './working-hours.service';

describe('working-hours time conversion', () => {
  describe('toMinutes', () => {
    it.each([
      ['00:00', 0],
      ['09:00', 540],
      ['09:30', 570],
      ['12:00', 720],
      ['23:59', 1439],
    ])('converts %s to %i', (hhmm, expected) => {
      expect(toMinutes(hhmm)).toBe(expected);
    });
  });

  describe('toHhMm', () => {
    it.each([
      [0, '00:00'],
      [540, '09:00'],
      [570, '09:30'],
      [1439, '23:59'],
    ])('converts %i to %s', (minutes, expected) => {
      expect(toHhMm(minutes)).toBe(expected);
    });

    it('zero-pads single digits', () => {
      expect(toHhMm(65)).toBe('01:05');
    });
  });

  it('round-trips every minute of the day', () => {
    for (let minute = 0; minute < 1440; minute++) {
      expect(toMinutes(toHhMm(minute))).toBe(minute);
    }
  });
});
