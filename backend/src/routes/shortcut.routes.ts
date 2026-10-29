import { Router } from 'express';
import express from 'express';
import multer from 'multer';
import { ShortcutController } from '../controllers/shortcut.controller.js';
import { requireDeviceAuth, requireUserAuth } from '../middlewares/auth.middleware.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max per individual Shortcut upload
});

// Middleware for direct binary streaming (when WFHTTPBodyType: File is used)
const rawBinaryParser = express.raw({
  type: (req) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('multipart/form-data') || contentType.includes('application/json')) {
      return false;
    }
    return true; // Parse video/*, image/*, application/octet-stream as raw Buffer
  },
  limit: '500mb',
});

const router = Router();

// iPhone Shortcut endpoints (authenticated with X-Device-Id and X-Device-Key)
router.get('/sync-check', requireDeviceAuth, ShortcutController.syncCheck);
router.post(
  '/upload',
  requireDeviceAuth,
  rawBinaryParser,
  upload.single('media'),
  ShortcutController.uploadFromShortcut
);
router.post('/reconcile-deletions', requireDeviceAuth, ShortcutController.reconcileDeletions);

/**
 * One-tap shortcut installer: generates a pre-configured .shortcut file with credentials baked in.
 * Open this URL on iPhone → iOS prompts to import into Shortcuts app automatically.
 * Auth: Bearer JWT token (from web dashboard session) via ?token= or Authorization header.
 * Query: ?type=auto-sync (default) | upload  — ?deviceName=My+iPhone
 */
router.get('/download-shortcut', requireUserAuth, ShortcutController.downloadShortcut);

export const shortcutRoutes = router;

