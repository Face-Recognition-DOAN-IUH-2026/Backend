import { Router } from 'express';
import { authController } from '../controllers';
import { requireRole } from '../middlewares';

const router = Router();

router.post('/register', requireRole('admin', 'staff'), (req, res) => authController.register(req, res));
router.post('/login', (req, res) => authController.login(req, res));
router.post('/refresh', (req, res) => authController.refresh(req, res));
router.post('/logout', (req, res) => authController.logout(req, res));

export default router;
