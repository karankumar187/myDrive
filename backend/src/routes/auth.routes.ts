import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { requireUserAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// Passport Google User Login
router.get('/google', AuthController.googleLogin);
router.get('/google/callback', AuthController.googleCallback);

// Profile and Vault
router.get('/me', requireUserAuth, AuthController.getCurrentUser);
router.post('/vault/keys', requireUserAuth, AuthController.updateVaultKeys);

export const authRoutes = router;
