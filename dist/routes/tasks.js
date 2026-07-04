"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const connection_1 = require("../db/connection");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// All task routes require authentication
router.use(auth_1.requireAuth);
// ============================================================
// GET /api/tasks — list tasks with filters
// ============================================================
router.get('/', async (req, res) => {
    try {
        const db = await (0, connection_1.getDb)();
        const { store_id, status, assigned_to, department, priority, limit } = req.query;
        let sql = 'SELECT t.*, u.display_name as assigned_name FROM tasks t LEFT JOIN users u ON t.assigned_to = u.user_id WHERE 1=1';
        const params = [];
        if (store_id) {
            sql += ' AND t.store_id = ?';
            params.push(store_id);
        }
        if (status) {
            sql += ' AND t.status = ?';
            params.push(status);
        }
        if (assigned_to) {
            sql += ' AND t.assigned_to = ?';
            params.push(assigned_to);
        }
        if (department) {
            sql += ' AND t.department = ?';
            params.push(department);
        }
        if (priority) {
            sql += ' AND t.priority = ?';
            params.push(priority);
        }
        sql += ' ORDER BY t.due_date ASC NULLS LAST, t.priority DESC, t.created_at DESC';
        if (limit) {
            sql += ' LIMIT ?';
            params.push(parseInt(limit));
        }
        const tasks = (0, connection_1.queryAll)(db, sql, params);
        res.json({ tasks, count: tasks.length });
    }
    catch (err) {
        console.error('[tasks] List error:', err);
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});
// ============================================================
// GET /api/tasks/my — current user's tasks
// ============================================================
router.get('/my', async (req, res) => {
    try {
        const db = await (0, connection_1.getDb)();
        const tasks = (0, connection_1.queryAll)(db, `SELECT t.*, u.display_name as assigned_name
       FROM tasks t
       LEFT JOIN users u ON t.assigned_to = u.user_id
       WHERE t.assigned_to = ? AND t.status IN ('pending','accepted','in_progress')
         AND DATE(t.due_date) = DATE('now')
       ORDER BY t.priority DESC, t.due_date ASC`, [req.user.user_id]);
        res.json({ tasks, count: tasks.length });
    }
    catch (err) {
        console.error('[tasks] My tasks error:', err);
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});
// ============================================================
// GET /api/tasks/:id — single task with history
// ============================================================
router.get('/:id', async (req, res) => {
    try {
        const db = await (0, connection_1.getDb)();
        const task = (0, connection_1.queryOne)(db, `SELECT t.*, u.display_name as assigned_name, u2.display_name as assigned_by_name
       FROM tasks t
       LEFT JOIN users u ON t.assigned_to = u.user_id
       LEFT JOIN users u2 ON t.assigned_by = u2.user_id
       WHERE t.task_id = ?`, [req.params.id]);
        if (!task) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }
        // Also fetch task history
        const history = (0, connection_1.queryAll)(db, `SELECT th.*, u.display_name as changed_by_name
       FROM task_history th
       LEFT JOIN users u ON th.changed_by = u.user_id
       WHERE th.task_id = ?
       ORDER BY th.changed_at DESC`, [req.params.id]);
        res.json({ task, history });
    }
    catch (err) {
        console.error('[tasks] Get error:', err);
        res.status(500).json({ error: 'Failed to fetch task' });
    }
});
// ============================================================
// POST /api/tasks — create new task
// ============================================================
router.post('/', async (req, res) => {
    try {
        const db = await (0, connection_1.getDb)();
        const { store_id, template_id, title, description, category, department, priority, assigned_to, due_date } = req.body;
        if (!store_id || !title || !category) {
            res.status(400).json({ error: 'store_id, title, and category are required' });
            return;
        }
        const validCategories = ['expiry_check', 'stock_rotation', 'inventory_audit', 'markdown_review', 'supplier_credit', 'compliance', 'other'];
        if (!validCategories.includes(category)) {
            res.status(400).json({ error: `category must be one of: ${validCategories.join(', ')}` });
            return;
        }
        const taskId = (0, uuid_1.v4)();
        const now = new Date().toISOString();
        (0, connection_1.execute)(db, `INSERT INTO tasks (task_id, store_id, template_id, title, description, category, department, priority, assigned_to, assigned_by, due_date, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`, [taskId, store_id, template_id || null, title, description || null, category, department || null,
            priority || 'medium', assigned_to || null, req.user.user_id, due_date || null, now, now]);
        // Log history
        (0, connection_1.execute)(db, `INSERT INTO task_history (history_id, task_id, changed_by, field_changed, old_value, new_value, changed_at)
       VALUES (?, ?, ?, 'status', NULL, 'pending', ?)`, [(0, uuid_1.v4)(), taskId, req.user.user_id, now]);
        const task = (0, connection_1.queryOne)(db, `SELECT t.*, u.display_name as assigned_name FROM tasks t
       LEFT JOIN users u ON t.assigned_to = u.user_id
       WHERE t.task_id = ?`, [taskId]);
        res.status(201).json({ task });
    }
    catch (err) {
        console.error('[tasks] Create error:', err);
        res.status(500).json({ error: 'Failed to create task' });
    }
});
// ============================================================
// PATCH /api/tasks/:id — update task fields
// ============================================================
router.patch('/:id', async (req, res) => {
    try {
        const db = await (0, connection_1.getDb)();
        const task = (0, connection_1.queryOne)(db, 'SELECT * FROM tasks WHERE task_id = ?', [req.params.id]);
        if (!task) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }
        const allowedFields = ['status', 'assigned_to', 'priority', 'notes', 'due_date', 'title', 'description', 'department'];
        const updates = [];
        const params = [];
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                // Log history for significant changes
                if (['status', 'assigned_to', 'priority', 'due_date'].includes(field) && task[field] !== req.body[field]) {
                    (0, connection_1.execute)(db, `INSERT INTO task_history (history_id, task_id, changed_by, field_changed, old_value, new_value, changed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`, [(0, uuid_1.v4)(), req.params.id, req.user.user_id, field, String(task[field] || ''), String(req.body[field] || ''), new Date().toISOString()]);
                }
                updates.push(`${field} = ?`);
                params.push(req.body[field]);
            }
        }
        if (updates.length === 0) {
            res.status(400).json({ error: 'No valid fields to update' });
            return;
        }
        updates.push('updated_at = ?');
        params.push(new Date().toISOString());
        params.push(req.params.id);
        (0, connection_1.execute)(db, `UPDATE tasks SET ${updates.join(', ')} WHERE task_id = ?`, params);
        const updated = (0, connection_1.queryOne)(db, `SELECT t.*, u.display_name as assigned_name FROM tasks t
       LEFT JOIN users u ON t.assigned_to = u.user_id
       WHERE t.task_id = ?`, [req.params.id]);
        res.json({ task: updated });
    }
    catch (err) {
        console.error('[tasks] Update error:', err);
        res.status(500).json({ error: 'Failed to update task' });
    }
});
// ============================================================
// POST /api/tasks/:id/accept — staff accepts task
// ============================================================
router.post('/:id/accept', async (req, res) => {
    try {
        const db = await (0, connection_1.getDb)();
        const task = (0, connection_1.queryOne)(db, 'SELECT * FROM tasks WHERE task_id = ?', [req.params.id]);
        if (!task) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }
        if (task.status !== 'pending') {
            res.status(400).json({ error: 'Only pending tasks can be accepted' });
            return;
        }
        const now = new Date().toISOString();
        (0, connection_1.execute)(db, 'UPDATE tasks SET status = ?, assigned_to = ?, updated_at = ? WHERE task_id = ?', ['accepted', req.user.user_id, now, req.params.id]);
        (0, connection_1.execute)(db, `INSERT INTO task_history (history_id, task_id, changed_by, field_changed, old_value, new_value, changed_at)
       VALUES (?, ?, ?, 'status', 'pending', 'accepted', ?)`, [(0, uuid_1.v4)(), req.params.id, req.user.user_id, now]);
        const updated = (0, connection_1.queryOne)(db, 'SELECT * FROM tasks WHERE task_id = ?', [req.params.id]);
        res.json({ task: updated });
    }
    catch (err) {
        console.error('[tasks] Accept error:', err);
        res.status(500).json({ error: 'Failed to accept task' });
    }
});
// ============================================================
// POST /api/tasks/:id/complete — mark task done
// ============================================================
router.post('/:id/complete', async (req, res) => {
    try {
        const db = await (0, connection_1.getDb)();
        const task = (0, connection_1.queryOne)(db, 'SELECT * FROM tasks WHERE task_id = ?', [req.params.id]);
        if (!task) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }
        if (!['accepted', 'in_progress'].includes(task.status)) {
            res.status(400).json({ error: 'Only accepted or in-progress tasks can be completed' });
            return;
        }
        const now = new Date().toISOString();
        const notes = req.body.notes || null;
        (0, connection_1.execute)(db, `UPDATE tasks SET status = 'completed', completed_at = ?, completed_by = ?, notes = COALESCE(?, notes), updated_at = ?
       WHERE task_id = ?`, [now, req.user.user_id, notes, now, req.params.id]);
        (0, connection_1.execute)(db, `INSERT INTO task_history (history_id, task_id, changed_by, field_changed, old_value, new_value, changed_at)
       VALUES (?, ?, ?, 'status', ?, 'completed', ?)`, [(0, uuid_1.v4)(), req.params.id, req.user.user_id, task.status, now]);
        const updated = (0, connection_1.queryOne)(db, 'SELECT * FROM tasks WHERE task_id = ?', [req.params.id]);
        res.json({ task: updated });
    }
    catch (err) {
        console.error('[tasks] Complete error:', err);
        res.status(500).json({ error: 'Failed to complete task' });
    }
});
// ============================================================
// POST /api/tasks/:id/escalate — escalate overdue task
// ============================================================
router.post('/:id/escalate', async (req, res) => {
    try {
        const db = await (0, connection_1.getDb)();
        const task = (0, connection_1.queryOne)(db, 'SELECT * FROM tasks WHERE task_id = ?', [req.params.id]);
        if (!task) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }
        const now = new Date().toISOString();
        const reason = req.body.reason || 'Escalated by user';
        (0, connection_1.execute)(db, 'UPDATE tasks SET status = ?, notes = COALESCE(notes, \'\') || ? || ?, updated_at = ? WHERE task_id = ?', ['overdue', '\n[Escalated: ', reason + ']', now, req.params.id]);
        (0, connection_1.execute)(db, `INSERT INTO task_history (history_id, task_id, changed_by, field_changed, old_value, new_value, changed_at)
       VALUES (?, ?, ?, 'status', ?, 'overdue', ?)`, [(0, uuid_1.v4)(), req.params.id, req.user.user_id, task.status, now]);
        const updated = (0, connection_1.queryOne)(db, 'SELECT * FROM tasks WHERE task_id = ?', [req.params.id]);
        res.json({ task: updated });
    }
    catch (err) {
        console.error('[tasks] Escalate error:', err);
        res.status(500).json({ error: 'Failed to escalate task' });
    }
});
exports.default = router;
//# sourceMappingURL=tasks.js.map