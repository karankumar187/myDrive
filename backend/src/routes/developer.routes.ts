import { Router } from 'express';
import { DeveloperController } from '../controllers/developer.controller.js';
import { requireUserAuth } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/keys', requireUserAuth, DeveloperController.listKeys);
router.post('/keys', requireUserAuth, DeveloperController.createKey);
router.delete('/keys/:id', requireUserAuth, DeveloperController.revokeKey);
router.patch('/cloud-name', requireUserAuth, DeveloperController.updateCloudName);

export const developerRoutes = router;
