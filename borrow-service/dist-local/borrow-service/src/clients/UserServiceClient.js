"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lookupPatronByStudentCode = lookupPatronByStudentCode;
exports.lookupPatronById = lookupPatronById;
exports.lookupPatronsByIds = lookupPatronsByIds;
const config_1 = require("../config");
const errorHandler_1 = require("../middlewares/errorHandler");
const circuitBreaker_1 = require("../../../shared/utils/circuitBreaker");
const shared_1 = require("../../../shared");
const circuit = new circuitBreaker_1.CircuitBreaker(5, 60000);
async function request(path, init) {
    if (!circuit.canRequest()) {
        throw new errorHandler_1.HttpError(503, 'user-service is temporarily unavailable');
    }
    try {
        const res = await fetch(`${config_1.config.userServiceUrl}${path}`, {
            ...init,
            headers: {
                'Authorization': `Bearer ${(0, shared_1.getServiceToken)('borrow-service', config_1.config.jwtSecret)}`,
                ...(init?.headers || {}),
            },
            signal: AbortSignal.timeout(5000),
        });
        if (res.status >= 500) {
            circuit.recordFailure();
            throw new errorHandler_1.HttpError(503, 'Cannot lookup patron right now');
        }
        circuit.recordSuccess();
        return res;
    }
    catch (error) {
        if (error instanceof errorHandler_1.HttpError)
            throw error;
        circuit.recordFailure();
        throw new errorHandler_1.HttpError(503, 'Khong the tra cuu doc gia');
    }
}
async function lookupPatronByStudentCode(studentCode) {
    const normalized = studentCode.trim();
    if (!normalized)
        throw new errorHandler_1.HttpError(400, 'student_code is required');
    const res = await request(`/internal/patrons/lookup?student_code=${encodeURIComponent(normalized)}`);
    if (res.status !== 200)
        throw new errorHandler_1.HttpError(404, 'Khong tim thay doc gia');
    const data = await res.json();
    if (!data.exists || !data.patron)
        throw new errorHandler_1.HttpError(404, 'Khong tim thay doc gia voi MSSV nay');
    return data.patron;
}
async function lookupPatronById(id) {
    const res = await request(`/internal/users/${encodeURIComponent(id)}`);
    if (res.status === 404)
        return null;
    if (res.status !== 200)
        throw new errorHandler_1.HttpError(503, 'Cannot lookup patron right now');
    return res.json();
}
async function lookupPatronsByIds(ids) {
    if (ids.length === 0)
        return new Map();
    const res = await request('/internal/users/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
    });
    if (res.status !== 200)
        throw new errorHandler_1.HttpError(503, 'Cannot batch lookup patrons');
    const data = await res.json();
    return new Map(Object.entries(data));
}
