// Auth routes: login + health check (sql.js version)

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { getDb, queryOne } from '../db/connection';
import { signToken, requireAuth } from '../middleware/auth';
import { LoginRequest, LoginResponse, UserPublic, JwtPayload } from '../types';

const router = Router();

// GET /api/health
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version: '0.7.0',
    timestamp: new Date().toISOString(),
  });
});

// POST /api/auth/login
router.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { username, pin } = req.body as LoginRequest;

    if (!username || !pin) {
      res.status(400).json({ error: 'username and pin are required' });
      return;
    }

    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      res.status(400).json({ error: 'PIN must be exactly 4 digits' });
      return;
    }

    const db = await getDb();
    const user = queryOne(db,
      'SELECT * FROM users WHERE username = ? AND is_active = 1',
      [username]
    );

    if (!user) {
      // Constant-time dummy compare to prevent username enumeration
      bcrypt.compareSync(pin, '$2a$10$invalidhashinvalidhashinvalidhashinvalidhashinvalidhashinvalidhash');
      res.status(401).json({ error: 'Invalid username or PIN' });
      return;
    }

    const pinValid = bcrypt.compareSync(pin, user.pin_hash);

    if (!pinValid) {
      res.status(401).json({ error: 'Invalid username or PIN' });
      return;
    }

    const store = queryOne(db,
      'SELECT name FROM stores WHERE store_id = ?',
      [user.store_id]
    );

    const jwtPayload: JwtPayload = {
      user_id: user.user_id,
      username: user.username,
      store_id: user.store_id,
      role: user.role,
    };

    const token = signToken(jwtPayload);

    const userPublic: UserPublic = {
      user_id: user.user_id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      store_id: user.store_id,
      store_name: store?.name || null,
    };

    const response: LoginResponse = { token, user: userPublic };
    res.json(response);
  } catch (err) {
    console.error('[auth] Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/auth/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const user = queryOne(db,
      'SELECT * FROM users WHERE user_id = ? AND is_active = 1',
      [req.user!.user_id]
    );

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const store = queryOne(db,
      'SELECT name FROM stores WHERE store_id = ?',
      [user.store_id]
    );

    const userPublic: UserPublic = {
      user_id: user.user_id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      store_id: user.store_id,
      store_name: store?.name || null,
    };

    res.json({ user: userPublic });
  } catch (err) {
    console.error('[auth] Me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
