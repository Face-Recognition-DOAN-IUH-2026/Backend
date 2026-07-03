"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authController = exports.AuthController = void 0;
const services_1 = require("../services");
class AuthController {
    async register(req, res) {
        try {
            const { email, password, full_name, role, student_code, skip_verification } = req.body;
            if (!email || !password) {
                res.status(400).json({ error: 'Email and password are required' });
                return;
            }
            const result = await services_1.authService.register({
                email,
                password,
                fullName: full_name,
                role: role || 'user',
                studentCode: student_code,
                skipVerification: skip_verification,
            });
            res.status(201).json(result);
        }
        catch (error) {
            res.status(error.statusCode || 400).json({ error: error.message || 'Registration failed' });
        }
    }
    async login(req, res) {
        try {
            const { email, student_code, password } = req.body;
            if (!password || (!email && !student_code)) {
                res.status(400).json({ error: 'Email/student_code and password are required' });
                return;
            }
            const result = await services_1.authService.login({
                email,
                studentCode: student_code,
                password,
            });
            res.json(result);
        }
        catch (error) {
            res.status(error.statusCode || 401).json({ error: error.message || 'Login failed' });
        }
    }
    async getMe(req, res) {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader?.startsWith('Bearer ')) {
                res.status(401).json({ error: 'No token provided' });
                return;
            }
            const token = authHeader.split(' ')[1];
            const payload = services_1.authService.verifyToken(token, 'access');
            const user = await services_1.authService.getUserById(payload.userId);
            res.json(user);
        }
        catch (error) {
            res.status(401).json({ error: 'Invalid token' });
        }
    }
    async refresh(req, res) {
        try {
            const { refresh_token } = req.body;
            if (!refresh_token) {
                res.status(400).json({ error: 'refresh_token required' });
                return;
            }
            const result = await services_1.authService.refreshToken(refresh_token);
            res.json(result);
        }
        catch (error) {
            res.status(401).json({ error: 'Invalid refresh token' });
        }
    }
    async forgotPassword(req, res) {
        try {
            const { email } = req.body;
            if (!email) {
                res.status(400).json({ error: 'Email la bat buoc' });
                return;
            }
            await services_1.authService.forgotPassword(email);
            res.json({ message: 'Da gui ma reset qua email' });
        }
        catch (error) {
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
    async verifyResetCode(req, res) {
        try {
            const { email, code } = req.body;
            if (!email || !code) {
                res.status(400).json({ error: 'Email va ma reset la bat buoc' });
                return;
            }
            const isValid = await services_1.authService.verifyResetCode(email, code);
            if (!isValid) {
                res.status(400).json({ error: 'Ma reset khong hop le hoac da het han' });
                return;
            }
            res.json({ valid: true });
        }
        catch (error) {
            res.status(400).json({ error: error.message });
        }
    }
    async resetPassword(req, res) {
        try {
            const { email, code, new_password } = req.body;
            if (!email || !code || !new_password) {
                res.status(400).json({ error: 'Email, ma reset, va mat khau moi la bat buoc' });
                return;
            }
            if (new_password.length < 6) {
                res.status(400).json({ error: 'Mat khau moi phai it nhat 6 ki tu' });
                return;
            }
            await services_1.authService.resetPassword(email, code, new_password);
            res.json({ message: 'Dat lai mat khau thanh cong' });
        }
        catch (error) {
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
    async verifyEmail(req, res) {
        try {
            const { email, code } = req.body;
            if (!email || !code) {
                res.status(400).json({ error: 'Email va ma xac thuc la bat buoc' });
                return;
            }
            await services_1.authService.verifyEmail(email, code);
            res.json({ message: 'Xac thuc email thanh cong' });
        }
        catch (error) {
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
    async resendVerification(req, res) {
        try {
            const { email } = req.body;
            if (!email) {
                res.status(400).json({ error: 'Email la bat buoc' });
                return;
            }
            await services_1.authService.resendVerificationEmail(email);
            res.json({ message: 'Da gui ma xac thuc moi' });
        }
        catch (error) {
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
    async requestEmailCorrection(req, res) {
        try {
            const { current_email, new_email } = req.body;
            if (!current_email || !new_email) {
                res.status(400).json({ error: 'current_email va new_email la bat buoc' });
                return;
            }
            await services_1.authService.requestEmailCorrection(current_email, new_email);
            res.json({ message: 'Da gui ma OTP den email moi' });
        }
        catch (error) {
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
    async verifyEmailCorrection(req, res) {
        try {
            const { current_email, new_email, code } = req.body;
            if (!current_email || !new_email || !code) {
                res.status(400).json({ error: 'current_email, new_email, va code la bat buoc' });
                return;
            }
            await services_1.authService.verifyEmailAndCorrect(current_email, new_email, code);
            res.json({ message: 'Doi email va xac thuc thanh cong' });
        }
        catch (error) {
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
    async preRegisterOtp(req, res) {
        try {
            const { email } = req.body;
            if (!email) {
                res.status(400).json({ error: 'Email la bat buoc' });
                return;
            }
            await services_1.authService.sendPreRegisterOtp(email);
            res.json({ message: 'Da gui ma OTP qua email' });
        }
        catch (error) {
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
    async preRegisterVerify(req, res) {
        try {
            const { email, code } = req.body;
            if (!email || !code) {
                res.status(400).json({ error: 'Email va ma OTP la bat buoc' });
                return;
            }
            const token = await services_1.authService.verifyPreRegisterOtp(email, code);
            res.json({ verification_token: token });
        }
        catch (error) {
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
}
exports.AuthController = AuthController;
exports.authController = new AuthController();
