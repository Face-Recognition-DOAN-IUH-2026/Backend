import { calculateOverdueFine } from '../../utils/fineCalculator';

describe('calculateOverdueFine', () => {
  it('returns 0 when not overdue (0 days)', () => {
    expect(calculateOverdueFine(0)).toBe(0);
  });

  it('returns 0 for negative days', () => {
    expect(calculateOverdueFine(-1)).toBe(0);
  });

  it('returns 10000 for 1-7 days overdue', () => {
    expect(calculateOverdueFine(1)).toBe(10000);
    expect(calculateOverdueFine(3)).toBe(10000);
    expect(calculateOverdueFine(7)).toBe(10000);
  });

  it('returns 20000 for 8-14 days overdue', () => {
    expect(calculateOverdueFine(8)).toBe(20000);
    expect(calculateOverdueFine(10)).toBe(20000);
    expect(calculateOverdueFine(14)).toBe(20000);
  });

  it('returns 50000 for 15-30 days overdue', () => {
    expect(calculateOverdueFine(15)).toBe(50000);
    expect(calculateOverdueFine(20)).toBe(50000);
    expect(calculateOverdueFine(30)).toBe(50000);
  });

  it('returns 100000 for 31+ days overdue', () => {
    expect(calculateOverdueFine(31)).toBe(100000);
    expect(calculateOverdueFine(60)).toBe(100000);
    expect(calculateOverdueFine(365)).toBe(100000);
  });

  describe('custom dynamic brackets', () => {
    const customBrackets = [
      { from: 1, to: 3, amount: 5000 },
      { from: 4, to: 10, amount: 15000 },
      { from: 11, to: null, amount: 80000 },
    ];

    it('uses custom bracket amounts', () => {
      expect(calculateOverdueFine(2, customBrackets)).toBe(5000);
      expect(calculateOverdueFine(5, customBrackets)).toBe(15000);
      expect(calculateOverdueFine(15, customBrackets)).toBe(80000);
    });

    it('falls back to per-day fine when days exceed closed brackets', () => {
      const closedBrackets = [
        { from: 1, to: 5, amount: 10000 },
      ];
      expect(calculateOverdueFine(8, closedBrackets, 3000)).toBe(24000);
    });
  });
});
