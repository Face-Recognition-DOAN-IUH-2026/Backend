"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const zod_1 = require("zod");
const errors_1 = require("../errors");
function errorHandler(err, _req, res, _next) {
    if (err instanceof zod_1.ZodError) {
        res.status(422).json({ error: 'Validation error', detail: err.errors });
        return;
    }
    if (err instanceof errors_1.AppError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
    }
    console.error('Unhandled schedule-service error:', err);
    res.status(500).json({ error: 'Internal server error' });
}
