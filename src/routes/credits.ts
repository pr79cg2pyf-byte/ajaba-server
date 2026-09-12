import { Router, Request, Response, RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { Database } from 'sql.js';
import { getDb, queryAll, queryOne, durableWrite } from '../db/connection';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

class CreditError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function endpoint(handler: (req: Request, res: Response, db: Database) => void): RequestHandler {
  return async (req, res) => {
    try {
      const db = await getDb();
      const current = queryOne(db, 'SELECT store_id,role,is_active FROM users WHERE user_id = ?', [req.user!.user_id]);
      if (!current?.is_active || current.store_id !== req.user!.store_id || current.role !== req.user!.role) {
        throw new CreditError(401, 'Account or store access changed. Please sign in again.');
      }
      handler(req, res, db);
    } catch (error) {
      if (error instanceof CreditError) res.status(error.status).json({ error: error.message });
      else res.status(500).json({ error: 'Credit request could not be saved or loaded. Please retry.' });
    }
  };
}
function storeScope(req: Request): string {
  const requested = req.query.store_id ?? req.body?.store_id ?? req.user!.store_id;
  if (typeof requested !== 'string' || !requested.trim()) throw new CreditError(400, 'A valid store is required.');
  if (requested !== req.user!.store_id && req.user!.role !== 'owner') throw new CreditError(403, 'This account cannot access another store.');
  return requested;
}
const claimSelect = 'SELECT cc.*, s.name as supplier_name FROM credit_claims cc JOIN suppliers s ON cc.supplier_id = s.supplier_id';
function claimById(db: Database, id: string) { return queryOne(db, `${claimSelect} WHERE cc.claim_id = ?`, [id]); }
function scopedClaim(db: Database, req: Request) {
  const scope = storeScope(req);
  const claim = claimById(db, req.params.id);
  if (!claim) throw new CreditError(404, 'Claim not found.');
  if (claim.store_id !== scope) throw new CreditError(403, 'This claim belongs to another store.');
  return claim;
}
function managerOnly(req: Request) {
  if (!['owner', 'manager'].includes(req.user!.role)) throw new CreditError(403, 'Manager or owner authority is required.');
}
function text(value: unknown, label: string, required = false, max = 2000): string | null {
  if (value === undefined || value === null) {
    if (required) throw new CreditError(400, `${label} is required.`);
    return null;
  }
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new CreditError(400, `${label} is invalid.`);
  return value.trim() || null;
}
function amount(value: unknown, label: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || (integer && (!Number.isInteger(value) || value > 1_000_000))) {
    throw new CreditError(400, `${label} must be a positive ${integer ? 'whole number' : 'finite number'}.`);
  }
  return value;
}
function total(cost: number, quantity: number, rate: number): number {
  const value = cost * quantity * rate;
  if (!Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER / 100) throw new CreditError(400, 'Claim amount is invalid.');
  return Math.round(value * 100) / 100;
}
function calendarDate(value: unknown): string {
  const date = text(value, 'Discovery date', true, 10)!;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new CreditError(400, 'Discovery date must be a valid calendar date.');
  return date;
}
function currentStoreDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function history(db: Database, req: Request, id: string, from: string | null, to: string, now: string, notes: string | null = null) {
  db.run('INSERT INTO claim_history (history_id,claim_id,changed_by,old_status,new_status,notes,changed_at) VALUES (?,?,?,?,?,?,?)', [uuidv4(), id, req.user!.user_id, from, to, notes, now]);
}
function pageNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new CreditError(400, 'Pagination must use whole numbers.');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new CreditError(400, 'Pagination is outside the supported range.');
  return result;
}

router.get('/summary', endpoint((req, res, db) => {
  const storeId = storeScope(req);
  const totals = queryOne(db, `SELECT COALESCE(SUM(total_claim),0) as total_claimed,
    COALESCE(SUM(CASE WHEN status IN ('approved','credited') THEN total_claim ELSE 0 END),0) as total_approved,
    COALESCE(SUM(CASE WHEN status='credited' THEN total_claim ELSE 0 END),0) as total_credited
    FROM credit_claims WHERE store_id = ?`, [storeId]);
  const bySupplier = queryAll(db, `SELECT s.name, COUNT(*) as count, COALESCE(SUM(cc.total_claim),0) as total
    FROM credit_claims cc JOIN suppliers s ON cc.supplier_id=s.supplier_id WHERE cc.store_id=? GROUP BY cc.supplier_id ORDER BY total DESC`, [storeId]);
  const byStatus = queryAll(db, 'SELECT status, COUNT(*) as count, COALESCE(SUM(total_claim),0) as total FROM credit_claims WHERE store_id=? GROUP BY status', [storeId]);
  res.json({ ...totals, by_supplier: bySupplier, by_status: byStatus });
}));

router.get('/', endpoint((req, res, db) => {
  const params: (string | number)[] = [storeScope(req)];
  let filter = 'WHERE cc.store_id = ?';
  for (const key of ['supplier_id', 'status'] as const) {
    if (req.query[key] !== undefined) {
      const value = text(req.query[key], key, true, 160)!;
      if (key === 'status' && !['draft', 'submitted', 'approved', 'credited', 'rejected', 'disputed'].includes(value)) throw new CreditError(400, 'Invalid claim status.');
      filter += ` AND cc.${key} = ?`; params.push(value);
    }
  }
  if (req.query.date_from !== undefined) { filter += ' AND cc.discovery_date >= ?'; params.push(calendarDate(req.query.date_from)); }
  if (req.query.date_to !== undefined) { filter += ' AND cc.discovery_date <= ?'; params.push(calendarDate(req.query.date_to)); }
  const limit = pageNumber(req.query.limit, 50, 1, 500);
  const offset = pageNumber(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const count = queryOne(db, `SELECT COUNT(*) as total FROM credit_claims cc ${filter}`, params).total;
  const claims = queryAll(db, `${claimSelect} ${filter} ORDER BY cc.created_at DESC, cc.claim_id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  res.json({ claims, count: claims.length, total: count, limit, offset });
}));

router.post('/', endpoint((req, res, db) => {
  const storeId = storeScope(req);
  if (!queryOne(db, 'SELECT store_id FROM stores WHERE store_id=?', [storeId])) throw new CreditError(400, 'Store not found.');
  const input = req.body ?? {};
  const supplierId = text(input.supplier_id, 'Supplier', true, 160)!;
  const supplier = queryOne(db, 'SELECT is_active FROM suppliers WHERE supplier_id=?', [supplierId]);
  if (!supplier?.is_active) throw new CreditError(400, 'Select an active supplier.');
  const name = text(input.product_name, 'Product name', true, 500)!;
  const cost = amount(input.unit_cost, 'Unit cost');
  const quantity = amount(input.quantity === undefined ? 1 : input.quantity, 'Quantity', true);
  const claimType = text(input.claim_type, 'Claim type', true, 40)!;
  const creditTypes: Record<string, string> = { short_dated: 'short_dated_delivery', damaged: 'damaged_on_arrival', recall: 'supplier_recall', expired: 'expired_stock', unsold: 'unsold_seasonal' };
  if (!creditTypes[claimType]) throw new CreditError(400, 'Invalid claim type.');
  const agreementId = text(input.agreement_id, 'Agreement', false, 160);
  let rate = 1;
  if (agreementId) {
    const agreement = queryOne(db, 'SELECT * FROM supplier_agreements WHERE agreement_id=?', [agreementId]);
    if (!agreement?.is_active || agreement.supplier_id !== supplierId || agreement.store_id !== storeId || agreement.credit_type !== creditTypes[claimType] || !Number.isFinite(agreement.credit_rate) || agreement.credit_rate <= 0 || agreement.credit_rate > 1) throw new CreditError(400, 'The agreement must match the active supplier, store and claim type.');
    rate = agreement.credit_rate;
  }
  const claimTotal = total(cost, quantity, rate);
  const barcode = text(input.product_barcode, 'Barcode', false, 160);
  const department = text(input.product_department, 'Department', false, 160);
  const reason = text(input.reason, 'Reason');
  const discovered = input.discovery_date === undefined ? currentStoreDate() : calendarDate(input.discovery_date);
  const sourceId = text(input.source_expiry_id, 'Expiry record', false, 160);
  if (sourceId) {
    const sourceVersion = input.source_expiry_version;
    if (!Number.isSafeInteger(sourceVersion) || sourceVersion <= 0) throw new CreditError(400, 'The acknowledged expiry record version is required.');
    const source = queryOne(db, 'SELECT record_id,version FROM expiry_records WHERE store_id=? AND record_id=?', [storeId, sourceId]);
    if (!source) throw new CreditError(409, 'Sync this expiry record before creating a claim.');
    const link = queryOne(db, 'SELECT claim_id FROM expiry_claim_links WHERE store_id=? AND expiry_record_id=?', [storeId, sourceId]);
    if (link) {
      const existing = claimById(db, link.claim_id);
      const requested: Record<string, string | number | null> = {
        supplier_id: supplierId, agreement_id: agreementId, product_barcode: barcode,
        product_name: name, product_department: department, unit_cost: cost, quantity,
        credit_rate: rate, claim_type: claimType, reason,
        ...(input.discovery_date === undefined ? {} : { discovery_date: discovered }),
      };
      if (!existing || Object.entries(requested).some(([key, value]) => existing[key] !== value)) {
        throw new CreditError(409, 'This expiry record already has a claim with different details. Open the existing claim to review it.');
      }
      res.json({ claim: existing, existing: true }); return;
    }
    if (source.version !== sourceVersion) throw new CreditError(409, 'This expiry record changed after it was confirmed. Refresh and review the source record before creating a claim.');
  }
  const id = uuidv4(); const now = new Date().toISOString();
  durableWrite(db, () => {
    db.run(`INSERT INTO credit_claims (claim_id,store_id,supplier_id,agreement_id,product_barcode,product_name,product_department,unit_cost,quantity,total_claim,credit_rate,claim_type,discovery_date,reason,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`, [id,storeId,supplierId,agreementId,barcode,name,department,cost,quantity,claimTotal,rate,claimType,discovered,reason,now,now]);
    if (sourceId) db.run('INSERT INTO expiry_claim_links (store_id,expiry_record_id,claim_id) VALUES (?,?,?)', [storeId,sourceId,id]);
    history(db, req, id, null, 'draft', now, sourceId ? `Created from expiry record ${sourceId}` : 'Created claim draft');
  });
  res.status(201).json({ claim: claimById(db, id) });
}));

router.get('/:id', endpoint((req, res, db) => {
  const claim = scopedClaim(db, req);
  const changes = queryAll(db, `SELECT ch.*, u.display_name as changed_by_name FROM claim_history ch LEFT JOIN users u ON ch.changed_by=u.user_id
    WHERE ch.claim_id=? ORDER BY ch.changed_at DESC,ch.history_id DESC`, [claim.claim_id]);
  res.json({ claim, history: changes });
}));

router.patch('/:id', endpoint((req, res, db) => {
  const existing = scopedClaim(db, req);
  const input = req.body ?? {};
  const keys = Object.keys(input);
  const fields = ['notes','product_name','unit_cost','quantity','reason','product_department','product_barcode','discovery_date'];
  const updates = keys.filter(key => key !== 'store_id');
  if (!updates.length || updates.some(key => !fields.includes(key))) throw new CreditError(400, 'Only editable draft fields or notes are allowed. Status and totals use dedicated actions.');
  if (existing.status !== 'draft' && updates.some(key => key !== 'notes')) throw new CreditError(409, 'Only draft claim details can be changed.');
  const values: Record<string, string | number | null> = {};
  for (const key of updates) {
    if (key === 'unit_cost' || key === 'quantity') values[key] = amount(input[key], key, key === 'quantity');
    else if (key === 'discovery_date') values[key] = calendarDate(input[key]);
    else values[key] = text(input[key], key, key === 'product_name', key === 'product_name' ? 500 : 2000);
  }
  if (input.unit_cost !== undefined || input.quantity !== undefined) values.total_claim = total(Number(values.unit_cost ?? existing.unit_cost), Number(values.quantity ?? existing.quantity), existing.credit_rate);
  const now = new Date().toISOString(); values.updated_at = now;
  durableWrite(db, () => {
    db.run(`UPDATE credit_claims SET ${Object.keys(values).map(key => `${key}=?`).join(',')} WHERE claim_id=?`, [...Object.values(values), existing.claim_id]);
    history(db, req, existing.claim_id, existing.status, existing.status, now, `Updated fields: ${updates.join(', ')}`);
  });
  res.json({ claim: claimById(db, existing.claim_id) });
}));

type Action = 'submit' | 'approve' | 'reject' | 'credit';
for (const action of ['submit','approve','reject','credit'] as Action[]) {
  router.post(`/:id/${action}`, endpoint((req, res, db) => {
    const existing = scopedClaim(db, req);
    if (action !== 'submit') managerOnly(req);
    const target = { submit: 'submitted', approve: 'approved', reject: 'rejected', credit: 'credited' }[action];
    const detail = action === 'credit' ? text(req.body?.credit_ref, 'Credit reference', true, 160)
      : action === 'reject' ? text(req.body?.reason, 'Rejection reason', true) : null;
    if (existing.status === target) {
      if (action === 'credit' && existing.credit_ref !== detail) throw new CreditError(409, 'This claim already has a different credit reference.');
      if (action === 'reject') {
        const prior = queryOne(db, "SELECT notes FROM claim_history WHERE claim_id=? AND new_status='rejected' AND old_status!='rejected' ORDER BY changed_at DESC LIMIT 1", [existing.claim_id]);
        if (prior?.notes !== detail) throw new CreditError(409, 'This claim was already rejected with a different reason.');
      }
      res.json({ claim: existing, existing: true }); return;
    }
    const allowed = { submit: ['draft'], approve: ['submitted'], reject: ['submitted','approved'], credit: ['approved'] }[action];
    if (!allowed.includes(existing.status)) throw new CreditError(409, `Cannot ${action} a ${existing.status} claim.`);
    const now = new Date().toISOString();
    const changes: Record<string, string> = { status: target, updated_at: now };
    if (action === 'submit') { changes.submitted_at = now; changes.submitted_by = req.user!.user_id; }
    if (action === 'approve') { changes.approved_at = now; changes.approved_by = req.user!.user_id; }
    if (action === 'credit') { changes.credited_at = now; changes.credit_ref = detail!; }
    if (action === 'reject') changes.notes = `${existing.notes ? `${existing.notes}\n` : ''}[Rejected: ${detail}]`;
    durableWrite(db, () => {
      db.run(`UPDATE credit_claims SET ${Object.keys(changes).map(key => `${key}=?`).join(',')} WHERE claim_id=?`, [...Object.values(changes),existing.claim_id]);
      history(db, req, existing.claim_id, existing.status, target, now, detail);
    });
    res.json({ claim: claimById(db, existing.claim_id) });
  }));
}

export default router;
