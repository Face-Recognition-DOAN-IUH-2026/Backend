"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.patronController = exports.PatronController = void 0;
const services_1 = require("../services");
class PatronController {
    async register(req, res) {
        try {
            const { student_code, password, full_name, class_name, course, permanent_address, email, verification_token } = req.body;
            if (!student_code || !password || !full_name) {
                res.status(400).json({ error: 'student_code, password, and full_name are required' });
                return;
            }
            const authService = (await Promise.resolve().then(() => __importStar(require('../services')))).authService;
            const result = await authService.register({
                email: email || `${student_code}@library.local`,
                password,
                fullName: full_name,
                role: 'patron',
                studentCode: student_code,
                className: class_name,
                course,
                permanentAddress: permanent_address,
                verificationToken: verification_token,
            });
            res.status(201).json(result);
        }
        catch (error) {
            res.status(error.statusCode || 400).json({ error: error.message || 'Registration failed' });
        }
    }
    async getMe(req, res) {
        try {
            if (!req.user) {
                res.status(401).json({ error: 'Not authenticated' });
                return;
            }
            const patron = await services_1.patronService.getById(req.user.userId);
            res.json(patron);
        }
        catch (error) {
            res.status(404).json({ error: error.message });
        }
    }
    async login(req, res) {
        try {
            const { student_code, password } = req.body;
            if (!student_code || !password) {
                res.status(400).json({ error: 'student_code and password are required' });
                return;
            }
            const authService = (await Promise.resolve().then(() => __importStar(require('../services')))).authService;
            const result = await authService.login({ studentCode: student_code, password });
            res.json(result);
        }
        catch (error) {
            res.status(error.statusCode || 401).json({ error: error.message || 'Login failed' });
        }
    }
    async checkExists(req, res) {
        try {
            const { student_code, email } = req.body;
            if (!student_code && !email) {
                res.status(400).json({ error: 'student_code or email is required' });
                return;
            }
            const result = await services_1.patronService.checkExists(student_code, email);
            res.json(result);
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to check existence' });
        }
    }
    async checkStudentCode(req, res) {
        try {
            const code = req.params.code || req.query.code;
            if (!code) {
                res.status(400).json({ error: 'Student code is required' });
                return;
            }
            const exists = await services_1.patronService.checkStudentCode(code);
            res.json({ exists });
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to check student code' });
        }
    }
    async search(req, res) {
        try {
            const q = req.query.q;
            const status = req.query.status;
            const skip = parseInt(req.query.skip) || 0;
            const limit = Math.min(parseInt(req.query.limit) || 20, 100);
            const result = await services_1.patronService.search(q, status, skip, limit);
            res.json(result);
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to search patrons' });
        }
    }
    async lookup(req, res) {
        try {
            const studentCode = req.query.student_code;
            const cardNumber = req.query.card_number;
            const result = await services_1.patronService.lookup(studentCode, cardNumber);
            res.json(result);
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to lookup patron' });
        }
    }
    async getById(req, res) {
        try {
            const id = req.params.id;
            if (!id || id === 'undefined') {
                res.status(400).json({ error: 'Invalid patron ID' });
                return;
            }
            const patron = await services_1.patronService.getById(id);
            res.json(patron);
        }
        catch (error) {
            res.status(404).json({ error: error.message });
        }
    }
    async create(req, res) {
        try {
            const { full_name, student_code, class_name, course, permanent_address, membership_expiry, issue_date, identity_number, email, phone } = req.body;
            if (!full_name || !student_code || !membership_expiry) {
                res.status(400).json({ error: 'full_name, student_code, and membership_expiry are required' });
                return;
            }
            const patron = await services_1.patronService.create({
                fullName: full_name,
                studentCode: student_code,
                className: class_name,
                course,
                permanentAddress: permanent_address,
                membershipExpiry: membership_expiry,
                issueDate: issue_date,
                identityNumber: identity_number,
                email,
                phone,
            });
            res.status(201).json(patron);
        }
        catch (error) {
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
    async update(req, res) {
        try {
            const id = req.params.id;
            if (!id || id === 'undefined') {
                res.status(400).json({ error: 'Invalid patron ID' });
                return;
            }
            const { full_name, class_name, course, permanent_address, identity_number, email, phone, membership_expiry, status, } = req.body;
            const patron = await services_1.patronService.update(id, {
                fullName: full_name,
                className: class_name,
                course,
                permanentAddress: permanent_address,
                identityNumber: identity_number,
                email,
                phone,
                membershipExpiry: membership_expiry,
                status,
            });
            res.json(patron);
        }
        catch (error) {
            res.status(error.statusCode || 404).json({ error: error.message });
        }
    }
    async delete(req, res) {
        try {
            const id = req.params.id;
            if (!id || id === 'undefined') {
                res.status(400).json({ error: 'Invalid patron ID' });
                return;
            }
            const result = await services_1.patronService.deletePatron(id);
            res.json(result);
        }
        catch (error) {
            res.status(error.statusCode || 404).json({ error: error.message });
        }
    }
    async getActive(_req, res) {
        try {
            const patrons = await services_1.patronService.getActivePatrons();
            res.json({ items: patrons, total: patrons.length });
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to fetch active patrons' });
        }
    }
    async getStats(_req, res) {
        try {
            const stats = await services_1.patronService.getStats();
            res.json(stats);
        }
        catch (error) {
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    }
    async changePassword(req, res) {
        try {
            const id = req.params.id;
            if (!id || id === 'undefined') {
                res.status(400).json({ error: 'Invalid patron ID' });
                return;
            }
            const currentUser = req.user;
            if (!currentUser) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }
            const isAdminOrStaff = currentUser.role === 'admin' || currentUser.role === 'staff';
            if (currentUser.userId !== id && !isAdminOrStaff) {
                res.status(403).json({ error: 'You can only change your own password' });
                return;
            }
            const { current_password, new_password } = req.body;
            if (!new_password || new_password.length < 6) {
                res.status(400).json({ error: 'New password must be at least 6 characters' });
                return;
            }
            await services_1.patronService.changePassword(id, current_password ?? null, new_password);
            res.json({ success: true, message: 'Password changed successfully' });
        }
        catch (error) {
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
    async restore(req, res) {
        try {
            const id = req.params.id;
            if (!id || id === 'undefined') {
                res.status(400).json({ error: 'Invalid patron ID' });
                return;
            }
            const patron = await services_1.patronService.restorePatron(id);
            res.json(patron);
        }
        catch (error) {
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
    async suspendCard(req, res) {
        try {
            const id = req.params.id;
            if (!id || id === 'undefined') {
                res.status(400).json({ error: 'Invalid patron ID' });
                return;
            }
            const { reason } = req.body;
            if (!reason) {
                res.status(400).json({ error: 'Suspension reason is required' });
                return;
            }
            const patron = await services_1.patronService.suspendCard(id, reason);
            res.json(patron);
        }
        catch (error) {
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
    async renewCard(req, res) {
        try {
            const id = req.params.id;
            if (!id || id === 'undefined') {
                res.status(400).json({ error: 'Invalid patron ID' });
                return;
            }
            const patron = await services_1.patronService.renewCard(id);
            res.json(patron);
        }
        catch (error) {
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
    async reportLostCard(req, res) {
        try {
            const id = req.params.id;
            if (!id || id === 'undefined') {
                res.status(400).json({ error: 'Invalid patron ID' });
                return;
            }
            const patron = await services_1.patronService.reportLostCard(id);
            res.json(patron);
        }
        catch (error) {
            res.status(error.statusCode || 400).json({ error: error.message });
        }
    }
}
exports.PatronController = PatronController;
exports.patronController = new PatronController();
