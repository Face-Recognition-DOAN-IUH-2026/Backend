"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceUnavailableError = exports.ConflictError = exports.NotFoundError = exports.ForbiddenError = exports.BadRequestError = exports.AppError = void 0;
class AppError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.name = this.constructor.name;
    }
}
exports.AppError = AppError;
class BadRequestError extends AppError {
    constructor(message = 'Bad request') {
        super(400, message);
    }
}
exports.BadRequestError = BadRequestError;
class ForbiddenError extends AppError {
    constructor(message = 'Forbidden') {
        super(403, message);
    }
}
exports.ForbiddenError = ForbiddenError;
class NotFoundError extends AppError {
    constructor(message = 'Not found') {
        super(404, message);
    }
}
exports.NotFoundError = NotFoundError;
class ConflictError extends AppError {
    constructor(message = 'Conflict') {
        super(409, message);
    }
}
exports.ConflictError = ConflictError;
class ServiceUnavailableError extends AppError {
    constructor(message = 'Service unavailable') {
        super(503, message);
    }
}
exports.ServiceUnavailableError = ServiceUnavailableError;
