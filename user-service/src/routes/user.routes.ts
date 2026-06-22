import { Router } from 'express';
import multer from 'multer';
import { userController } from '../controllers';
import { auth, requireRole } from '../middlewares';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const router = Router();

router.get('/', requireRole('admin'), (req, res) => userController.getAll(req, res));
router.get('/me', auth, (req, res) => userController.getMe(req, res));
router.get('/:id', auth, (req, res) => userController.getById(req, res));
router.put('/:id/access-status', requireRole('admin'), (req, res) => userController.updateAccessStatus(req, res));
router.put('/:id/restore', requireRole('admin'), (req, res) => userController.restore(req, res));
router.delete('/:id', requireRole('admin'), (req, res) => userController.delete(req, res));
router.post('/me/avatar', auth, upload.single('avatar'), (req, res) => userController.uploadAvatar(req, res));
router.delete('/me/avatar', auth, (req, res) => userController.deleteAvatar(req, res));

export default router;
