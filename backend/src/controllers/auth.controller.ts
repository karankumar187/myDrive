import { Request, Response } from 'express';
import passport from 'passport';
import { generateUserJwt } from '../config/passport.js';
import { User } from '../models/User.js';

export class AuthController {
  /**
   * Triggers Passport Google OAuth flow for App User Authentication.
   */
  static googleLogin = (req: Request, res: Response, next: any) => {
    const rawOrigin = (req.query.client_url as string) || req.headers.referer || '';
    let targetClientOrigin = '';
    if (rawOrigin) {
      try {
        targetClientOrigin = new URL(rawOrigin).origin;
      } catch {
        targetClientOrigin = rawOrigin;
      }
    }

    const state = targetClientOrigin ? Buffer.from(JSON.stringify({ clientUrl: targetClientOrigin })).toString('base64url') : undefined;

    passport.authenticate('google', {
      scope: ['openid', 'profile', 'email'],
      session: false,
      prompt: 'select_account',
      state,
    })(req, res, next);
  };

  /**
   * Google OAuth Callback handler. Issues JWT session and redirects to Web Client.
   */
  static googleCallback(req: Request, res: Response): void {
    passport.authenticate('google', { session: false }, (err: any, user: any) => {
      let clientUrl = (process.env.CLIENT_URL || 'https://mydrive-frontend.karan9302451907.workers.dev').split(',')[0].trim();

      // Check if original frontend origin was passed in state
      if (req.query.state) {
        try {
          const decodedState = JSON.parse(Buffer.from(req.query.state as string, 'base64url').toString('utf8'));
          if (decodedState.clientUrl) {
            clientUrl = decodedState.clientUrl;
          }
        } catch {}
      }

      if (err || !user) {
        return res.redirect(`${clientUrl}/?error=auth_failed`);
      }

      const token = generateUserJwt(user);

      // Redirect to web app with JWT token in URL query
      res.redirect(`${clientUrl}/?token=${token}`);
    })(req, res);
  }

  /**
   * Returns current authenticated user profile.
   */
  static async getCurrentUser(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      res.json({
        user: {
          id: req.user._id,
          name: req.user.name,
          email: req.user.email,
          avatarUrl: req.user.avatarUrl,
          role: req.user.role,
          masterKeySalt: req.user.masterKeySalt,
          hasEncryptedVault: !!req.user.encryptedVaultKey,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Updates user's client-side zero-knowledge vault credentials (salt and wrapped key).
   */
  static async updateVaultKeys(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const { masterKeySalt, encryptedVaultKey } = req.body;

      if (!masterKeySalt || !encryptedVaultKey) {
        res.status(400).json({ error: 'masterKeySalt and encryptedVaultKey are required' });
        return;
      }

      req.user.masterKeySalt = masterKeySalt;
      req.user.encryptedVaultKey = encryptedVaultKey;
      await req.user.save();

      res.json({ success: true, message: 'Zero-knowledge vault credentials stored securely' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
