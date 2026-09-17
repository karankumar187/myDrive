import { Router } from 'express';
import multer from 'multer';
import { MediaController } from '../controllers/media.controller.js';
import { requireMediaOrUserAuth } from '../middlewares/api-key.middleware.js';

const router = Router();

// Multer memory storage for direct processing & streaming
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500 MB limit for media
  },
});

// Programmatic & Web Upload endpoints
router.post('/upload', requireMediaOrUserAuth, upload.single('file'), MediaController.uploadMedia);

// List & manage media assets
router.get('/', requireMediaOrUserAuth, MediaController.listMedia);
router.delete('/:publicId(*)', requireMediaOrUserAuth, MediaController.deleteMedia);
router.patch('/:publicId(*)/tags', requireMediaOrUserAuth, MediaController.updateTags);

// Cloudinary-style on-the-fly transformation path delivery
// e.g. /media/image/upload/w_300,h_300,c_fill,f_webp/folder/my-banner.jpg
router.get('/image/upload/:transformations*/:publicId(*)', MediaController.deliverMedia);

// Direct media delivery with optional query params (?w=300&h=300&c=fill)
// e.g. /media/folder/my-banner.jpg or /media/my-banner
router.get('/:publicId(*)', MediaController.deliverMedia);

export const mediaRoutes = router;
