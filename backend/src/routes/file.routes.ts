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

// Soft delete / Recycle bin
router.post('/:id/trash', requireAnyAuth, FileController.moveToTrash);
router.post('/:id/restore', requireUserAuth, FileController.restoreFromTrash);
router.delete('/:id/permanent', requireUserAuth, FileController.permanentDelete);

// Folders
router.get('/folders/list', requireAnyAuth, FileController.listFolders);
router.post('/folders/create', requireAnyAuth, FileController.createFolder);
router.delete('/folders/:id', requireUserAuth, FileController.deleteFolder);

export const fileRoutes = router;
