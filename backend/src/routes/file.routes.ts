import { Router, Request, Response } from 'express';
import { FileController } from '../controllers/file.controller.js';
import { requireUserAuth, requireAnyAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// Upload flow (supports both Web user JWT and Android/Shortcut Device Key)
router.post('/upload/initiate', requireAnyAuth, FileController.initiateUpload);
router.post('/upload/complete', requireAnyAuth, FileController.completeUpload);

// Virtual files & Gallery
router.get('/', requireAnyAuth, FileController.listFiles);
router.get('/gallery', requireAnyAuth, FileController.getGallery);
router.get('/:id/stream', requireAnyAuth, FileController.streamFile);
router.get('/:id/thumbnail', requireAnyAuth, FileController.streamThumbnail);
router.get('/:id/gdrive-url', requireAnyAuth, FileController.getDirectStreamUrl);

// File management & Gallery interactions
router.patch('/:id/favorite', requireAnyAuth, FileController.toggleFavorite);
router.post('/:id/favorite', requireAnyAuth, FileController.toggleFavorite);
router.patch('/:id/rename', requireAnyAuth, FileController.renameFile);
router.post('/:id/rename', requireAnyAuth, FileController.renameFile);
router.patch('/:id/move', requireAnyAuth, FileController.moveFile);
router.post('/:id/move', requireAnyAuth, FileController.moveFile);
router.post('/bulk', requireAnyAuth, FileController.bulkAction);
router.post('/deduplicate', requireAnyAuth, FileController.deduplicateFiles);

// Soft delete / Recycle bin
router.post('/trash/empty', requireAnyAuth, FileController.emptyTrash);
router.post('/trash/restore-all', requireAnyAuth, FileController.restoreAllFromTrash);
router.post('/:id/trash', requireAnyAuth, FileController.moveToTrash);
router.post('/:id/restore', requireAnyAuth, FileController.restoreFromTrash);
router.delete('/:id/permanent', requireAnyAuth, FileController.permanentDelete);

// Folders
router.get('/folders/list', requireAnyAuth, FileController.listFolders);
router.post('/folders/create', requireAnyAuth, FileController.createFolder);
router.patch('/folders/:id/rename', requireAnyAuth, FileController.renameFolder);
router.post('/folders/:id/rename', requireAnyAuth, FileController.renameFolder);
router.delete('/folders/:id', requireAnyAuth, FileController.deleteFolder);

// Per-device upload history and inbound sync
router.get('/device/:deviceId/uploads', requireAnyAuth, FileController.listFilesByDevice);
router.get('/device/:deviceId/inbound-sync', requireAnyAuth, FileController.listInboundSyncFiles);
router.post('/device/:deviceId/mark-synced', requireAnyAuth, FileController.markFileSyncedLocally);

export const fileRoutes = router;
