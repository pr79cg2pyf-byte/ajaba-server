"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const connection_1 = require("../db/connection");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth, auth_1.requireActiveStore);
const textFields = ['id', 'plu', 'barcode', 'name', 'department', 'category', 'supplier', 'gstStatus', 'activeStatus', 'packSize', 'unitSize', 'location', 'createdAt', 'updatedAt'];
const numberFields = ['costPrice', 'retailPrice'];
const productFields = [...textFields, ...numberFields];
function validProduct(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const product = value;
    if (typeof product.name !== 'string' || !product.name.trim() || product.name.length > 500 || typeof product.department !== 'string')
        return false;
    if (!textFields.every(key => product[key] === undefined || typeof product[key] === 'string'))
        return false;
    if (!['plu', 'barcode'].some(key => typeof product[key] === 'string' && product[key].trim()))
        return false;
    if (['plu', 'barcode'].some(key => typeof product[key] === 'string' && product[key].length > 64))
        return false;
    return numberFields.every(key => product[key] === undefined || (typeof product[key] === 'number' && Number.isFinite(product[key])));
}
function cleanProduct(product) {
    return Object.fromEntries(productFields.filter(key => product[key] !== undefined).map(key => [key, product[key]]));
}
router.get('/version', async (req, res, next) => {
    try {
        const db = await (0, connection_1.getDb)();
        const master = (0, connection_1.queryOne)(db, 'SELECT version, product_count AS count, updated_at AS updatedAt, updated_by AS updatedBy FROM product_masters WHERE store_id = ?', [req.user.store_id]);
        res.json(master ?? { version: 0, count: 0 });
    }
    catch (error) {
        next(error);
    }
});
router.get('/', async (req, res, next) => {
    try {
        const db = await (0, connection_1.getDb)();
        const master = (0, connection_1.queryOne)(db, 'SELECT version, product_count, updated_at, products_json FROM product_masters WHERE store_id = ?', [req.user.store_id]);
        res.json(master ? { version: master.version, count: master.product_count, updatedAt: master.updated_at, products: JSON.parse(master.products_json) } : { version: 0, count: 0, products: [] });
    }
    catch (error) {
        next(error);
    }
});
router.put('/', async (req, res, next) => {
    try {
        const db = await (0, connection_1.getDb)();
        const storeId = req.user.store_id;
        const current = (0, connection_1.queryOne)(db, 'SELECT store_id, role, is_active FROM users WHERE user_id = ?', [req.user.user_id]);
        if (!current?.is_active || current.store_id !== storeId || current.role !== req.user.role) {
            res.status(401).json({ error: 'Account or store access changed. Please sign in again.' });
            return;
        }
        if (!['owner', 'manager'].includes(current.role)) {
            res.status(403).json({ error: 'Manager or owner authority is required.' });
            return;
        }
        const { products } = req.body ?? {};
        if (!Array.isArray(products) || products.length < 1 || products.length > 50_000) {
            res.status(400).json({ error: 'Products must be an array of 1 to 50,000 objects.' });
            return;
        }
        const invalidRow = products.findIndex(product => !validProduct(product));
        if (invalidRow !== -1) {
            res.status(400).json({ error: `Invalid product at row ${invalidRow + 1}.` });
            return;
        }
        const version = ((0, connection_1.queryOne)(db, 'SELECT version FROM product_masters WHERE store_id = ?', [storeId])?.version ?? 0) + 1;
        const updatedAt = new Date().toISOString();
        const updatedBy = req.user.user_id;
        const productsJson = JSON.stringify(products.map(cleanProduct));
        (0, connection_1.durableWrite)(db, () => {
            db.run(`INSERT INTO product_masters (store_id, version, product_count, products_json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(store_id) DO UPDATE SET version=excluded.version, product_count=excluded.product_count, products_json=excluded.products_json, updated_at=excluded.updated_at, updated_by=excluded.updated_by`, [storeId, version, products.length, productsJson, updatedAt, updatedBy]);
        });
        res.json({ version, count: products.length, updatedAt, updatedBy });
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
//# sourceMappingURL=products.js.map