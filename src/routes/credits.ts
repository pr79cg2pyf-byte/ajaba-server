import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb, queryAll, queryOne, execute } from '../db/connection';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

function isoNow(): string { return new Date().toISOString(); }

// ============================================================
// GET /summary — aggregate credit data
// ============================================================
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { store_id } = req.query;
    let filter = store_id ? 'WHERE store_id = ?' : '';
    const params: any[] = store_id ? [store_id] : [];

    const totals = queryOne(db,
      `SELECT COALESCE(SUM(total_claim),0) as total_claimed,
              COALESCE(SUM(CASE WHEN status IN ('approved','credited') THEN total_claim ELSE 0 END),0) as total_approved,
              COALESCE(SUM(CASE WHEN status='credited' THEN total_claim ELSE 0 END),0) as total_credited
       FROM credit_claims ${filter}`, params);

    const bySupplier = queryAll(db,
      `SELECT s.name, COUNT(*) as count, COALESCE(SUM(cc.total_claim),0) as total
       FROM credit_claims cc JOIN suppliers s ON cc.supplier_id = s.supplier_id
       ${filter.replace(/store_id/g, 'cc.store_id')} GROUP BY cc.supplier_id ORDER BY total DESC`, params);

    const byStatus = queryAll(db,
      `SELECT status, COUNT(*) as count, COALESCE(SUM(total_claim),0) as total
       FROM credit_claims ${filter} GROUP BY status`, params);

    res.json({ ...totals, by_supplier: bySupplier, by_status: byStatus });
  } catch (err) {
    console.error('[credits] Summary error:', err);
    res.status(500).json({ error: 'Failed to get summary' });
  }
});

// ============================================================
// GET / — list claims with filters
// ============================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { store_id, supplier_id, status, date_from, date_to, limit } = req.query;
    let sql = 'SELECT cc.*, s.name as supplier_name FROM credit_claims cc JOIN suppliers s ON cc.supplier_id = s.supplier_id WHERE 1=1';
    const params: any[] = [];
    if (store_id) { sql += ' AND cc.store_id = ?'; params.push(store_id); }
    if (supplier_id) { sql += ' AND cc.supplier_id = ?'; params.push(supplier_id); }
    if (status) { sql += ' AND cc.status = ?'; params.push(status); }
    if (date_from) { sql += ' AND cc.discovery_date >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND cc.discovery_date <= ?'; params.push(date_to); }
    sql += ' ORDER BY cc.created_at DESC';
    if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit as string)); }
    const claims = queryAll(db, sql, params);
    res.json({ claims, count: claims.length });
  } catch (err) {
    console.error('[credits] List error:', err);
    res.status(500).json({ error: 'Failed to fetch claims' });
  }
});

// ============================================================
// POST / — create claim
// ============================================================
router.post('/', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const { store_id, supplier_id, agreement_id, product_barcode, product_name, product_department,
            unit_cost, quantity, claim_type, discovery_date, reason } = req.body;

    if (!store_id || !supplier_id || !product_name || !unit_cost || !claim_type) {
      res.status(400).json({ error: 'store_id, supplier_id, product_name, unit_cost, and claim_type are required' }); return;
    }

    // Determine credit_rate from agreement if provided
    let creditRate = 1.0;
    if (agreement_id) {
      const ag = queryOne(db, 'SELECT credit_rate FROM supplier_agreements WHERE agreement_id = ?', [agreement_id]);
      if (ag) creditRate = ag.credit_rate;
    }

    const qty = quantity || 1;
    const totalClaim = unit_cost * qty * creditRate;
    const id = uuidv4();
    const now = isoNow();

    execute(db,
      `INSERT INTO credit_claims (claim_id, store_id, supplier_id, agreement_id, product_barcode, product_name,
        product_department, unit_cost, quantity, total_claim, credit_rate, claim_type, discovery_date, reason, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [id, store_id, supplier_id, agreement_id || null, product_barcode || null, product_name,
       product_department || null, unit_cost, qty, totalClaim, creditRate, claim_type,
       discovery_date || now, reason || null, now, now]
    );

    const claim = queryOne(db,
      'SELECT cc.*, s.name as supplier_name FROM credit_claims cc JOIN suppliers s ON cc.supplier_id = s.supplier_id WHERE cc.claim_id = ?', [id]);
    res.status(201).json({ claim });
  } catch (err) {
    console.error('[credits] Create error:', err);
    res.status(500).json({ error: 'Failed to create claim' });
  }
});

// ============================================================
// GET /:id — claim + history
// ============================================================
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const claim = queryOne(db,
      'SELECT cc.*, s.name as supplier_name FROM credit_claims cc JOIN suppliers s ON cc.supplier_id = s.supplier_id WHERE cc.claim_id = ?',
      [req.params.id]);
    if (!claim) { res.status(404).json({ error: 'Claim not found' }); return; }
    const history = queryAll(db,
      'SELECT ch.*, u.display_name as changed_by_name FROM claim_history ch LEFT JOIN users u ON ch.changed_by = u.user_id WHERE ch.claim_id = ? ORDER BY ch.changed_at DESC',
      [req.params.id]);
    res.json({ claim, history });
  } catch (err) {
    console.error('[credits] Get error:', err);
    res.status(500).json({ error: 'Failed to fetch claim' });
  }
});

// ============================================================
// PATCH /:id — update claim fields
// ============================================================
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const existing = queryOne(db, 'SELECT * FROM credit_claims WHERE claim_id = ?', [req.params.id]);
    if (!existing) { res.status(404).json({ error: 'Claim not found' }); return; }

    const fields = ['status','notes','credit_ref','product_name','unit_cost','quantity','total_claim'];
    const updates: string[] = [];
    const params: any[] = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    }
    if (!updates.length) { res.status(400).json({ error: 'No valid fields' }); return; }
    updates.push('updated_at = ?'); params.push(isoNow());
    params.push(req.params.id);
    execute(db, `UPDATE credit_claims SET ${updates.join(', ')} WHERE claim_id = ?`, params);

    const claim = queryOne(db,
      'SELECT cc.*, s.name as supplier_name FROM credit_claims cc JOIN suppliers s ON cc.supplier_id = s.supplier_id WHERE cc.claim_id = ?', [req.params.id]);
    res.json({ claim });
  } catch (err) {
    console.error('[credits] Update error:', err);
    res.status(500).json({ error: 'Failed to update claim' });
  }
});

// ============================================================
// POST /:id/submit — draft → submitted
// ============================================================
router.post('/:id/submit', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const c = queryOne(db, 'SELECT * FROM credit_claims WHERE claim_id = ?', [req.params.id]);
    if (!c) { res.status(404).json({ error: 'Claim not found' }); return; }
    if (c.status !== 'draft') { res.status(400).json({ error: 'Only draft claims can be submitted' }); return; }
    const now = isoNow();
    execute(db, 'UPDATE credit_claims SET status = ?, submitted_at = ?, submitted_by = ?, updated_at = ? WHERE claim_id = ?',
      ['submitted', now, req.user!.user_id, now, req.params.id]);
    execute(db,
      'INSERT INTO claim_history (history_id, claim_id, changed_by, old_status, new_status, changed_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), req.params.id, req.user!.user_id, 'draft', 'submitted', now]);
    const claim = queryOne(db, 'SELECT cc.*, s.name as supplier_name FROM credit_claims cc JOIN suppliers s ON cc.supplier_id = s.supplier_id WHERE cc.claim_id = ?', [req.params.id]);
    res.json({ claim });
  } catch (err) {
    console.error('[credits] Submit error:', err);
    res.status(500).json({ error: 'Failed to submit claim' });
  }
});

// ============================================================
// POST /:id/approve — submitted → approved
// ============================================================
router.post('/:id/approve', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const c = queryOne(db, 'SELECT * FROM credit_claims WHERE claim_id = ?', [req.params.id]);
    if (!c) { res.status(404).json({ error: 'Claim not found' }); return; }
    if (c.status !== 'submitted') { res.status(400).json({ error: 'Only submitted claims can be approved' }); return; }
    const now = isoNow();
    execute(db, 'UPDATE credit_claims SET status = ?, approved_at = ?, approved_by = ?, updated_at = ? WHERE claim_id = ?',
      ['approved', now, req.user!.user_id, now, req.params.id]);
    execute(db,
      'INSERT INTO claim_history (history_id, claim_id, changed_by, old_status, new_status, changed_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), req.params.id, req.user!.user_id, 'submitted', 'approved', now]);
    const claim = queryOne(db, 'SELECT cc.*, s.name as supplier_name FROM credit_claims cc JOIN suppliers s ON cc.supplier_id = s.supplier_id WHERE cc.claim_id = ?', [req.params.id]);
    res.json({ claim });
  } catch (err) {
    console.error('[credits] Approve error:', err);
    res.status(500).json({ error: 'Failed to approve claim' });
  }
});

// ============================================================
// POST /:id/reject — current → rejected
// ============================================================
router.post('/:id/reject', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const c = queryOne(db, 'SELECT * FROM credit_claims WHERE claim_id = ?', [req.params.id]);
    if (!c) { res.status(404).json({ error: 'Claim not found' }); return; }
    const now = isoNow();
    const reason = req.body.reason || 'No reason provided';
    execute(db, 'UPDATE credit_claims SET status = ?, notes = COALESCE(notes, \'\') || ?, updated_at = ? WHERE claim_id = ?',
      ['rejected', '\n[Rejected: ' + reason + ']', now, req.params.id]);
    execute(db,
      'INSERT INTO claim_history (history_id, claim_id, changed_by, old_status, new_status, notes, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uuidv4(), req.params.id, req.user!.user_id, c.status, 'rejected', reason, now]);
    const claim = queryOne(db, 'SELECT cc.*, s.name as supplier_name FROM credit_claims cc JOIN suppliers s ON cc.supplier_id = s.supplier_id WHERE cc.claim_id = ?', [req.params.id]);
    res.json({ claim });
  } catch (err) {
    console.error('[credits] Reject error:', err);
    res.status(500).json({ error: 'Failed to reject claim' });
  }
});

// ============================================================
// POST /:id/credit — approved → credited
// ============================================================
router.post('/:id/credit', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const c = queryOne(db, 'SELECT * FROM credit_claims WHERE claim_id = ?', [req.params.id]);
    if (!c) { res.status(404).json({ error: 'Claim not found' }); return; }
    if (c.status !== 'approved') { res.status(400).json({ error: 'Only approved claims can be credited' }); return; }
    const now = isoNow();
    execute(db, 'UPDATE credit_claims SET status = ?, credited_at = ?, credit_ref = ?, updated_at = ? WHERE claim_id = ?',
      ['credited', now, req.body.credit_ref || null, now, req.params.id]);
    execute(db,
      'INSERT INTO claim_history (history_id, claim_id, changed_by, old_status, new_status, changed_at) VALUES (?, ?, ?, ?, ?, ?)',
      [uuidv4(), req.params.id, req.user!.user_id, 'approved', 'credited', now]);
    const claim = queryOne(db, 'SELECT cc.*, s.name as supplier_name FROM credit_claims cc JOIN suppliers s ON cc.supplier_id = s.supplier_id WHERE cc.claim_id = ?', [req.params.id]);
    res.json({ claim });
  } catch (err) {
    console.error('[credits] Credit error:', err);
    res.status(500).json({ error: 'Failed to mark as credited' });
  }
});

export default router;
