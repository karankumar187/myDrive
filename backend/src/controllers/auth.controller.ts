import { Request, Response } from 'express';
import passport from 'passport';
import { generateUserJwt } from '../config/passport.js';
import { User } from '../models/User.js';

export class AuthController {
  /**
   * Triggers Passport Google OAuth flow for App User Authentication.
   */
  static googleLogin = passport.authenticate('google', {
    scope: ['openid', 'profile', 'email'],
    session: false,
    prompt: 'select_account',
  });

  /**
   * Google OAuth Callback handler. Issues JWT session and redirects to Web Client.
   */
  static googleCallback(req: Request, res: Response): void {
    passport.authenticate('google', { session: false }, (err: any, user: any) => {
      const clientUrl = (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();
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

  /**
   * Developer login helper: enables instant local testing without setting up Google Cloud OAuth keys.
   */
  static async devLogin(req: Request, res: Response): Promise<void> {
    try {
      const email = (req.body.email || 'developer@drive.local').toLowerCase();
      let user = await User.findOne({ email });

      if (!user) {
        user = await User.create({
          googleProfileId: `dev_${Date.now()}`,
          email,
          name: req.body.name || 'Developer User',
          role: 'owner',
        });
      }

      const token = generateUserJwt(user);
      res.json({
        success: true,
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
}
