"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userController = exports.UserController = void 0;
const services_1 = require("../services");
const AVATAR_MAX_SIZE = 2 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
class UserController {
    async getAll(_req, res) {
        try {
            const result = await services_1.userService.getAllUsers();
            res.json(result);
        }
        catch (error) {
            console.error('Delete User Error:', error);
            res.status(500).json({ error: 'Failed to fetch users' });
        }
    }
    async getById(req, res) {
        try {
            const id = req.params.id;
            if (!id || id === 'undefined') {
                res.status(400).json({ error: 'Invalid user ID' });
                return;
            }
            const user = await services_1.userService.getUserById(id);
            res.json(user);
        }
        catch (error) {
            console.error('Delete User Error:', error);
            res.status(404).json({ error: error.message });
        }
    }
    async getMe(req, res) {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }
            const user = await services_1.userService.getUserById(req.user.userId);
            res.json(user);
        }
        catch (error) {
            console.error('Delete User Error:', error);
            res.status(404).json({ error: error.message });
        }
    }
    async updateProfile(req, res) {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }
            const { full_name, phone, permanent_address } = req.body;
            const result = await services_1.userService.updateProfile(req.user.userId, {
                fullName: full_name,
                phone,
                permanentAddress: permanent_address,
            });
            res.json(result);
        }
        catch (error) {
            console.error('Delete User Error:', error);
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
    async changePassword(req, res) {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }
            const { old_password, new_password } = req.body;
            if (!old_password || !new_password) {
                res.status(400).json({ error: 'Vui long nhap mat khau cu va moi' });
                return;
            }
            if (new_password.length < 6) {
                res.status(400).json({ error: 'Mat khau moi phai it nhat 6 ki tu' });
                return;
            }
            await services_1.userService.changePassword(req.user.userId, old_password, new_password);
            res.json({ message: 'Doi mat khau thanh cong' });
        }
        catch (error) {
            console.error('Delete User Error:', error);
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
    async requestEmailChangeOtp(req, res) {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }
            const { new_email } = req.body;
            if (!new_email) {
                res.status(400).json({ error: 'Vui long nhap email moi' });
                return;
            }
            await services_1.userService.requestEmailChangeOtp(req.user.userId, new_email);
            res.json({ message: 'Da gui ma OTP den email moi' });
        }
        catch (error) {
            console.error('Delete User Error:', error);
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
    async verifyAndChangeEmail(req, res) {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }
            const { new_email, code } = req.body;
            if (!new_email || !code) {
                res.status(400).json({ error: 'Vui long nhap email moi va ma OTP' });
                return;
            }
            await services_1.userService.verifyAndChangeEmail(req.user.userId, new_email, code);
            res.json({ message: 'Doi email thanh cong' });
        }
        catch (error) {
            console.error('Delete User Error:', error);
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
    async delete(req, res) {
        try {
            const id = req.params.id;
            if (!id || id === 'undefined') {
                res.status(400).json({ error: 'Invalid user ID' });
                return;
            }
            const result = await services_1.userService.deleteUser(id);
            res.json(result);
        }
        catch (error) {
            console.error('Delete User Error:', error);
            res.status(error.statusCode || 404).json({ error: error.message });
        }
    }
    async restore(req, res) {
        try {
            const id = req.params.id;
            if (!id || id === 'undefined') {
                res.status(400).json({ error: 'Invalid user ID' });
                return;
            }
            const user = await services_1.userService.restoreUser(id);
            res.json(user);
        }
        catch (error) {
            console.error('Delete User Error:', error);
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
    async adminUpdateUser(req, res) {
        try {
            const id = req.params.id;
            if (!id || id === 'undefined') {
                res.status(400).json({ error: 'Invalid user ID' });
                return;
            }
            const result = await services_1.userService.adminUpdateUser(id, {
                fullName: req.body.full_name,
                phone: req.body.phone,
                studentCode: req.body.student_code,
                className: req.body.class_name,
                identityNumber: req.body.identity_number,
                course: req.body.course,
                permanentAddress: req.body.permanent_address,
                cardNumber: req.body.card_number,
                issueDate: req.body.issue_date,
                membershipExpiry: req.body.membership_expiry,
                role: req.body.role,
                status: req.body.status,
                suspendedReason: req.body.suspended_reason,
                avatarUrl: req.body.avatar_url,
            });
            res.json(result);
        }
        catch (error) {
            console.error('AdminUpdateUser Error:', error);
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
    async updateAccessStatus(req, res) {
        try {
            const id = req.params.id;
            if (!id || id === 'undefined') {
                res.status(400).json({ error: 'Invalid user ID' });
                return;
            }
            const { current_status, currentStatus, camera_id, cameraId } = req.body;
            const nextStatus = current_status ?? currentStatus;
            if (!['inside', 'outside'].includes(nextStatus)) {
                res.status(400).json({ error: 'current_status must be inside or outside' });
                return;
            }
            const user = await services_1.userService.updateAccessStatus(id, nextStatus, camera_id ?? cameraId ?? null);
            res.json(user);
        }
        catch (error) {
            console.error('Delete User Error:', error);
            res.status(error.statusCode || 404).json({ error: error.message });
        }
    }
    async uploadAvatar(req, res) {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }
            const file = req.file;
            if (!file) {
                res.status(400).json({ error: 'Vui l� ch?n file ?nh' });
                return;
            }
            if (!ALLOWED_MIME.includes(file.mimetype)) {
                res.status(400).json({ error: 'Chi ch?p nh?n JPG, PNG ho?c WebP' });
                return;
            }
            if (file.size > AVATAR_MAX_SIZE) {
                res.status(400).json({ error: 'Kich thu?c ?nh t?i �a 2MB' });
                return;
            }
            const avatarUrl = await services_1.userService.updateAvatar(req.user.userId, file.buffer, file.mimetype);
            res.json({ avatarUrl });
        }
        catch (error) {
            console.error('Delete User Error:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Upload avatar that bai' });
        }
    }
    async deleteAvatar(req, res) {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }
            await services_1.userService.deleteAvatar(req.user.userId);
            res.json({ message: 'Xoa avatar thanh cong' });
        }
        catch (error) {
            console.error('Delete User Error:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Xoa avatar that bai' });
        }
    }
}
exports.UserController = UserController;
exports.userController = new UserController();
