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
const routes_1 = require("./routes");
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const swagger_1 = require("./config/swagger");
const errorHandler_1 = require("./middlewares/errorHandler");
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: config_1.config.corsOrigins, credentials: true }));
app.use(express_1.default.json());
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'user-service' });
});
app.use('/auth', routes_1.authRoutes);
app.use('/users', routes_1.userRoutes);
app.use('/patrons', routes_1.patronRoutes);
app.use('/internal', routes_1.internalRoutes);
if (config_1.config.nodeEnv !== 'production') {
    app.get('/api-docs/swagger.json', (_req, res) => {
        res.json(swagger_1.swaggerSpec);
    });
    app.use('/api-docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swagger_1.swaggerSpec));
}
app.use(errorHandler_1.errorHandler);
async function start() {
    try {
        await data_source_1.AppDataSource.initialize();
        console.log('Database initialized via TypeORM');
        const { startAmqpSubscriber } = require('./subscribers/AmqpSubscriber');
        startAmqpSubscriber().catch((e) => console.error('[AMQP] Subscriber error:', e.message));
        const server = app.listen(config_1.config.port, () => {
            console.log(`User service running on port ${config_1.config.port}`);
            console.log(`Environment: ${config_1.config.nodeEnv}`);
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
        console.error('Failed to start:', error);
        process.exit(1);
    }
}
start();
