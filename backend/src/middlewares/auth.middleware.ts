import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { Device } from '../models/Device.js';
import { CryptoService } from '../services/crypto.service.js';
import { IUserDocument, IDeviceDocument } from '../types/index.js';

// Extend Express User and Request to carry verified user and device contexts
declare global {
  namespace Express {
    interface User extends IUserDocument {}
    interface Request {
      device?: IDeviceDocument;
    }
  }
}

interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

/**
 * Middleware: Strictly requires an authenticated Web User via JWT.
 * Mitigates IDOR by populating req.user._id used in all subsequent database queries.
 */
export async function requireUserAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const token =
      (authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null) ||
      (req.query.token as string) ||
      null;

    if (!token) {
      res.status(401).json({ error: 'Authentication required. No token provided.' });
      return;
    }

    const secret = process.env.JWT_SECRET || 'fallback_secret_key_drive';
    const decoded = jwt.verify(token, secret) as JwtPayload;

    const user = await User.findById(decoded.userId);
    if (!user) {
      res.status(401).json({ error: 'User session invalid or account does not exist.' });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

/**
 * Middleware: Requires an authorized physical Device (Android background agent or iPhone Shortcut).
 * Validates X-Device-Id and X-Device-Key against hashed database records.
 */
export async function requireDeviceAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const deviceId = (req.headers['x-device-id'] as string) || (req.query.deviceId as string);
    const deviceKey =
      (req.headers['x-device-key'] as string) ||
      (req.query.deviceKey as string) ||
      (req.query.token as string) ||
      (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null);

    if (!deviceId || !deviceKey) {
      res.status(401).json({ error: 'Device authentication required. Missing deviceId or deviceKey.' });
      return;
    }

    const keyHash = CryptoService.hashSecret(deviceKey);
    const device = await Device.findOne({ deviceId, apiKeyHash: keyHash });

    if (!device) {
      res.status(401).json({ error: 'Invalid device credentials. Device not recognized.' });
      return;
    }

    // Load user associated with this device
    const user = await User.findById(device.userId);
    if (!user) {
      res.status(401).json({ error: 'Device owner account not found.' });
      return;
    }

    // Update device last-seen timestamp
    device.lastSeenAt = new Date();
    device.status = 'online';
    await device.save();

    req.user = user;
    req.device = device;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Error during device authentication.' });
  }
}

/**
 * Middleware: Accepts either User JWT or Device Key.
 * Useful for shared endpoints like file upload and metadata inspection.
 */
export async function requireAnyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const hasDeviceAuth =
    req.headers['x-device-id'] ||
    req.headers['x-device-key'] ||
    req.query.deviceId ||
    req.query.deviceKey;

  if (hasDeviceAuth) {
    return requireDeviceAuth(req, res, next);
  }

  return requireUserAuth(req, res, next);
}
