import { Router } from 'express';
import multer from 'multer';
import { ShortcutController } from '../controllers/shortcut.controller.js';
import { requireDeviceAuth, requireUserAuth } from '../middlewares/auth.middleware.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max per individual Shortcut upload
});

const router = Router();

// iPhone Shortcut endpoints (authenticated with X-Device-Id and X-Device-Key)
router.get('/sync-check', requireDeviceAuth, ShortcutController.syncCheck);
router.post('/upload', requireDeviceAuth, upload.single('media'), ShortcutController.uploadFromShortcut);
router.post('/reconcile-deletions', requireDeviceAuth, ShortcutController.reconcileDeletions);

/**
 * One-tap shortcut installer: generates a pre-configured .shortcut file with credentials baked in.
 * Open this URL on iPhone → iOS prompts to import into Shortcuts app automatically.
 * Auth: Bearer JWT token (from web dashboard session) via ?token= or Authorization header.
 * Query: ?type=auto-sync (default) | upload  — ?deviceName=My+iPhone
 */
router.get('/download-shortcut', requireUserAuth, ShortcutController.downloadShortcut);

export const shortcutRoutes = router;

