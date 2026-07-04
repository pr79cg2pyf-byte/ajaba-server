"use strict";
// Auth routes: login + health check (sql.js version)
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const connection_1 = require("../db/connection");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// GET /api/health
router.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        version: '0.7.0',
        timestamp: new Date().toISOString(),
    });
});
// POST /api/auth/login
router.post('/auth/login', async (req, res) => {
    try {
        const { username, pin } = req.body;
        if (!username || !pin) {
            res.status(400).json({ error: 'username and pin are required' });
            return;
        }
        if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
            res.status(400).json({ error: 'PIN must be exactly 4 digits' });
            return;
        }
        const db = await (0, connection_1.getDb)();
        const user = (0, connection_1.queryOne)(db, 'SELECT * FROM users WHERE username = ? AND is_active = 1', [username]);
        if (!user) {
            // Constant-time dummy compare to prevent username enumeration
            bcryptjs_1.default.compareSync(pin, '$2a$10$invalidhashinvalidhashinvalidhashinvalidhashinvalidhashinvalidhash');
            res.status(401).json({ error: 'Invalid username or PIN' });
            return;
        }
        const pinValid = bcryptjs_1.default.compareSync(pin, user.pin_hash);
        if (!pinValid) {
            res.status(401).json({ error: 'Invalid username or PIN' });
            return;
        }
        const store = (0, connection_1.queryOne)(db, 'SELECT name FROM stores WHERE store_id = ?', [user.store_id]);
        const jwtPayload = {
            user_id: user.user_id,
            username: user.username,
            store_id: user.store_id,
            role: user.role,
        };
        const token = (0, auth_1.signToken)(jwtPayload);
        const userPublic = {
            user_id: user.user_id,
            username: user.username,
            display_name: user.display_name,
            role: user.role,
            store_id: user.store_id,
            store_name: store?.name || null,
        };
        const response = { token, user: userPublic };
        res.json(response);
    }
    catch (err) {
        console.error('[auth] Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/auth/me
router.get('/auth/me', auth_1.requireAuth, async (req, res) => {
    try {
        const db = await (0, connection_1.getDb)();
        const user = (0, connection_1.queryOne)(db, 'SELECT * FROM users WHERE user_id = ? AND is_active = 1', [req.user.user_id]);
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        const store = (0, connection_1.queryOne)(db, 'SELECT name FROM stores WHERE store_id = ?', [user.store_id]);
        const userPublic = {
            user_id: user.user_id,
            username: user.username,
            display_name: user.display_name,
            role: user.role,
            store_id: user.store_id,
            store_name: store?.name || null,
        };
        res.json({ user: userPublic });
    }
    catch (err) {
        console.error('[auth] Me error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map