import { Router } from 'express';
import { StorageController } from '../controllers/storage.controller.js';
import { requireUserAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// Storage pool metrics & account listing
router.get('/summary', requireUserAuth, StorageController.getPoolSummary);
router.get('/accounts', requireUserAuth, StorageController.listAccounts);

// OAuth linking for Google Drive accounts
router.get('/connect/url', requireUserAuth, StorageController.getConnectUrl);
router.get('/connect/callback', StorageController.connectCallback);

// Account operations
router.post('/accounts/:id/sync', requireUserAuth, StorageController.syncAccount);
router.delete('/accounts/:id', requireUserAuth, StorageController.removeAccount);

// Dev simulation helper
router.post('/dev-add-account', requireUserAuth, StorageController.devAddAccount);

export const storageRoutes = router;
