import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ApiKey } from '../models/ApiKey.js';
import { User } from '../models/User.js';
import { CryptoService } from '../services/crypto.service.js';
import { IApiKeyDocument, IUserDocument } from '../types/index.js';

// Extend Express Request to carry verified API Key
declare global {
  namespace Express {
    interface Request {
      apiKey?: IApiKeyDocument;
    }
  }
}

interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

/**
 * Extracts API Key and Secret from request headers, Authorization header, or query parameters.
 */
export function extractApiCredentials(req: Request): { key: string | null; secret: string | null } {
  // 1. Explicit headers
  const headerKey = (req.headers['x-api-key'] as string) || null;
  const headerSecret = (req.headers['x-api-secret'] as string) || null;
  if (headerKey && headerSecret) {
    return { key: headerKey.trim(), secret: headerSecret.trim() };
  }

  // 2. Authorization header: Basic base64(key:secret) or Bearer key:secret
  const authHeader = req.headers.authorization;
  if (authHeader) {
    if (authHeader.startsWith('Basic ')) {
      const credentials = Buffer.from(authHeader.substring(6), 'base64').toString('utf-8');
      const [key, secret] = credentials.split(':');
      if (key && secret) return { key: key.trim(), secret: secret.trim() };
    } else if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      if (token.includes(':')) {
        const [key, secret] = token.split(':');
        return { key: key.trim(), secret: secret.trim() };
      }
    }
  }

  // 3. Query parameters (useful for streaming / embedding)
  const queryKey = (req.query.api_key as string) || (req.query.apiKey as string) || null;
  const querySecret = (req.query.api_secret as string) || (req.query.apiSecret as string) || null;
  if (queryKey && querySecret) {
    return { key: queryKey.trim(), secret: querySecret.trim() };
  }

  return { key: headerKey || queryKey, secret: headerSecret || querySecret };
}

/**
 * Middleware: Strictly requires valid developer API Key & Secret credentials.
 */
export async function requireApiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { key, secret } = extractApiCredentials(req);

    if (!key || !secret) {
      res.status(401).json({
        error: 'Developer API key authentication required. Please provide X-API-Key and X-API-Secret headers.',
      });
      return;
    }

    const apiKeyDoc = await ApiKey.findOne({ apiKey: key });
    if (!apiKeyDoc || !apiKeyDoc.isActive) {
      res.status(401).json({ error: 'Invalid, revoked, or inactive API key.' });
      return;
    }

    // Verify secret hash
    const secretHash = CryptoService.hashSecret(secret);
    if (secretHash !== apiKeyDoc.apiSecretHash) {
      res.status(401).json({ error: 'Invalid API secret provided.' });
      return;
    }

    const user = await User.findById(apiKeyDoc.userId);
    if (!user) {
      res.status(401).json({ error: 'Owner account associated with this API key not found.' });
      return;
    }

    // Background update usage statistics
    apiKeyDoc.lastUsedAt = new Date();
    apiKeyDoc.requestCount += 1;
    apiKeyDoc.save().catch(() => {});

    req.user = user;
    req.apiKey = apiKeyDoc;
    next();
  } catch (error: any) {
    res.status(500).json({ error: 'Error verifying API key: ' + error.message });
  }
}

/**
 * Middleware: Accepts EITHER Developer API Key OR Web User JWT token.
 * Enables both programmatic external webapps and the user dashboard to call media endpoints.
 */
export async function requireMediaOrUserAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { key } = extractApiCredentials(req);
  if (key) {
    return requireApiKeyAuth(req, res, next);
  }

  // Fallback to standard User JWT check
  try {
    const authHeader = req.headers.authorization;
    const token =
      (authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null) ||
      (req.query.token as string) ||
      null;

    if (!token) {
      res.status(401).json({
        error: 'Authentication required. Provide valid JWT Bearer token or X-API-Key / X-API-Secret headers.',
      });
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
