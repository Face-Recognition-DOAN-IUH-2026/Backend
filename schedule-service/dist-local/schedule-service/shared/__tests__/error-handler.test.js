"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const error_handler_1 = require("../error-handler");
jest.mock('../jira-client', () => ({
    createJiraBug: jest.fn().mockResolvedValue({ key: 'TEST-1' }),
}));
describe('setupProcessErrorHandlers', () => {
    let originalUncaught;
    let originalRejection;
    beforeEach(() => {
        originalUncaught = process.listeners('uncaughtException').slice();
        originalRejection = process.listeners('unhandledRejection').slice();
        process.removeAllListeners('uncaughtException');
        process.removeAllListeners('unhandledRejection');
    });
    afterEach(() => {
        process.removeAllListeners('uncaughtException');
        process.removeAllListeners('unhandledRejection');
        originalUncaught.forEach((l) => process.on('uncaughtException', l));
        originalRejection.forEach((l) => process.on('unhandledRejection', l));
    });
    it('should call process.exit(1) after uncaughtException', async () => {
        const { createJiraBug } = require('../jira-client');
        const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => { }));
        (0, error_handler_1.setupProcessErrorHandlers)();
        const handler = process.listeners('uncaughtException')[0];
        handler(new Error('test uncaught'));
        await new Promise((r) => setTimeout(r, 100));
        expect(createJiraBug).toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(1);
        exitSpy.mockRestore();
    });
    it('should call process.exit(1) after unhandledRejection', async () => {
        const { createJiraBug } = require('../jira-client');
        const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => { }));
        (0, error_handler_1.setupProcessErrorHandlers)();
        const handler = process.listeners('unhandledRejection')[0];
        handler(new Error('test unhandled'), Promise.resolve());
        await new Promise((r) => setTimeout(r, 100));
        expect(createJiraBug).toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(1);
        exitSpy.mockRestore();
    });
    it('should call process.exit(1) even when createJiraBug rejects', async () => {
        const { createJiraBug } = require('../jira-client');
        createJiraBug.mockRejectedValueOnce(new Error('Jira down'));
        const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => { }));
        (0, error_handler_1.setupProcessErrorHandlers)();
        const handler = process.listeners('unhandledRejection')[0];
        handler(new Error('test rejection'), Promise.resolve());
        await new Promise((r) => setTimeout(r, 100));
        expect(exitSpy).toHaveBeenCalledWith(1);
        exitSpy.mockRestore();
    });
});
