import { Router } from 'express';
import { userController } from '../controllers/user.controller';

const router = Router();

router.post('/register', (req, res) => userController.register(req, res));
router.post('/login', (req, res) => userController.login(req, res));
router.get('/me', (req, res) => userController.getMe(req, res));
router.get('/', (req, res) => userController.getAll(req, res));
router.delete('/:id', (req, res) => userController.delete(req, res));

export default router;