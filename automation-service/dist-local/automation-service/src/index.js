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
const automation_routes_1 = __importDefault(require("./routes/automation.routes"));
const internal_routes_1 = __importDefault(require("./routes/internal.routes"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const swagger_1 = require("./config/swagger");
const error_handler_1 = require("../shared/error-handler");
const CronScheduler_1 = require("./scheduler/CronScheduler");
const EventBus_1 = require("./events/EventBus");
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: config_1.config.corsOrigins.includes('*') ? true : config_1.config.corsOrigins, credentials: true }));
app.use(express_1.default.json({ limit: '1mb' }));
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'automation-service' }));
app.use('/automation', automation_routes_1.default);
app.use('/internal', internal_routes_1.default);
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
        console.log('Database connected');
        // Connect event bus
        await EventBus_1.eventBus.connect();
        // Start cron scheduler
        await CronScheduler_1.cronScheduler.start();
        (0, error_handler_1.setupProcessErrorHandlers)();
        app.listen(config_1.config.port, () => {
            console.log(`Automation service running on port ${config_1.config.port}`);
        });
    }
    catch (error) {
        console.error('Failed to start automation-service:', error);
        process.exit(1);
    }
}
// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down...');
    await CronScheduler_1.cronScheduler.stop();
    process.exit(0);
});
start();
