import { setupProcessErrorHandlers, errorHandler } from '../error-handler';

jest.mock('../jira-client', () => ({
  createJiraBug: jest.fn().mockResolvedValue({ key: 'TEST-1' }),
}));

let res: { status: any; json: any };

function mockResponse() {
  res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

describe('errorHandler', () => {
  beforeEach(() => {
    mockResponse();
  });

  it('should return 400 for ZodError', () => {
    const issues = [{ path: ['email'], message: 'Invalid email' }];
    const zodError = { name: 'ZodError', issues, message: 'Validation failed' };
    const req = { method: 'POST', path: '/test' } as any;

    errorHandler(zodError, req, res as any, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation Error',
      detail: issues,
    });
  });

  it('should return 400 for ZodError with errors fallback', () => {
    const zodError = { name: 'ZodError', errors: [{ message: 'Required' }], message: 'Validation failed' };
    const req = { method: 'POST', path: '/test' } as any;

    errorHandler(zodError, req, res as any, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation Error',
      detail: [{ message: 'Required' }],
    });
  });

  it('should return 400 with standard ZodError when issues/errors absent', () => {
    const zodError = { name: 'ZodError', message: 'Validation failed' };
    const req = { method: 'POST', path: '/test' } as any;

    errorHandler(zodError, req, res as any, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation Error',
      detail: [{ message: 'Validation failed' }],
    });
  });

  it('should return original status for non-Zod errors', () => {
    const httpError = { statusCode: 404, message: 'Not found' };
    const req = { method: 'GET', path: '/test' } as any;

    errorHandler(httpError, req, res as any, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should return 500 for unknown errors', () => {
    const unknownError = new Error('Something broke');
    const req = { method: 'GET', path: '/test' } as any;

    errorHandler(unknownError, req, res as any, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('should return generic message on 5xx without leaking infrastructure details', () => {
    const infraError = new Error('connect ECONNREFUSED 10.0.0.5:5432 on query SELECT * FROM users');
    const req = { method: 'GET', path: '/users', body: {} } as any;

    errorHandler(infraError, req, res as any, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
    expect(res.json).not.toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('ECONNREFUSED') })
    );
  });

  it('should keep 4xx error messages in the response body', () => {
    const notFound = { statusCode: 404, message: 'Not found' };
    const req = { method: 'GET', path: '/books/42', body: {} } as any;

    errorHandler(notFound, req, res as any, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found', detail: undefined });
  });

  it('should redact "pass" field from Jira request body payload', () => {
    const { createJiraBug } = require('../jira-client');
    (createJiraBug as jest.Mock).mockClear();

    const err = new Error('SMTP auth failed');
    (err as any).statusCode = 500;
    const req = {
      method: 'PUT',
      path: '/borrow/admin/settings/smtp',
      body: { pass: 'super-secret-smtp-pass', host: 'smtp.gmail.com' },
    } as any;

    errorHandler(err, req, res as any, jest.fn());

    expect(createJiraBug).toHaveBeenCalledTimes(1);
    const params = (createJiraBug as jest.Mock).mock.calls[0][0];
    expect(params.requestBody).toContain('***REDACTED***');
    expect(params.requestBody).not.toContain('super-secret-smtp-pass');
    expect(params.requestBody).toContain('smtp.gmail.com');
  });
});

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
