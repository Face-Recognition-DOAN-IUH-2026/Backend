"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAuthCookie = setAuthCookie;
exports.clearAuthCookie = clearAuthCookie;
const ACCESS_TOKEN_MAX_AGE = 86400;
function setAuthCookie(res, accessToken) {
    const isSecure = res.req.secure || res.req.headers['x-forwarded-proto'] === 'https';
    res.cookie('access_token', accessToken, {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'strict',
        path: '/',
        maxAge: ACCESS_TOKEN_MAX_AGE * 1000,
    });
}
function clearAuthCookie(res) {
    res.clearCookie('access_token', {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
    });
}
