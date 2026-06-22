import { Router } from 'express';
import { authController } from '../controllers';
import { requireRole } from '../middlewares';

const router = Router();

router.post('/register', requireRole('admin', 'staff'), (req, res) => authController.register(req, res));
router.post('/login', (req, res) => authController.login(req, res));
router.post('/refresh', (req, res) => authController.refresh(req, res));
router.post('/forgot-password', (req, res) => authController.forgotPassword(req, res));
router.post('/verify-reset-code', (req, res) => authController.verifyResetCode(req, res));
router.post('/reset-password', (req, res) => authController.resetPassword(req, res));

export default router;
