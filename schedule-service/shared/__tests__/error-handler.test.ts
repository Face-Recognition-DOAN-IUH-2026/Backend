import { setupProcessErrorHandlers } from '../../../shared/error-handler';

jest.mock('../../../shared/jira-client', () => ({
  createJiraBug: jest.fn().mockResolvedValue({ key: 'TEST-1' }),
}));

describe('setupProcessErrorHandlers', () => {
  let originalUncaught: any[];
  let originalRejection: any[];

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
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    setupProcessErrorHandlers();

    const handler = process.listeners('uncaughtException')[0] as (...args: any[]) => void;
    handler(new Error('test uncaught'));

    await new Promise((r) => setTimeout(r, 100));

    expect(createJiraBug).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it('should call process.exit(1) after unhandledRejection', async () => {
    const { createJiraBug } = require('../jira-client');
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    setupProcessErrorHandlers();

    const handler = process.listeners('unhandledRejection')[0] as (...args: any[]) => void;
    handler(new Error('test unhandled'), Promise.resolve());

    await new Promise((r) => setTimeout(r, 100));

    expect(createJiraBug).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it('should call process.exit(1) even when createJiraBug rejects', async () => {
    const { createJiraBug } = require('../jira-client');
    createJiraBug.mockRejectedValueOnce(new Error('Jira down'));
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    setupProcessErrorHandlers();

    const handler = process.listeners('unhandledRejection')[0] as (...args: any[]) => void;
    handler(new Error('test rejection'), Promise.resolve());

    await new Promise((r) => setTimeout(r, 100));

    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});
