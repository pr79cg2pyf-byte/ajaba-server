"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const connection_1 = require("../db/connection");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
// ============================================================
// GET /api/task-templates
// ============================================================
router.get('/', async (req, res) => {
    try {
        const db = await (0, connection_1.getDb)();
        const { store_id, department, category, is_active } = req.query;
        let sql = 'SELECT * FROM task_templates WHERE 1=1';
        const params = [];
        if (store_id) {
            sql += ' AND store_id = ?';
            params.push(store_id);
        }
        if (department) {
            sql += ' AND department = ?';
            params.push(department);
        }
        if (category) {
            sql += ' AND category = ?';
            params.push(category);
        }
        if (is_active !== undefined) {
            sql += ' AND is_active = ?';
            params.push(parseInt(is_active));
        }
        sql += ' ORDER BY department, title';
        const templates = (0, connection_1.queryAll)(db, sql, params);
        res.json({ templates, count: templates.length });
    }
    catch (err) {
        console.error('[templates] List error:', err);
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
});
// ============================================================
// POST /api/task-templates
// ============================================================
router.post('/', async (req, res) => {
    try {
        const db = await (0, connection_1.getDb)();
        const { store_id, title, description, category, department, default_priority, default_role, schedule_cron } = req.body;
        if (!store_id || !title || !category) {
            res.status(400).json({ error: 'store_id, title, and category are required' });
            return;
        }
        const templateId = (0, uuid_1.v4)();
        (0, connection_1.execute)(db, `INSERT INTO task_templates (template_id, store_id, title, description, category, department, default_priority, default_role, schedule_cron)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [templateId, store_id, title, description || null, category, department || null,
            default_priority || 'medium', default_role || 'staff', schedule_cron || null]);
        const template = (0, connection_1.queryOne)(db, 'SELECT * FROM task_templates WHERE template_id = ?', [templateId]);
        res.status(201).json({ template });
    }
    catch (err) {
        console.error('[templates] Create error:', err);
        res.status(500).json({ error: 'Failed to create template' });
    }
});
// ============================================================
// PATCH /api/task-templates/:id
// ============================================================
router.patch('/:id', async (req, res) => {
    try {
        const db = await (0, connection_1.getDb)();
        const existing = (0, connection_1.queryOne)(db, 'SELECT * FROM task_templates WHERE template_id = ?', [req.params.id]);
        if (!existing) {
            res.status(404).json({ error: 'Template not found' });
            return;
        }
        const allowed = ['title', 'description', 'category', 'department', 'default_priority', 'default_role', 'schedule_cron', 'is_active'];
        const updates = [];
        const params = [];
        for (const field of allowed) {
            if (req.body[field] !== undefined) {
                updates.push(`${field} = ?`);
                params.push(req.body[field]);
            }
        }
        if (updates.length === 0) {
            res.status(400).json({ error: 'No valid fields' });
            return;
        }
        params.push(req.params.id);
        (0, connection_1.execute)(db, `UPDATE task_templates SET ${updates.join(', ')} WHERE template_id = ?`, params);
        const template = (0, connection_1.queryOne)(db, 'SELECT * FROM task_templates WHERE template_id = ?', [req.params.id]);
        res.json({ template });
    }
    catch (err) {
        console.error('[templates] Update error:', err);
        res.status(500).json({ error: 'Failed to update template' });
    }
});
// ============================================================
// POST /api/task-templates/:id/generate — manually generate tasks from template
// ============================================================
router.post('/:id/generate', async (req, res) => {
    try {
        const db = await (0, connection_1.getDb)();
        const tmpl = (0, connection_1.queryOne)(db, 'SELECT * FROM task_templates WHERE template_id = ? AND is_active = 1', [req.params.id]);
        if (!tmpl) {
            res.status(404).json({ error: 'Template not found or inactive' });
            return;
        }
        const taskId = (0, uuid_1.v4)();
        const now = new Date().toISOString();
        const dueDate = new Date();
        dueDate.setHours(17, 0, 0, 0); // Default due: 5pm today
        (0, connection_1.execute)(db, `INSERT INTO tasks (task_id, store_id, template_id, title, description, category, department, priority, due_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [taskId, tmpl.store_id, tmpl.template_id, tmpl.title, tmpl.description, tmpl.category,
            tmpl.department, tmpl.default_priority, dueDate.toISOString(), now, now]);
        const task = (0, connection_1.queryOne)(db, `SELECT t.*, u.display_name as assigned_name FROM tasks t
       LEFT JOIN users u ON t.assigned_to = u.user_id
       WHERE t.task_id = ?`, [taskId]);
        res.status(201).json({ task });
    }
    catch (err) {
        console.error('[templates] Generate error:', err);
        res.status(500).json({ error: 'Failed to generate task' });
    }
});
exports.default = router;
//# sourceMappingURL=taskTemplates.js.map