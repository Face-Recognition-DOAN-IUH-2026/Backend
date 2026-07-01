"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpError = void 0;
exports.errorHandler = errorHandler;
exports.setupProcessErrorHandlers = setupProcessErrorHandlers;
const jira_client_1 = require("./jira-client");
class HttpError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'HttpError';
    }
}
exports.HttpError = HttpError;
function getServiceName() {
    const port = process.env.PORT || '3000';
    const serviceMap = {
        '3001': 'user-service',
        '3002': 'schedule-service',
        '3003': 'access-service',
        '3004': 'ai-service',
        '3006': 'notification-service',
        '3007': 'automation-service',
        '8000': 'borrow-service',
        '80': 'api-gateway',
    };
    return serviceMap[port] || `service-${port}`;
}
function errorHandler(err, req, res, _next) {
    const statusCode = err.statusCode || err.status || 500;
    const message = err.message || 'Internal Server Error';
    const serviceName = getServiceName();
    // Log to console
    console.error(`[${serviceName}] ${req.method} ${req.path} - ${statusCode} - ${message}`);
    if (statusCode >= 500 && err.stack) {
        console.error(err.stack);
    }
    // Report 5xx errors to Jira
    if (statusCode >= 500) {
        const jiraParams = {
            title: `[${serviceName}] ${req.method} ${req.path} - ${message}`,
            description: message,
            priority: statusCode >= 500 ? 'High' : 'Medium',
            labels: [serviceName, `${statusCode}-error`],
            service: serviceName,
            endpoint: req.path,
            method: req.method,
            stacktrace: err.stack,
            userId: req.user?.userId || req.user?.sub,
            requestBody: req.body ? JSON.stringify(req.body).substring(0, 2000) : undefined,
            timestamp: new Date().toISOString(),
        };
        (0, jira_client_1.createJiraBug)(jiraParams).catch((e) => {
            console.error('[JiraClient] Failed to report error:', e);
        });
    }
    // Send response
    if (statusCode >= 500) {
        res.status(statusCode).json({
            error: message,
        });
    }
    else {
        res.status(statusCode).json({
            error: message,
            detail: err.detail || undefined,
        });
    }
}
// Catch uncaught exceptions and unhandled rejections
function setupProcessErrorHandlers() {
    const serviceName = getServiceName();
    process.on('uncaughtException', (error) => {
        console.error(`[${serviceName}] Uncaught Exception:`, error);
        (0, jira_client_1.createJiraBug)({
            title: `[${serviceName}] Uncaught Exception - ${error.message}`,
            description: error.message,
            priority: 'Highest',
            labels: [serviceName, 'uncaught-exception', 'critical'],
            service: serviceName,
            stacktrace: error.stack,
            timestamp: new Date().toISOString(),
        }).catch(() => { }).finally(() => process.exit(1));
    });
    process.on('unhandledRejection', (reason) => {
        const message = reason instanceof Error ? reason.message : String(reason);
        const stack = reason instanceof Error ? reason.stack : undefined;
        console.error(`[${serviceName}] Unhandled Rejection:`, reason);
        (0, jira_client_1.createJiraBug)({
            title: `[${serviceName}] Unhandled Rejection - ${message}`,
            description: message,
            priority: 'High',
            labels: [serviceName, 'unhandled-rejection'],
            service: serviceName,
            stacktrace: stack,
            timestamp: new Date().toISOString(),
        }).catch(() => { }).finally(() => process.exit(1));
    });
}
