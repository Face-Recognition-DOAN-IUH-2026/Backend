import {
  calculateDamageFee,
  calculateDamageFeeAmount,
} from '../../utils/fineCalculator';

const DAMAGE_CONFIG = {
  damageFeePct: { minor: 30, major: 70, lost: 100 },
  damageFeeFixed: { minor: 5000, major: 10000, lost: 10000 },
  fallbackBookPrice: 100000,
};

/**
 * BLF-FEE-01 — calculateDamageFee must never invent a price.
 *
 * When book.price is null / 0 / negative, the fee MUST be 0 and
 * priceUnavailable MUST be true. No silent fallback to fallbackBookPrice.
 */
describe('BLF-FEE-01 calculateDamageFee — unknown book price', () => {
  describe('with a known price (should keep existing math)', () => {
    it('minor_damage = round(price*30%) + 5000, priceUnavailable=false', () => {
      const r = calculateDamageFee('minor_damage', 100000, DAMAGE_CONFIG);
      expect(r).toEqual({ amount: 35000, priceUnavailable: false });
    });

    it('major_damage = round(price*70%) + 10000, priceUnavailable=false', () => {
      const r = calculateDamageFee('major_damage', 100000, DAMAGE_CONFIG);
      expect(r).toEqual({ amount: 80000, priceUnavailable: false });
    });

    it('lost = round(price*100%) + 10000, priceUnavailable=false', () => {
      const r = calculateDamageFee('lost', 100000, DAMAGE_CONFIG);
      expect(r).toEqual({ amount: 110000, priceUnavailable: false });
    });

    it('custom pcts/fixed are honoured', () => {
      const custom = {
        damageFeePct: { minor: 10, major: 50, lost: 90 },
        damageFeeFixed: { minor: 1000, major: 2000, lost: 3000 },
        fallbackBookPrice: 50000,
      };
      expect(calculateDamageFee('minor_damage', 200000, custom)).toEqual({
        amount: 21000,
        priceUnavailable: false,
      });
    });
  });

  describe('without a known price (the defect — must NOT substitute fallback)', () => {
    it.each([null, 0, -1, undefined])(
      'price=%j → amount 0, priceUnavailable=true',
      (price) => {
        const r = calculateDamageFee('lost', price as any, DAMAGE_CONFIG);
        expect(r).toEqual({ amount: 0, priceUnavailable: true });
        // The legacy number wrapper must also not invent a price.
        expect(calculateDamageFeeAmount('lost', price as any, DAMAGE_CONFIG)).toBe(
          0,
        );
      },
    );

    it.each(['major_damage', 'minor_damage', 'lost'])(
      'any damage condition with null price → 0 / priceUnavailable=true',
      (condition) => {
        const r = calculateDamageFee(condition as any, null, DAMAGE_CONFIG);
        expect(r.amount).toBe(0);
        expect(r.priceUnavailable).toBe(true);
      },
    );

    it('does not consult fallbackBookPrice at all', () => {
      const r = calculateDamageFee('lost', null, {
        ...DAMAGE_CONFIG,
        fallbackBookPrice: 999999999,
      });
      expect(r.amount).toBe(0);
      expect(r.priceUnavailable).toBe(true);
    });
  });
});
