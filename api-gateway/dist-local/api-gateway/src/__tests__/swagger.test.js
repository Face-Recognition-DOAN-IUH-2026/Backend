"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supertest_1 = __importDefault(require("supertest"));
const swagger_1 = require("../config/swagger");
function createAppWithSwagger() {
    const app = (0, express_1.default)();
    app.get('/swagger.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(swagger_1.swaggerSpec);
    });
    return app;
}
describe('Swagger Documentation', () => {
    let app;
    beforeAll(() => {
        app = createAppWithSwagger();
    });
    it('should return valid OpenAPI spec JSON', async () => {
        const response = await (0, supertest_1.default)(app).get('/swagger.json');
        expect(response.status).toBe(200);
        expect(response.body.openapi).toBe('3.0.0');
        expect(response.body.info).toBeDefined();
        expect(response.body.info.title).toBeDefined();
    });
    it('should have valid spec structure', async () => {
        const response = await (0, supertest_1.default)(app).get('/swagger.json');
        expect(response.status).toBe(200);
        expect(response.body.paths).toBeDefined();
        expect(response.body.components).toBeDefined();
    });
});
