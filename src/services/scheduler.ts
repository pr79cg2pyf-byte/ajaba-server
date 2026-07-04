// Ajaba Server - Schedule Service
// Handles automatic task generation from templates based on cron schedule

import { getDb, execute, queryAll } from '../db/connection';
import cron from 'node-cron';

export function startScheduler() {
  console.log('[scheduler] Starting task scheduler');
  
  // Run every hour at minute 5 (5 minutes past the hour)
  const job = cron.schedule('5 * * * *', async () => {
    try {
      console.log('[scheduler] Running hourly task check...');
      
      const db = await getDb();
      
      // Find all active templates with cron schedule
      const templates = queryAll(db, `
        SELECT template_id, store_id, title, description, category, department, 
               default_priority, default_role, schedule_cron, is_active
        FROM task_templates 
        WHERE schedule_cron IS NOT NULL 
          AND schedule_cron != ''
          AND is_active = 1
      `);
      
      console.log(`[scheduler] Found ${templates.length} scheduled templates to process`);
      
      // Process each template with cron schedule  
      for (const template of templates) {
        try {
          const now = new Date();
          const todayString = now.toISOString().split('T')[0]; // YYYY-MM-DD format
          
          // Check if a task already exists for today for this template
          const existingTaskResult = queryAll(db, `
            SELECT task_id FROM tasks 
            WHERE template_id = ? 
              AND date(due_date) = ?
          `, [template.template_id, todayString]);
          
          // If no task exists for today, create one
          if (existingTaskResult.length === 0) {
            console.log(`[scheduler] Creating task from template ${template.template_id}`);
            
            const taskId = 'task_' + Date.now().toString();
            
            execute(db, `
              INSERT INTO tasks (
                task_id, store_id, template_id, title, description, category, 
                department, priority, status, due_date, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            `, [
              taskId, 
              template.store_id,
              template.template_id,
              template.title,
              template.description || '',
              template.category,
              template.department || null,
              template.default_priority || 'medium',
              'pending', // New tasks start as pending
              now.toISOString() // Set due date to now (or adjust if needed)
            ]);
          } else {
            console.log(`[scheduler] Task already exists for template ${template.template_id} today`);
          }
        } catch (err) {
          console.error('[scheduler] Error processing template:', template.template_id, err);
        }
      }
      
      // Also mark overdue tasks
      execute(db, `
        UPDATE tasks 
        SET status = 'overdue' 
        WHERE status IN ('pending','accepted','in_progress') 
          AND due_date < datetime('now')
      `);
      
      console.log('[scheduler] Hourly task check complete');
    } catch (err) {
      console.error('[scheduler] Failed to run scheduled tasks:', err);
    }
  });
  
  job.start();
  console.log('[scheduler] Task scheduler is running');
}