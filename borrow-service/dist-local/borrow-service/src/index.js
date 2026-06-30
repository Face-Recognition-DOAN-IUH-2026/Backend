"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const config_1 = require("./config");
const swagger_1 = require("./config/swagger");
const data_source_1 = require("./data-source");
const borrow_routes_1 = __importDefault(require("./routes/borrow.routes"));
const borrow_internal_routes_1 = __importDefault(require("./routes/borrow-internal.routes"));
const library_routes_1 = __importDefault(require("./routes/library.routes"));
const error_handler_1 = require("../shared/error-handler");
const AmqpClient_1 = require("./clients/AmqpClient");
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: true, credentials: true }));
app.use(express_1.default.json());
app.use('/borrow/internal', borrow_internal_routes_1.default);
app.use('/borrow', borrow_routes_1.default);
app.use('/library', library_routes_1.default);
app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', service: config_1.config.serviceName });
});
app.get('/ready', async (_req, res) => {
    try {
        await data_source_1.AppDataSource.query('SELECT 1');
        res.json({ status: 'ok', service: config_1.config.serviceName, db_ok: true });
    }
    catch {
        res.status(503).json({ status: 'degraded', service: config_1.config.serviceName, db_ok: false });
    }
});
if (config_1.config.nodeEnv !== 'production') {
    app.get('/api-docs/swagger.json', (_req, res) => {
        res.json(swagger_1.swaggerSpec);
    });
    app.use('/api-docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swagger_1.swaggerSpec));
}
app.use(error_handler_1.errorHandler);
async function start() {
    try {
        await data_source_1.AppDataSource.initialize();
        (0, error_handler_1.setupProcessErrorHandlers)();
        await AmqpClient_1.amqpClient.connect().catch((e) => console.error('[AMQP] Init failed:', e.message));
        const server = app.listen(config_1.config.port, '0.0.0.0', () => {
            console.log(`Borrow service running on port ${config_1.config.port}`);
        });
        const shutdown = async () => {
            console.log('SIGTERM received, shutting down gracefully');
            server.close(async () => {
                await data_source_1.AppDataSource.destroy();
                console.log('Database connections closed');
                process.exit(0);
            });
            setTimeout(() => {
                console.error('Forced shutdown after timeout');
                process.exit(1);
            }, 10000);
        };
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    }
    catch (error) {
        console.error('Failed to start borrow-service:', error);
        process.exit(1);
    }
}
start();
