"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const connection_1 = require("../db/connection");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
/**
 * A user may only read their own store; owners may read any store.
 * Mirrors the credits route scope so dashboards cannot leak another store's data.
 */
function resolveStoreScope(req, res) {
    const sessionStore = req.user.store_id;
    const requested = req.query.store_id ?? sessionStore;
    if (typeof requested !== 'string' || !requested.trim()) {
        res.status(400).json({ error: 'A valid store is required.' });
        return null;
    }
    if (requested !== sessionStore && req.user.role !== 'owner') {
        res.status(403).json({ error: 'This account cannot access another store.' });
        return null;
    }
    return requested;
}
// ============================================================
// GET /summary — aggregated dashboard data
// ============================================================
router.get('/summary', async (req, res) => {
    try {
        const storeId = resolveStoreScope(req, res);
        if (storeId === null)
            return;
        const db = await (0, connection_1.getDb)();
        const storeFilter = 'WHERE store_id = ?';
        const storeParams = [storeId];
        // Task stats
        const taskStats = (0, connection_1.queryOne)(db, `
      SELECT
        COUNT(*) as total_tasks,
        COALESCE(SUM(CASE WHEN status IN ('pending','accepted','in_progress') THEN 1 ELSE 0 END), 0) as pending_tasks,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as completed_tasks,
        COALESCE(SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END), 0) as overdue_tasks
      FROM tasks ${storeFilter}
    `, storeParams);
        // Tasks by category
        const tasksByCategory = (0, connection_1.queryAll)(db, `
      SELECT COALESCE(category, 'uncategorized') as category, COUNT(*) as count
      FROM tasks ${storeFilter}
      GROUP BY category ORDER BY count DESC
    `, storeParams);
        // Credit stats (use credits filter, not tasks)
        const creditFilter = 'WHERE cc.store_id = ?';
        const creditStats = (0, connection_1.queryOne)(db, `
      SELECT
        COUNT(*) as total_claims,
        COALESCE(SUM(CASE WHEN cc.status IN ('approved','credited') THEN 1 ELSE 0 END), 0) as approved_claims,
        COALESCE(SUM(CASE WHEN cc.status = 'credited' THEN 1 ELSE 0 END), 0) as credited_claims,
        COALESCE(SUM(cc.total_claim), 0) as total_claim_value
      FROM credit_claims cc ${creditFilter}
    `, storeParams);
        // Claims by supplier
        const claimedBySupplier = (0, connection_1.queryAll)(db, `
      SELECT s.name as supplier_name, COUNT(*) as count,
             COALESCE(SUM(cc.total_claim), 0) as total_value
      FROM credit_claims cc
      JOIN suppliers s ON cc.supplier_id = s.supplier_id
      ${creditFilter}
      GROUP BY cc.supplier_id ORDER BY total_value DESC
    `, storeParams);
        res.json({
            store_id: storeId,
            total_tasks: taskStats?.total_tasks ?? 0,
            pending_tasks: taskStats?.pending_tasks ?? 0,
            completed_tasks: taskStats?.completed_tasks ?? 0,
            overdue_tasks: taskStats?.overdue_tasks ?? 0,
            tasks_by_category: tasksByCategory || [],
            total_claims: creditStats?.total_claims ?? 0,
            approved_claims: creditStats?.approved_claims ?? 0,
            credited_claims: creditStats?.credited_claims ?? 0,
            total_claim_value: creditStats?.total_claim_value ?? 0,
            claimed_supplier_breakdown: claimedBySupplier || [],
        });
    }
    catch (err) {
        console.error('[dashboard/summary]', err.message);
        res.status(500).json({ error: 'Failed to load dashboard summary' });
    }
});
exports.default = router;
//# sourceMappingURL=dashboard.js.map