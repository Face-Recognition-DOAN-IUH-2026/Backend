import { Router } from 'express';
import { userController } from '../controllers/user.controller';

const router = Router();

router.post('/register', (req, res) => userController.register(req, res));
router.post('/login', (req, res) => userController.login(req, res));
router.post('/refresh', (req, res) => userController.refresh(req, res));

export default router;
