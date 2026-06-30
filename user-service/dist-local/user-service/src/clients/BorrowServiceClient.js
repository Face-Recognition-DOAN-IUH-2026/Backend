"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkActiveBorrows = checkActiveBorrows;
const config_1 = require("../config");
const shared_1 = require("../../../shared");
let consecutiveFailures = 0;
let openUntil = 0;
function canRequest() {
    return Date.now() >= openUntil;
}
function recordSuccess() {
    consecutiveFailures = 0;
    openUntil = 0;
}
function recordFailure() {
    consecutiveFailures += 1;
    if (consecutiveFailures >= 3) {
        openUntil = Date.now() + 30000;
    }
}
async function checkActiveBorrows(patronId) {
    if (!canRequest()) {
        throw new Error('Borrow-service temporarily unavailable');
    }
    try {
        const res = await fetch(`${config_1.config.borrowServiceUrl}/borrow/internal/active-borrowers?patronId=${patronId}`, {
            headers: { 'Authorization': `Bearer ${(0, shared_1.getServiceToken)('user-service', config_1.config.jwtSecret)}` },
            signal: AbortSignal.timeout(5000),
        });
        if (res.status === 403) {
            throw new Error('Internal API key rejected by borrow-service');
        }
        if (!res.ok) {
            throw new Error(`Borrow-service returned ${res.status}`);
        }
        recordSuccess();
        return res.json();
    }
    catch (err) {
        recordFailure();
        console.error('[BorrowServiceClient] Failed to check active borrows:', err);
        throw new Error('Cannot verify active borrows right now');
    }
}
