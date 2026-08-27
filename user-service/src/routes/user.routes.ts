import { Router } from 'express';
import multer from 'multer';
import { userController } from '../controllers';
import { createAuth } from '../../../shared/auth';
import { requireRole } from '../middlewares/requireRole';
import { config } from '../config';

const auth = createAuth({
  jwtSecret: config.jwtSecret,
  jwtAudience: config.jwtAudience,
  jwtIssuer: config.jwtIssuer,
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = Router();

/**
 * @swagger
 * /users:
 *   get:
 *     summary: Get all users (admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Items per page
 *     responses:
 *       200:
 *         description: List of users
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get('/', requireRole('admin'), (req, res) => userController.getAll(req, res));

/**
 * @swagger
 * /users/me:
 *   get:
 *     summary: Get current authenticated user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 *       401:
 *         description: Unauthorized
 */
router.get('/me', auth, (req, res) => userController.getMe(req, res));

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     summary: Get user by ID
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: User details
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.get('/:id', auth, (req, res) => userController.getById(req, res));

/**
 * @swagger
 * /users/{id}/access-status:
 *   put:
 *     summary: Update user access status (admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, suspended, inactive]
 *     responses:
 *       200:
 *         description: Access status updated
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: User not found
 */
router.put('/:id/access-status', requireRole('admin'), (req, res) => userController.updateAccessStatus(req, res));

/**
 * @swagger
 * /users/{id}:
 *   put:
 *     summary: Admin update user info (admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               full_name:
 *                 type: string
 *               phone:
 *                 type: string
 *               student_code:
 *                 type: string
 *               class_name:
 *                 type: string
 *               identity_number:
 *                 type: string
 *               course:
 *                 type: string
 *               permanent_address:
 *                 type: string
 *               card_number:
 *                 type: string
 *               issue_date:
 *                 type: string
 *                 format: date
 *               membership_expiry:
 *                 type: string
 *                 format: date
 *               role:
 *                 type: string
 *                 enum: [patron, staff, admin]
 *               status:
 *                 type: string
 *                 enum: [active, suspended, inactive]
 *               suspended_reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: User updated
 *       400:
 *         description: Validation error
 *       404:
 *         description: User not found
 */
router.put('/:id', requireRole('admin'), (req, res) => userController.adminUpdateUser(req, res));

/**
 * @swagger
 * /users/{id}/restore:
 *   put:
 *     summary: Restore a soft-deleted user (admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: User restored
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: User not found
 */
router.put('/:id/restore', requireRole('admin'), (req, res) => userController.restore(req, res));

/**
 * @swagger
 * /users/{id}:
 *   delete:
 *     summary: Soft-delete a user (admin only)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *     responses:
 *       200:
 *         description: User deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: User not found
 */
router.delete('/:id', requireRole('admin'), (req, res) => userController.delete(req, res));

/**
 * @swagger
 * /users/me/avatar:
 *   post:
 *     summary: Upload current user avatar
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - avatar
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Avatar uploaded successfully
 *       400:
 *         description: Invalid file
 *       401:
 *         description: Unauthorized
 */
router.post('/me/avatar', auth, upload.single('avatar'), (req, res) => userController.uploadAvatar(req, res));

/**
 * @swagger
 * /users/me/avatar:
 *   delete:
 *     summary: Delete current user avatar
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Avatar deleted
 *       401:
 *         description: Unauthorized
 */
router.delete('/me/avatar', auth, (req, res) => userController.deleteAvatar(req, res));

/**
 * @swagger
 * /users/me/profile:
 *   put:
 *     summary: Update current user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               full_name:
 *                 type: string
 *               phone:
 *                 type: string
 *               permanent_address:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       401:
 *         description: Unauthorized
 */
router.put('/me/profile', auth, (req, res) => userController.updateProfile(req, res));

/**
 * @swagger
 * /users/me/password:
 *   put:
 *     summary: Change current user password
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - old_password
 *               - new_password
 *             properties:
 *               old_password:
 *                 type: string
 *               new_password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         description: Invalid input or incorrect old password
 *       401:
 *         description: Unauthorized
 */
router.put('/me/password', auth, (req, res) => userController.changePassword(req, res));

/**
 * @swagger
 * /users/me/email/request-otp:
 *   post:
 *     summary: Request OTP to change email
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - new_email
 *             properties:
 *               new_email:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP sent
 *       400:
 *         description: Email already in use or invalid
 *       401:
 *         description: Unauthorized
 */
router.post('/me/email/request-otp', auth, (req, res) => userController.requestEmailChangeOtp(req, res));

/**
 * @swagger
 * /users/me/email:
 *   put:
 *     summary: Verify OTP and change email
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - new_email
 *               - code
 *             properties:
 *               new_email:
 *                 type: string
 *               code:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email changed successfully
 *       400:
 *         description: Invalid OTP or email
 *       401:
 *         description: Unauthorized
 */
router.put('/me/email', auth, (req, res) => userController.verifyAndChangeEmail(req, res));

export default router;