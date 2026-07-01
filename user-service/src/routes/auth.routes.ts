import { Router } from 'express';
import { authController } from '../controllers';
import { requireRole } from '../middlewares/requireRole';
import { createAuth } from '../../../shared/auth';

const router = Router();

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new user (admin/staff only)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fullName
 *               - email
 *               - password
 *               - role
 *             properties:
 *               fullName:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 format: password
 *               role:
 *                 type: string
 *                 enum: [admin, staff, patron]
 *               studentCode:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post('/register', requireRole('admin', 'staff'), (req, res) => authController.register(req, res));

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Authenticate user and return tokens
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Login successful, tokens returned
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', (req, res) => authController.login(req, res));

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Refresh access token using refresh token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: New access token returned
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post('/refresh', (req, res) => authController.refresh(req, res));

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout and clear auth cookie
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
router.post('/logout', (req, res) => authController.logout(req, res));

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Send password reset code to email
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Reset code sent if email exists
 *       404:
 *         description: Email not found
 */
router.post('/forgot-password', (req, res) => authController.forgotPassword(req, res));

/**
 * @swagger
 * /auth/verify-reset-code:
 *   post:
 *     summary: Verify password reset code
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - code
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               code:
 *                 type: string
 *     responses:
 *       200:
 *         description: Code verified successfully
 *       400:
 *         description: Invalid or expired code
 */
router.post('/verify-reset-code', (req, res) => authController.verifyResetCode(req, res));

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Reset password with verified code
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - code
 *               - newPassword
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               code:
 *                 type: string
 *               newPassword:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Invalid or expired code
 */
router.post('/reset-password', (req, res) => authController.resetPassword(req, res));

/**
 * @swagger
 * /auth/verify-email:
 *   post:
 *     summary: Verify email with OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - code
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               code:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email verified successfully
 *       400:
 *         description: Invalid or expired code
 */
router.post('/verify-email', (req, res) => authController.verifyEmail(req, res));

/**
 * @swagger
 * /auth/resend-verification:
 *   post:
 *     summary: Resend email verification code
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Verification code sent
 *       400:
 *         description: Account already verified or email not found
 */
router.post('/resend-verification', (req, res) => authController.resendVerification(req, res));

/**
 * @swagger
 * /auth/correct-email/request-otp:
 *   post:
 *     summary: Request OTP to change email for unverified account
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - current_email
 *               - new_email
 *             properties:
 *               current_email:
 *                 type: string
 *                 format: email
 *               new_email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: OTP sent to new email
 *       400:
 *         description: Invalid request
 */
router.post('/correct-email/request-otp', (req, res) => authController.requestEmailCorrection(req, res));

/**
 * @swagger
 * /auth/correct-email/verify:
 *   post:
 *     summary: Verify OTP and change email for unverified account
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - current_email
 *               - new_email
 *               - code
 *             properties:
 *               current_email:
 *                 type: string
 *                 format: email
 *               new_email:
 *                 type: string
 *                 format: email
 *               code:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email changed and account verified
 *       400:
 *         description: Invalid OTP or email
 */
router.post('/correct-email/verify', (req, res) => authController.verifyEmailCorrection(req, res));

/**
 * @swagger
 * /auth/pre-register-otp:
 *   post:
 *     summary: Send OTP for pre-registration email verification
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: OTP sent
 *       400:
 *         description: Email already registered or invalid
 */
router.post('/pre-register-otp', (req, res) => authController.preRegisterOtp(req, res));

/**
 * @swagger
 * /auth/pre-register-verify:
 *   post:
 *     summary: Verify OTP and get verification token for registration
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - code
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               code:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP verified, returns verification token
 *       400:
 *         description: Invalid or expired OTP
 */
router.post('/pre-register-verify', (req, res) => authController.preRegisterVerify(req, res));

export default router;