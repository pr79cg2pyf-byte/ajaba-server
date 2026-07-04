import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb, queryAll, queryOne, execute } from '../db/connection';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// ============================================================
// GET / — list suppliers
// ============================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { is_active } = req.query;
    let sql = 'SELECT * FROM suppliers WHERE 1=1';
    const params: any[] = [];
    if (is_active !== undefined) { sql += ' AND is_active = ?'; params.push(parseInt(is_active as string)); }
    sql += ' ORDER BY name';
    const suppliers = queryAll(db, sql, params);
    res.json({ suppliers, count: suppliers.length });
  } catch (err) {
    console.error('[suppliers] List error:', err);
    res.status(500).json({ error: 'Failed to fetch suppliers' });
  }
});

// ============================================================
// POST / — create supplier
// ============================================================
router.post('/', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { name, contact_name, contact_email, contact_phone, credit_terms, credit_policy } = req.body;
    if (!name) { res.status(400).json({ error: 'name is required' }); return; }
    const id = uuidv4();
    execute(db,
      `INSERT INTO suppliers (supplier_id, name, contact_name, contact_email, contact_phone, credit_terms, credit_policy)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, name, contact_name || null, contact_email || null, contact_phone || null, credit_terms || null, credit_policy || null]
    );
    const supplier = queryOne(db, 'SELECT * FROM suppliers WHERE supplier_id = ?', [id]);
    res.status(201).json({ supplier });
  } catch (err) {
    console.error('[suppliers] Create error:', err);
    res.status(500).json({ error: 'Failed to create supplier' });
  }
});

// ============================================================
// GET /:id — supplier + agreements
// ============================================================
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const supplier = queryOne(db, 'SELECT * FROM suppliers WHERE supplier_id = ?', [req.params.id]);
    if (!supplier) { res.status(404).json({ error: 'Supplier not found' }); return; }
    const agreements = queryAll(db,
      'SELECT * FROM supplier_agreements WHERE supplier_id = ? AND is_active = 1',
      [req.params.id]
    );
    res.json({ supplier, agreements });
  } catch (err) {
    console.error('[suppliers] Get error:', err);
    res.status(500).json({ error: 'Failed to fetch supplier' });
  }
});

// ============================================================
// PATCH /:id — update supplier
// ============================================================
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const existing = queryOne(db, 'SELECT * FROM suppliers WHERE supplier_id = ?', [req.params.id]);
    if (!existing) { res.status(404).json({ error: 'Supplier not found' }); return; }
    const fields = ['name','contact_name','contact_email','contact_phone','credit_terms','credit_policy','is_active'];
    const updates: string[] = [];
    const params: any[] = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    }
    if (!updates.length) { res.status(400).json({ error: 'No valid fields' }); return; }
    params.push(req.params.id);
    execute(db, `UPDATE suppliers SET ${updates.join(', ')} WHERE supplier_id = ?`, params);
    const supplier = queryOne(db, 'SELECT * FROM suppliers WHERE supplier_id = ?', [req.params.id]);
    res.json({ supplier });
  } catch (err) {
    console.error('[suppliers] Update error:', err);
    res.status(500).json({ error: 'Failed to update supplier' });
  }
});

// ============================================================
// POST /:id/agreements — create agreement
// ============================================================
router.post('/:id/agreements', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const supplier = queryOne(db, 'SELECT * FROM suppliers WHERE supplier_id = ?', [req.params.id]);
    if (!supplier) { res.status(404).json({ error: 'Supplier not found' }); return; }
    const { store_id, department, category, credit_type, credit_rate, shelf_life_threshold, requires_evidence, claim_deadline_days } = req.body;
    if (!store_id || !credit_type || credit_rate === undefined) {
      res.status(400).json({ error: 'store_id, credit_type, and credit_rate are required' }); return;
    }
    const id = uuidv4();
    execute(db,
      `INSERT INTO supplier_agreements (agreement_id, supplier_id, store_id, department, category, credit_type, credit_rate, shelf_life_threshold, requires_evidence, claim_deadline_days)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.params.id, store_id, department || null, category || null, credit_type, credit_rate,
       shelf_life_threshold || null, requires_evidence !== undefined ? requires_evidence : 1, claim_deadline_days || 30]
    );
    const agreement = queryOne(db, 'SELECT * FROM supplier_agreements WHERE agreement_id = ?', [id]);
    res.status(201).json({ agreement });
  } catch (err) {
    console.error('[suppliers] Agreement error:', err);
    res.status(500).json({ error: 'Failed to create agreement' });
  }
});

export default router;
