import { Router } from 'express';
import { DeviceController } from '../controllers/device.controller.js';
import { requireUserAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', requireUserAuth, DeviceController.listDevices);
router.post('/register', requireUserAuth, DeviceController.registerDevice);
router.put('/:id/policy', requireUserAuth, DeviceController.updatePolicy);
router.delete('/:id/revoke', requireUserAuth, DeviceController.revokeDevice);
router.post('/:id/command', requireUserAuth, DeviceController.sendRemoteCommand);

export const deviceRoutes = router;
