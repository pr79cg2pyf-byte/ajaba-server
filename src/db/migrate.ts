// Database migration: create all v0.7 tables (sql.js version)

import { getDb, closeDb, execute } from './connection';

async function migrate(): Promise<void> {
  const db = await getDb();

  console.log('[migrate] Creating tables...');

  const statements = [
    `CREATE TABLE IF NOT EXISTS stores (
      store_id    TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      code        TEXT NOT NULL UNIQUE,
      timezone    TEXT NOT NULL DEFAULT 'Australia/Brisbane',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS users (
      user_id       TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      display_name  TEXT NOT NULL,
      pin_hash      TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('owner','manager','supervisor','staff')),
      store_id      TEXT NOT NULL REFERENCES stores(store_id),
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS task_templates (
      template_id   TEXT PRIMARY KEY,
      store_id      TEXT NOT NULL REFERENCES stores(store_id),
      title         TEXT NOT NULL,
      description   TEXT,
      category      TEXT NOT NULL CHECK (category IN ('expiry_check','stock_rotation','inventory_audit','markdown_review','supplier_credit','compliance','other')),
      department    TEXT,
      default_priority TEXT NOT NULL DEFAULT 'medium',
      default_role  TEXT NOT NULL DEFAULT 'staff',
      schedule_cron TEXT,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS tasks (
      task_id       TEXT PRIMARY KEY,
      template_id   TEXT REFERENCES task_templates(template_id),
      store_id      TEXT NOT NULL REFERENCES stores(store_id),
      title         TEXT NOT NULL,
      description   TEXT,
      category      TEXT NOT NULL,
      department    TEXT,
      priority      TEXT NOT NULL DEFAULT 'medium',
      status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','in_progress','completed','overdue','cancelled')),
      assigned_to   TEXT REFERENCES users(user_id),
      assigned_by   TEXT REFERENCES users(user_id),
      due_date      TEXT,
      completed_at  TEXT,
      completed_by  TEXT REFERENCES users(user_id),
      notes         TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS task_history (
      history_id    TEXT PRIMARY KEY,
      task_id       TEXT NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
      changed_by    TEXT REFERENCES users(user_id),
      field_changed TEXT NOT NULL,
      old_value     TEXT,
      new_value     TEXT,
      changed_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS suppliers (
      supplier_id   TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      contact_name  TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      credit_terms  TEXT,
      credit_policy TEXT,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS supplier_agreements (
      agreement_id   TEXT PRIMARY KEY,
      supplier_id    TEXT NOT NULL REFERENCES suppliers(supplier_id),
      store_id       TEXT NOT NULL REFERENCES stores(store_id),
      department     TEXT,
      category       TEXT,
      credit_type    TEXT NOT NULL CHECK (credit_type IN ('short_dated_delivery','damaged_on_arrival','supplier_recall','unsold_seasonal','expired_stock')),
      credit_rate    REAL NOT NULL,
      shelf_life_threshold REAL,
      requires_evidence     INTEGER NOT NULL DEFAULT 1,
      claim_deadline_days   INTEGER NOT NULL DEFAULT 30,
      is_active      INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS credit_claims (
      claim_id         TEXT PRIMARY KEY,
      store_id         TEXT NOT NULL REFERENCES stores(store_id),
      supplier_id      TEXT NOT NULL REFERENCES suppliers(supplier_id),
      agreement_id     TEXT REFERENCES supplier_agreements(agreement_id),
      product_barcode  TEXT,
      product_name     TEXT NOT NULL,
      product_department TEXT,
      unit_cost        REAL NOT NULL,
      quantity         INTEGER NOT NULL DEFAULT 1,
      total_claim      REAL NOT NULL,
      credit_rate      REAL NOT NULL DEFAULT 1.0,
      claim_type       TEXT NOT NULL CHECK (claim_type IN ('short_dated','damaged','recall','expired','unsold')),
      discovery_date   TEXT NOT NULL,
      evidence_paths   TEXT,
      reason           TEXT,
      status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','credited','disputed')),
      submitted_at     TEXT,
      submitted_by     TEXT REFERENCES users(user_id),
      approved_at      TEXT,
      approved_by      TEXT REFERENCES users(user_id),
      credited_at      TEXT,
      credit_ref       TEXT,
      notes            TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS claim_history (
      history_id   TEXT PRIMARY KEY,
      claim_id     TEXT NOT NULL REFERENCES credit_claims(claim_id) ON DELETE CASCADE,
      changed_by   TEXT REFERENCES users(user_id),
      old_status   TEXT,
      new_status   TEXT,
      notes        TEXT,
      changed_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS ocr_scans (
      scan_id           TEXT PRIMARY KEY,
      store_id          TEXT NOT NULL REFERENCES stores(store_id),
      scanned_by        TEXT REFERENCES users(user_id),
      image_path        TEXT,
      image_hash        TEXT,
      ocr_engine        TEXT NOT NULL,
      raw_text          TEXT NOT NULL,
      date_format       TEXT,
      parsed_date       TEXT,
      parsed_use_by     TEXT,
      confidence_score  REAL NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
      confidence_breakdown TEXT,
      resolution        TEXT NOT NULL DEFAULT 'pending' CHECK (resolution IN ('pending','auto_accepted','user_confirmed','user_corrected','rejected')),
      resolved_by       TEXT REFERENCES users(user_id),
      resolved_at       TEXT,
      final_date        TEXT,
      final_text        TEXT,
      is_used_for_training INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS daily_metrics (
      metric_id       TEXT PRIMARY KEY,
      store_id        TEXT NOT NULL REFERENCES stores(store_id),
      metric_date     TEXT NOT NULL,
      items_expired   INTEGER NOT NULL DEFAULT 0,
      items_checked   INTEGER NOT NULL DEFAULT 0,
      items_marked_down INTEGER NOT NULL DEFAULT 0,
      waste_value     REAL NOT NULL DEFAULT 0.0,
      markdown_value  REAL NOT NULL DEFAULT 0.0,
      tasks_created   INTEGER NOT NULL DEFAULT 0,
      tasks_completed INTEGER NOT NULL DEFAULT 0,
      tasks_overdue   INTEGER NOT NULL DEFAULT 0,
      task_completion_rate REAL NOT NULL DEFAULT 0.0,
      credits_claimed  REAL NOT NULL DEFAULT 0.0,
      credits_approved REAL NOT NULL DEFAULT 0.0,
      credits_credited REAL NOT NULL DEFAULT 0.0,
      ocr_scans_total  INTEGER NOT NULL DEFAULT 0,
      ocr_auto_accept  INTEGER NOT NULL DEFAULT 0,
      ocr_accuracy_rate REAL NOT NULL DEFAULT 0.0,
      department_breakdown TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(store_id, metric_date)
    )`,
  ];

  for (const sql of statements) {
    execute(db, sql);
  }

  console.log(`[migrate] ${statements.length} tables created successfully.`);
  closeDb();
}

migrate().catch(err => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
