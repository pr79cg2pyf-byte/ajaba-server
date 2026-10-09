"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const connection_1 = require("../db/connection");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
// ============================================================
// GET / — list suppliers
// ============================================================
router.get('/', async (req, res) => {
    try {
        const db = await (0, connection_1.getDb)();
        const { is_active } = req.query;
        let sql = 'SELECT * FROM suppliers WHERE 1=1';
        const params = [];
        if (is_active !== undefined) {
            sql += ' AND is_active = ?';
            params.push(parseInt(is_active));
        }
        sql += ' ORDER BY name';
        const suppliers = (0, connection_1.queryAll)(db, sql, params);
        res.json({ suppliers, count: suppliers.length });
    }
    catch (err) {
        console.error('[suppliers] List error:', err);
        res.status(500).json({ error: 'Failed to fetch suppliers' });
    }
});
// ============================================================
// POST / — create supplier
// ============================================================
router.post('/', async (req, res) => {
    try {
        const db = await (0, connection_1.getDb)();
        const { name, contact_name, contact_email, contact_phone, credit_terms, credit_policy } = req.body;
        if (!name) {
            res.status(400).json({ error: 'name is required' });
            return;
        }
        const id = (0, uuid_1.v4)();
        (0, connection_1.execute)(db, `INSERT INTO suppliers (supplier_id, name, contact_name, contact_email, contact_phone, credit_terms, credit_policy)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, name, contact_name || null, contact_email || null, contact_phone || null, credit_terms || null, credit_policy || null]);
        const supplier = (0, connection_1.queryOne)(db, 'SELECT * FROM suppliers WHERE supplier_id = ?', [id]);
        res.status(201).json({ supplier });
    }
    catch (err) {
        console.error('[suppliers] Create error:', err);
        res.status(500).json({ error: 'Failed to create supplier' });
    }
});
// ============================================================
// GET /:id — supplier + agreements
// ============================================================
router.get('/:id', async (req, res) => {
    try {
        const db = await (0, connection_1.getDb)();
        const supplier = (0, connection_1.queryOne)(db, 'SELECT * FROM suppliers WHERE supplier_id = ?', [req.params.id]);
        if (!supplier) {
            res.status(404).json({ error: 'Supplier not found' });
            return;
        }
        const agreements = (0, connection_1.queryAll)(db, 'SELECT * FROM supplier_agreements WHERE supplier_id = ? AND is_active = 1', [req.params.id]);
        res.json({ supplier, agreements });
    }
    catch (err) {
        console.error('[suppliers] Get error:', err);
        res.status(500).json({ error: 'Failed to fetch supplier' });
    }
});
// ============================================================
// PATCH /:id — update supplier
// ============================================================
router.patch('/:id', async (req, res) => {
    try {
        const db = await (0, connection_1.getDb)();
        const existing = (0, connection_1.queryOne)(db, 'SELECT * FROM suppliers WHERE supplier_id = ?', [req.params.id]);
        if (!existing) {
            res.status(404).json({ error: 'Supplier not found' });
            return;
        }
        const fields = ['name', 'contact_name', 'contact_email', 'contact_phone', 'credit_terms', 'credit_policy', 'is_active'];
        const updates = [];
        const params = [];
        for (const f of fields) {
            if (req.body[f] !== undefined) {
                updates.push(`${f} = ?`);
                params.push(req.body[f]);
            }
        }
        if (!updates.length) {
            res.status(400).json({ error: 'No valid fields' });
            return;
        }
        params.push(req.params.id);
        (0, connection_1.execute)(db, `UPDATE suppliers SET ${updates.join(', ')} WHERE supplier_id = ?`, params);
        const supplier = (0, connection_1.queryOne)(db, 'SELECT * FROM suppliers WHERE supplier_id = ?', [req.params.id]);
        res.json({ supplier });
    }
    catch (err) {
        console.error('[suppliers] Update error:', err);
        res.status(500).json({ error: 'Failed to update supplier' });
    }
});
// ============================================================
// POST /:id/agreements — create agreement
// ============================================================
router.post('/:id/agreements', async (req, res) => {
    try {
        const db = await (0, connection_1.getDb)();
        const supplier = (0, connection_1.queryOne)(db, 'SELECT * FROM suppliers WHERE supplier_id = ?', [req.params.id]);
        if (!supplier) {
            res.status(404).json({ error: 'Supplier not found' });
            return;
        }
        const { store_id, department, category, credit_type, credit_rate, shelf_life_threshold, requires_evidence, claim_deadline_days } = req.body;
        if (!store_id || !credit_type || credit_rate === undefined) {
            res.status(400).json({ error: 'store_id, credit_type, and credit_rate are required' });
            return;
        }
        const id = (0, uuid_1.v4)();
        (0, connection_1.execute)(db, `INSERT INTO supplier_agreements (agreement_id, supplier_id, store_id, department, category, credit_type, credit_rate, shelf_life_threshold, requires_evidence, claim_deadline_days)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, req.params.id, store_id, department || null, category || null, credit_type, credit_rate,
            shelf_life_threshold || null, requires_evidence !== undefined ? requires_evidence : 1, claim_deadline_days || 30]);
        const agreement = (0, connection_1.queryOne)(db, 'SELECT * FROM supplier_agreements WHERE agreement_id = ?', [id]);
        res.status(201).json({ agreement });
    }
    catch (err) {
        console.error('[suppliers] Agreement error:', err);
        res.status(500).json({ error: 'Failed to create agreement' });
    }
});
exports.default = router;
//# sourceMappingURL=suppliers.js.map