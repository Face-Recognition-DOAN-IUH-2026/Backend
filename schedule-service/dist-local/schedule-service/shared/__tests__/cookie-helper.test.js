"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cookie_helper_1 = require("../auth/cookie-helper");
function mockRes() {
    const cookies = {};
    const res = {
        req: { secure: false, headers: {} },
        cookie: jest.fn((name, value, opts) => { cookies[name] = { value, opts }; }),
        clearCookie: jest.fn((name, opts) => { delete cookies[name]; }),
    };
    return res;
}
describe('setAuthCookie', () => {
    it('sets httpOnly sameSite=strict cookie with maxAge', () => {
        const res = mockRes();
        (0, cookie_helper_1.setAuthCookie)(res, 'test-token');
        expect(res.cookie).toHaveBeenCalledWith('access_token', 'test-token', {
            httpOnly: true,
            secure: false,
            sameSite: 'strict',
            path: '/',
            maxAge: 86400 * 1000,
        });
    });
    it('sets secure flag when request is over https', () => {
        const res = mockRes();
        res.req.secure = true;
        (0, cookie_helper_1.setAuthCookie)(res, 'test-token');
        expect(res.cookie).toHaveBeenCalledWith('access_token', 'test-token', expect.objectContaining({ secure: true }));
    });
    it('sets secure flag when x-forwarded-proto is https', () => {
        const res = mockRes();
        res.req.headers['x-forwarded-proto'] = 'https';
        (0, cookie_helper_1.setAuthCookie)(res, 'test-token');
        expect(res.cookie).toHaveBeenCalledWith('access_token', 'test-token', expect.objectContaining({ secure: true }));
    });
});
describe('clearAuthCookie', () => {
    it('clears the access_token cookie', () => {
        const res = mockRes();
        (0, cookie_helper_1.clearAuthCookie)(res);
        expect(res.clearCookie).toHaveBeenCalledWith('access_token', {
            httpOnly: true,
            sameSite: 'strict',
            path: '/',
        });
    });
});
