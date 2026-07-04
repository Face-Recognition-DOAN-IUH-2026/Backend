import { Router } from 'express';
import { patronController } from '../controllers';
import { createAuth } from '../../shared';
import { requireRole } from '../middlewares/requireRole';
import { config } from '../config';

const auth = createAuth({
  jwtSecret: config.jwtSecret,
  jwtAudience: config.jwtAudience,
  jwtIssuer: config.jwtIssuer,
});

const router = Router();

/**
 * @swagger
 * /patrons/register:
 *   post:
 *     summary: Register a new patron (self-service)
 *     tags: [Patrons]
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
 *               - studentCode
 *             properties:
 *               fullName:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 format: password
 *               studentCode:
 *                 type: string
 *               className:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       201:
 *         description: Patron registered successfully
 *       400:
 *         description: Validation error
 */
router.post('/register', (req, res) => patronController.register(req, res));

/**
 * @swagger
 * /patrons/login:
 *   post:
 *     summary: Authenticate patron and return tokens
 *     tags: [Patrons]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - student_code
 *               - password
 *             properties:
 *               student_code:
 *                 type: string
 *               password:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Login successful, tokens returned
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', (req, res) => patronController.login(req, res));

/**
 * @swagger
 * /patrons/me:
 *   get:
 *     summary: Get current patron profile
 *     tags: [Patrons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current patron profile
 *       401:
 *         description: Unauthorized
 */
router.get('/me', auth, (req, res) => patronController.getMe(req, res));

/**
 * @swagger
 * /patrons/search:
 *   get:
 *     summary: Search patrons by query
 *     tags: [Patrons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search keyword
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by status
 *       - in: query
 *         name: skip
 *         schema:
 *           type: integer
 *         description: Number of records to skip
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Max records to return
 *     responses:
 *       200:
 *         description: Search results
 *       401:
 *         description: Unauthorized
 */
router.get('/search', auth, (req, res) => patronController.search(req, res));

/**
 * @swagger
 * /patrons/lookup:
 *   get:
 *     summary: Lookup patron by student code or card number
 *     tags: [Patrons]
 *     parameters:
 *       - in: query
 *         name: student_code
 *         schema:
 *           type: string
 *         description: Student code
 *       - in: query
 *         name: card_number
 *         schema:
 *           type: string
 *         description: Card number
 *     responses:
 *       200:
 *         description: Patron lookup result
 *       404:
 *         description: Patron not found
 */
router.get('/lookup', (req, res) => patronController.lookup(req, res));

/**
 * @swagger
 * /patrons/check-exists:
 *   post:
 *     summary: Check if student code or email already exists
 *     tags: [Patrons]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               student_code:
 *                 type: string
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: Check result with exists flags
 */
router.post('/check-exists', (req, res) => patronController.checkExists(req, res));

/**
 * @swagger
 * /patrons/check-code/{code}:
 *   get:
 *     summary: Check if a student code already exists
 *     tags: [Patrons]
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Student code to check
 *     responses:
 *       200:
 *         description: Check result
 */
router.get('/check-code/:code', (req, res) => patronController.checkStudentCode(req, res));

/**
 * @swagger
 * /patrons/active:
 *   get:
 *     summary: Get active patrons count or list
 *     tags: [Patrons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active patrons data
 *       401:
 *         description: Unauthorized
 */
router.get('/active', auth, (req, res) => patronController.getActive(req, res));

/**
 * @swagger
 * /patrons/stats:
 *   get:
 *     summary: Get patron statistics
 *     tags: [Patrons]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Patron statistics
 *       401:
 *         description: Unauthorized
 */
router.get('/stats', auth, (req, res) => patronController.getStats(req, res));

/**
 * @swagger
 * /patrons/{id}:
 *   get:
 *     summary: Get patron by ID
 *     tags: [Patrons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Patron ID
 *     responses:
 *       200:
 *         description: Patron details
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Patron not found
 */
router.get('/:id', auth, (req, res) => patronController.getById(req, res));

/**
 * @swagger
 * /patrons:
 *   post:
 *     summary: Create a new patron (admin only)
 *     tags: [Patrons]
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
 *               - studentCode
 *               - className
 *             properties:
 *               fullName:
 *                 type: string
 *               studentCode:
 *                 type: string
 *               className:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               phone:
 *                 type: string
 *               membershipExpiry:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Patron created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post('/', requireRole('admin'), (req, res) => patronController.create(req, res));

/**
 * @swagger
 * /patrons/{id}:
 *   put:
 *     summary: Update patron profile
 *     tags: [Patrons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Patron ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName:
 *                 type: string
 *               phone:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Patron updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Patron not found
 */
router.put('/:id', auth, (req, res) => patronController.update(req, res));

/**
 * @swagger
 * /patrons/{id}/password:
 *   put:
 *     summary: Change patron password
 *     tags: [Patrons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Patron ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 format: password
 *               newPassword:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Password changed
 *       400:
 *         description: Invalid current password
 *       401:
 *         description: Unauthorized
 */
router.put('/:id/password', auth, (req, res) => patronController.changePassword(req, res));

/**
 * @swagger
 * /patrons/{id}/restore:
 *   put:
 *     summary: Restore a soft-deleted patron (admin/staff only)
 *     tags: [Patrons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Patron ID
 *     responses:
 *       200:
 *         description: Patron restored
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Patron not found
 */
router.put('/:id/restore', requireRole('admin', 'staff'), (req, res) => patronController.restore(req, res));

/**
 * @swagger
 * /patrons/{id}/card/suspend:
 *   post:
 *     summary: Suspend patron card (admin/staff only)
 *     tags: [Patrons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Patron ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Card suspended
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Patron not found
 */
router.post('/:id/card/suspend', requireRole('admin', 'staff'), (req, res) => patronController.suspendCard(req, res));

/**
 * @swagger
 * /patrons/{id}/card/renew:
 *   post:
 *     summary: Renew patron card (admin/staff only)
 *     tags: [Patrons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Patron ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               expiryDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Card renewed
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Patron not found
 */
router.post('/:id/card/renew', requireRole('admin', 'staff'), (req, res) => patronController.renewCard(req, res));

/**
 * @swagger
 * /patrons/{id}/card/lost:
 *   post:
 *     summary: Report patron card as lost
 *     tags: [Patrons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Patron ID
 *     responses:
 *       200:
 *         description: Card reported lost
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Patron not found
 */
router.post('/:id/card/lost', auth, (req, res) => patronController.reportLostCard(req, res));

/**
 * @swagger
 * /patrons/{id}:
 *   delete:
 *     summary: Soft-delete a patron (admin only)
 *     tags: [Patrons]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Patron ID
 *     responses:
 *       200:
 *         description: Patron deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Patron not found
 */
router.delete('/:id', requireRole('admin'), (req, res) => patronController.delete(req, res));

export default router;
