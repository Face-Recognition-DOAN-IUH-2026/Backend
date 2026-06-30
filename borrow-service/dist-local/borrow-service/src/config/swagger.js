"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.swaggerSpec = void 0;
const swagger_jsdoc_1 = __importDefault(require("swagger-jsdoc"));
const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'borrow-service API',
            version: '1.0.0',
            description: 'API documentation for Borrow Service — book borrowing, reservations, and library management',
        },
        servers: [
            { url: '/', description: 'Local' },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
            schemas: {
                Error: {
                    type: 'object',
                    properties: {
                        statusCode: { type: 'number', example: 400 },
                        message: { type: 'string', example: 'Bad request error message' },
                        error: { type: 'string', example: 'Bad Request' },
                    },
                },
            },
        },
        security: [{ bearerAuth: [] }],
    },
    apis: ['./src/routes/*.ts'],
};
exports.swaggerSpec = (0, swagger_jsdoc_1.default)(options);
