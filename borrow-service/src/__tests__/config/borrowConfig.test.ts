describe('borrow config', () => {
  it('maxRenewals defaults to 1', () => {
    const { config } = require('../../config');
    expect(config.maxRenewals).toBe(1);
  });

  it('reservationExpiryHours defaults to 24', () => {
    const { config } = require('../../config');
    expect(config.reservationExpiryHours).toBe(24);
  });

  it('maxBorrowDays defaults to 14', () => {
    const { config } = require('../../config');
    expect(config.maxBorrowDays).toBe(14);
  });

  it('maxBorrowBooks defaults to 3', () => {
    const { config } = require('../../config');
    expect(config.maxBorrowBooks).toBe(3);
  });

  it('finePerDay defaults to 5000', () => {
    const { config } = require('../../config');
    expect(config.finePerDay).toBe(5000);
  });
});
