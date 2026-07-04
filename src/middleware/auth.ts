// JWT authentication middleware

import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { JwtPayload } from '../types';

// In production, this should be an environment variable
const JWT_SECRET = process.env.JWT_SECRET || 'ajaba-dev-secret-change-in-production';
const JWT_EXPIRES_IN = '12h';

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

// Express middleware — attach user to request or return 401
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7); // Remove "Bearer "

  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired', details: 'Please log in again' });
    } else {
      res.status(401).json({ error: 'Invalid token' });
    }
  }
}
