"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const config_1 = require("./config");
const data_source_1 = require("./data-source");
const schedule_routes_1 = __importDefault(require("./routes/schedule.routes"));
const schedule_internal_routes_1 = __importDefault(require("./routes/schedule-internal.routes"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const swagger_1 = require("./config/swagger");
const error_handler_1 = require("../shared/error-handler");
const UserEventSubscriber_1 = require("./subscribers/UserEventSubscriber");
const auditContext_1 = require("./middlewares/auditContext");
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: config_1.config.corsOrigins.includes('*') ? true : config_1.config.corsOrigins, credentials: true }));
app.use(express_1.default.json());
app.use(auditContext_1.auditContextMiddleware);
app.use('/schedules/internal', schedule_internal_routes_1.default);
app.use('/schedules', schedule_routes_1.default);
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'schedule-service' }));
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
        await (0, UserEventSubscriber_1.startUserEventSubscriber)();
        (0, error_handler_1.setupProcessErrorHandlers)();
        const server = app.listen(config_1.config.port, () => {
            console.log(`Schedule service running on port ${config_1.config.port}`);
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
        console.error('Failed to start schedule-service:', error);
        process.exit(1);
    }
}
start();
