import { Router } from 'express';
import { FileController } from '../controllers/file.controller.js';
import { requireUserAuth, requireAnyAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// Upload flow (supports both Web user JWT and Android/Shortcut Device Key)
router.post('/upload/initiate', requireAnyAuth, FileController.initiateUpload);
router.post('/upload/complete', requireAnyAuth, FileController.completeUpload);

// Virtual files & Gallery
router.get('/', requireUserAuth, FileController.listFiles);
router.get('/gallery', requireUserAuth, FileController.getGallery);
router.get('/:id/stream', requireAnyAuth, FileController.streamFile);

// Soft delete / Recycle bin
router.post('/:id/trash', requireAnyAuth, FileController.moveToTrash);
router.post('/:id/restore', requireUserAuth, FileController.restoreFromTrash);
router.delete('/:id/permanent', requireUserAuth, FileController.permanentDelete);

// Folders
router.get('/folders/list', requireUserAuth, FileController.listFolders);
router.post('/folders/create', requireUserAuth, FileController.createFolder);
router.delete('/folders/:id', requireUserAuth, FileController.deleteFolder);

// Dev mock upload endpoints
router.put('/mock-upload/:fileId', FileController.handleMockUpload);
router.put('/dev-mock-upload-sink', (req, res) => {
  res.status(200).send('OK');
});

export const fileRoutes = router;
