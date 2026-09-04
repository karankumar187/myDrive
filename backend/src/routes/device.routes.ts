import { Router } from 'express';
import { DeviceController } from '../controllers/device.controller.js';
import { requireUserAuth, requireAnyAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', requireAnyAuth, DeviceController.listDevices);
router.get('/my-policy', requireAnyAuth, DeviceController.getMyPolicy);
router.put('/my-policy', requireAnyAuth, DeviceController.updateMyPolicy);
router.post('/register', requireUserAuth, DeviceController.registerDevice);
router.put('/:id/policy', requireAnyAuth, DeviceController.updatePolicy);
router.delete('/:id/revoke', requireUserAuth, DeviceController.revokeDevice);
router.post('/:id/command', requireUserAuth, DeviceController.sendRemoteCommand);

export const deviceRoutes = router;
