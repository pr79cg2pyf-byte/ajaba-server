"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = require("crypto");
const connection_1 = require("../db/connection");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth, auth_1.requireActiveStore);
function hydrated(db, storeId, record) {
    const link = (0, connection_1.queryOne)(db, 'SELECT claim_id FROM expiry_claim_links WHERE store_id = ? AND expiry_record_id = ?', [storeId, record.id]);
    const status = link && ['Open', 'Supplier Credit Case'].includes(String(record.status)) ? 'Supplier Credit Case' : record.status;
    return { ...record, storeId, ...(link ? { claimId: link.claim_id } : {}), status, syncStatus: 'synced' };
}
function validRecord(value, id) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const r = value;
    if (r.id !== id || typeof r.productName !== 'string' || !r.productName.trim() || r.productName.length > 500 || typeof r.department !== 'string')
        return false;
    if (typeof r.barcode !== 'string' || (!r.barcode.trim() && !r.plu && !r.productId))
        return false;
    if (typeof r.expiryDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.expiryDate))
        return false;
    const date = new Date(`${r.expiryDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== r.expiryDate)
        return false;
    if (!Number.isInteger(r.quantity) || Number(r.quantity) < 1 || Number(r.quantity) > 1_000_000)
        return false;
    if (!['Open', 'Done', 'Markdown Done', 'Supplier Credit Case', 'Written Off'].includes(String(r.status)))
        return false;
    return ['manual', 'import', 'camera', 'ocr', 'vision-ai'].includes(String(r.source));
}
function cleanRecord(input) {
    const fields = ['id', 'productId', 'barcode', 'plu', 'productName', 'department', 'category', 'supplier', 'costPrice', 'retailPrice', 'expiryDate', 'quantity', 'location', 'notes', 'confirmedBy', 'status', 'source', 'unmatchedProduct', 'createdAt'];
    return Object.fromEntries(fields.filter(key => input[key] !== undefined).map(key => [key, input[key]]));
}
router.get('/', async (req, res, next) => {
    try {
        const db = await (0, connection_1.getDb)();
        const storeId = req.user.store_id;
        const rows = (0, connection_1.queryAll)(db, 'SELECT record_json FROM expiry_records WHERE store_id = ? ORDER BY updated_at DESC, record_id', [storeId]);
        res.json({ records: rows.map(row => hydrated(db, storeId, JSON.parse(row.record_json))) });
    }
    catch (error) {
        next(error);
    }
});
router.put('/:id', async (req, res, next) => {
    try {
        const { record, expectedVersion, mutationId } = req.body ?? {};
        const id = req.params.id;
        if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id) || !validRecord(record, id) || !Number.isInteger(expectedVersion) || expectedVersion < 0 || typeof mutationId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(mutationId)) {
            res.status(400).json({ error: 'Valid product, expiry date, positive quantity, version and mutation ID are required.' });
            return;
        }
        const db = await (0, connection_1.getDb)();
        const storeId = req.user.store_id;
        const current = (0, connection_1.queryOne)(db, 'SELECT record_json, version FROM expiry_records WHERE store_id = ? AND record_id = ?', [storeId, id]);
        const cleaned = cleanRecord(record);
        const requestHash = (0, crypto_1.createHash)('sha256').update(JSON.stringify({ record: cleaned, expectedVersion })).digest('hex');
        const prior = (0, connection_1.queryOne)(db, 'SELECT request_hash, response_json FROM expiry_record_mutations WHERE store_id = ? AND record_id = ? AND mutation_id = ?', [storeId, id, mutationId]);
        if (prior) {
            if (prior.request_hash !== requestHash) {
                res.status(409).json({ error: 'Mutation ID was already used for different data.', ...(current ? { record: hydrated(db, storeId, JSON.parse(current.record_json)) } : {}) });
                return;
            }
            res.json({ record: hydrated(db, storeId, JSON.parse(prior.response_json)) });
            return;
        }
        if ((current?.version ?? 0) !== expectedVersion) {
            res.status(409).json({ error: 'This record changed on another device. Review both versions.', ...(current ? { record: hydrated(db, storeId, JSON.parse(current.record_json)) } : {}) });
            return;
        }
        const timestamp = new Date().toISOString();
        const stored = { ...cleaned, storeId, createdAt: current ? JSON.parse(current.record_json).createdAt : timestamp, updatedAt: timestamp, serverVersion: expectedVersion + 1, mutationId };
        (0, connection_1.durableWrite)(db, () => {
            db.run(`INSERT INTO expiry_records (store_id, record_id, record_json, version, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(store_id, record_id) DO UPDATE SET record_json=excluded.record_json, version=excluded.version, updated_by=excluded.updated_by, updated_at=excluded.updated_at`, [storeId, id, JSON.stringify(stored), expectedVersion + 1, req.user.user_id, timestamp]);
            db.run('INSERT INTO expiry_record_mutations (store_id, record_id, mutation_id, request_hash, response_json) VALUES (?, ?, ?, ?, ?)', [storeId, id, mutationId, requestHash, JSON.stringify(stored)]);
        });
        res.json({ record: hydrated(db, storeId, stored) });
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
//# sourceMappingURL=expiryRecords.js.map