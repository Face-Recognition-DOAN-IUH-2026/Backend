"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpError = void 0;
exports.errorHandler = errorHandler;
const zod_1 = require("zod");
class HttpError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}
exports.HttpError = HttpError;
function errorHandler(err, _req, res, _next) {
    if (err instanceof zod_1.ZodError) {
        const messages = err.errors.map((e) => e.message).join('; ');
        res.status(400).json({ detail: messages });
        return;
    }
    const statusCode = err instanceof HttpError ? err.statusCode : 500;
    const detail = err instanceof Error ? err.message : 'Internal server error';
    if (statusCode >= 500) {
        console.error('borrow-service error:', detail);
    }
    res.status(statusCode).json({ detail });
}
