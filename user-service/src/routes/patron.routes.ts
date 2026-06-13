import { Router } from 'express';
import { patronController } from '../controllers';
import { auth, requireRole } from '../middlewares';

const router = Router();

router.post('/register', (req, res) => patronController.register(req, res));
router.post('/login', (req, res) => patronController.login(req, res));
router.get('/search', auth, (req, res) => patronController.search(req, res));
router.get('/lookup', (req, res) => patronController.lookup(req, res));
router.get('/active', auth, (req, res) => patronController.getActive(req, res));
router.get('/stats', auth, (req, res) => patronController.getStats(req, res));
router.get('/:id', auth, (req, res) => patronController.getById(req, res));
router.post('/', requireRole('admin'), (req, res) => patronController.create(req, res));
router.put('/:id', auth, (req, res) => patronController.update(req, res));
router.delete('/:id', requireRole('admin'), (req, res) => patronController.delete(req, res));

export default router;
