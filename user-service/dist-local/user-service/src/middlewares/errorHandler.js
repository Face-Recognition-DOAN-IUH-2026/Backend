"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const errors_1 = require("../errors");
function errorHandler(err, _req, res, _next) {
    if (err instanceof errors_1.AppError) {
        res.status(err.statusCode).json({ error: err.message, detail: err.message });
        return;
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error', detail: 'Internal server error' });
}
