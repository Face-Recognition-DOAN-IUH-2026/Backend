"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateOverdueFine = calculateOverdueFine;
/**
 * Calculate overdue fine using tiered brackets per BA rules:
 * - 1-7 days: 10,000 VND
 * - 8-14 days: 20,000 VND
 * - 15-30 days: 50,000 VND
 * - 31+ days: 100,000 VND
 */
function calculateOverdueFine(overdueDays) {
    if (overdueDays <= 0)
        return 0;
    if (overdueDays <= 7)
        return 10000;
    if (overdueDays <= 14)
        return 20000;
    if (overdueDays <= 30)
        return 50000;
    return 100000;
}
