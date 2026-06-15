import { Router } from 'express';
import { userController } from '../controllers';
import { auth, requireRole } from '../middlewares';

const router = Router();

router.get('/', requireRole('admin'), (req, res) => userController.getAll(req, res));
router.get('/me', auth, (req, res) => userController.getMe(req, res));
router.get('/:id', auth, (req, res) => userController.getById(req, res));
router.put('/:id/access-status', requireRole('admin'), (req, res) => userController.updateAccessStatus(req, res));
router.delete('/:id', requireRole('admin'), (req, res) => userController.delete(req, res));

export default router;
