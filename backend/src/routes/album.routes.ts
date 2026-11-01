import { Router } from 'express';
import { AlbumController } from '../controllers/album.controller.js';
import { requireAnyAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// List albums & get smart auto-detection suggestions
router.get('/', requireAnyAuth, AlbumController.listAlbums);
router.get('/suggestions', requireAnyAuth, AlbumController.suggestTrips);

// Create new album
router.post('/', requireAnyAuth, AlbumController.createAlbum);

// Get single album details
router.get('/:id', requireAnyAuth, AlbumController.getAlbum);

// Update album metadata
router.patch('/:id', requireAnyAuth, AlbumController.updateAlbum);
router.put('/:id', requireAnyAuth, AlbumController.updateAlbum);

// Add / remove photos
router.post('/:id/photos', requireAnyAuth, AlbumController.addPhotos);
router.delete('/:id/photos', requireAnyAuth, AlbumController.removePhotos);

// Delete album
router.delete('/:id', requireAnyAuth, AlbumController.deleteAlbum);

export const albumRoutes = router;
