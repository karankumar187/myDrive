import { Router } from 'express';
import multer from 'multer';
import { ShortcutController } from '../controllers/shortcut.controller.js';
import { requireDeviceAuth } from '../middlewares/auth.middleware.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max per individual Shortcut upload
});

const router = Router();

// iPhone Shortcut endpoints (authenticated with X-Device-Id and X-Device-Key)
router.get('/sync-check', requireDeviceAuth, ShortcutController.syncCheck);
router.post('/upload', requireDeviceAuth, upload.single('media'), ShortcutController.uploadFromShortcut);
router.post('/reconcile-deletions', requireDeviceAuth, ShortcutController.reconcileDeletions);

export const shortcutRoutes = router;
