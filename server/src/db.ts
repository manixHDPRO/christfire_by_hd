import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { LODGING_MODULE_CODES, PERMISSION_CATALOG } from "./permissionCodes.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const defaultPath = path.join(repoRoot, "data", "hd-christfire.db");
const dbPath = process.env.DATABASE_PATH
  ? path.isAbsolute(process.env.DATABASE_PATH)
    ? process.env.DATABASE_PATH
    : path.join(repoRoot, process.env.DATABASE_PATH)
  : defaultPath;

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    client_profile TEXT NOT NULL DEFAULT 'hebergement',
    entry_fee_usd INTEGER NOT NULL DEFAULT 0,
    visitor_party_count INTEGER,
    visitor_visit_kind TEXT,
    visitor_adults_count INTEGER,
    visitor_minors_count INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bungalows (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    label TEXT NOT NULL,
    category TEXT NOT NULL,
    rooms INTEGER NOT NULL,
    capacity INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    amenities_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    bungalow_id TEXT NOT NULL REFERENCES bungalows(id) ON DELETE RESTRICT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT NOT NULL,
    amount INTEGER NOT NULL,
    amount_paid INTEGER NOT NULL DEFAULT 0,
    guest_count INTEGER NOT NULL DEFAULT 1 CHECK (guest_count >= 1 AND guest_count <= 99),
    reservation_kind TEXT NOT NULL DEFAULT 'individual' CHECK (reservation_kind IN ('individual', 'group'))
  );

  CREATE TABLE IF NOT EXISTS reservation_bungalows (
    reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
    bungalow_id TEXT NOT NULL REFERENCES bungalows(id) ON DELETE RESTRICT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (reservation_id, bungalow_id)
  );

  CREATE TABLE IF NOT EXISTS app_exchange_rate (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cdf_per_usd INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_visitor_entry (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    price_usd INTEGER NOT NULL DEFAULT 10,
    adult_price_usd INTEGER NOT NULL DEFAULT 10,
    minor_price_usd INTEGER NOT NULL DEFAULT 5
  );

  CREATE TABLE IF NOT EXISTS category_rates (
    category TEXT PRIMARY KEY CHECK (category IN ('Premium', 'Deluxe', 'Standard')),
    price_per_night_usd INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bungalow_categories (
    key TEXT PRIMARY KEY CHECK (key IN ('Premium', 'Deluxe', 'Standard')),
    label TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_occupancy_rules (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    grace_days INTEGER NOT NULL DEFAULT 3 CHECK (grace_days >= 1 AND grace_days <= 5),
    penalty_usd INTEGER NOT NULL DEFAULT 0 CHECK (penalty_usd >= 0)
  );

  CREATE TABLE IF NOT EXISTS reservation_payments (
    id TEXT PRIMARY KEY,
    reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
    amount INTEGER NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL DEFAULT 'Espèces',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_reservation_payments_reservation ON reservation_payments(reservation_id);
  CREATE INDEX IF NOT EXISTS idx_reservation_payments_created ON reservation_payments(created_at);

  CREATE TABLE IF NOT EXISTS counter_sales (
    id TEXT PRIMARY KEY,
    amount_cdf INTEGER NOT NULL CHECK (amount_cdf > 0),
    method TEXT NOT NULL DEFAULT 'Espèces',
    label TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
    created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_counter_sales_created_at ON counter_sales(created_at);

  CREATE TABLE IF NOT EXISTS client_profile_types (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    hint TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    email_optional INTEGER NOT NULL DEFAULT 0 CHECK (email_optional IN (0, 1)),
    applies_entry_fee INTEGER NOT NULL DEFAULT 0 CHECK (applies_entry_fee IN (0, 1)),
    default_entry_fee_cdf INTEGER NOT NULL DEFAULT 0
  );
`);

{
  const ccols = db.prepare("PRAGMA table_info(clients)").all() as { name: string }[];
  if (!ccols.some((c) => c.name === "client_profile")) {
    db.exec(`ALTER TABLE clients ADD COLUMN client_profile TEXT NOT NULL DEFAULT 'hebergement'`);
  }
  if (!ccols.some((c) => c.name === "entry_fee_cdf")) {
    db.exec(`ALTER TABLE clients ADD COLUMN entry_fee_cdf INTEGER NOT NULL DEFAULT 0`);
  }
  if (!ccols.some((c) => c.name === "entry_fee_usd")) {
    db.exec(`ALTER TABLE clients ADD COLUMN entry_fee_usd INTEGER NOT NULL DEFAULT 0`);
    const fx = db.prepare("SELECT cdf_per_usd FROM app_exchange_rate WHERE id = 1").get() as
      | { cdf_per_usd: number }
      | undefined;
    const rate = fx?.cdf_per_usd && fx.cdf_per_usd > 0 ? fx.cdf_per_usd : 2850;
    db
      .prepare(
        `UPDATE clients SET entry_fee_usd = CASE
           WHEN COALESCE(entry_fee_cdf, 0) <= 0 THEN 0
           ELSE MAX(1, CAST(ROUND(CAST(entry_fee_cdf AS REAL) / ?) AS INTEGER))
         END`,
      )
      .run(rate);
  }
  if (!ccols.some((c) => c.name === "created_at")) {
    db.exec(`ALTER TABLE clients ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))`);
  }
  if (!ccols.some((c) => c.name === "visitor_party_count")) {
    db.exec("ALTER TABLE clients ADD COLUMN visitor_party_count INTEGER");
  }
  if (!ccols.some((c) => c.name === "visitor_visit_kind")) {
    db.exec("ALTER TABLE clients ADD COLUMN visitor_visit_kind TEXT");
  }
  if (!ccols.some((c) => c.name === "visitor_adults_count")) {
    db.exec("ALTER TABLE clients ADD COLUMN visitor_adults_count INTEGER");
  }
  if (!ccols.some((c) => c.name === "visitor_minors_count")) {
    db.exec("ALTER TABLE clients ADD COLUMN visitor_minors_count INTEGER");
  }
}

{
  const n = (db.prepare("SELECT COUNT(*) AS c FROM client_profile_types").get() as { c: number }).c;
  if (n === 0) {
    const ins = db.prepare(
      `INSERT INTO client_profile_types (code, label, hint, sort_order, email_optional, applies_entry_fee, default_entry_fee_cdf)
       VALUES (@code, @label, @hint, @sort_order, @email_optional, @applies_entry_fee, @default_entry_fee_cdf)`,
    );
    ins.run({
      code: "hebergement",
      label: "Hébergement",
      hint: "Séjour au lodge : réservations, facturation classique.",
      sort_order: 0,
      email_optional: 0,
      applies_entry_fee: 0,
      default_entry_fee_cdf: 0,
    });
    ins.run({
      code: "passage",
      label: "Passage",
      hint: "Visite ou achat ponctuel (ex. buvette) : e-mail facultatif ; droit d’entrée en CDF par visiteur.",
      sort_order: 1,
      email_optional: 1,
      applies_entry_fee: 1,
      default_entry_fee_cdf: 15_000,
    });
    ins.run({
      code: "mixte",
      label: "Mixte",
      hint: "À la fois séjours et visites / achats sur place.",
      sort_order: 2,
      email_optional: 0,
      applies_entry_fee: 0,
      default_entry_fee_cdf: 0,
    });
  }
}

{
  const ptcols = db.prepare("PRAGMA table_info(client_profile_types)").all() as { name: string }[];
  if (!ptcols.some((c) => c.name === "applies_entry_fee")) {
    db.exec(`ALTER TABLE client_profile_types ADD COLUMN applies_entry_fee INTEGER NOT NULL DEFAULT 0`);
    db.exec(`UPDATE client_profile_types SET applies_entry_fee = 1 WHERE code = 'passage'`);
  }
}

{
  const ptcols = db.prepare("PRAGMA table_info(client_profile_types)").all() as { name: string }[];
  if (!ptcols.some((c) => c.name === "default_entry_fee_cdf")) {
    db.exec(`ALTER TABLE client_profile_types ADD COLUMN default_entry_fee_cdf INTEGER NOT NULL DEFAULT 0`);
    db.exec(`UPDATE client_profile_types SET default_entry_fee_cdf = 15000 WHERE code = 'passage'`);
  }
}

{
  const tbl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='clients'").get() as
    | { sql: string }
    | undefined;
  if (tbl?.sql?.includes("CHECK (client_profile")) {
    db.pragma("foreign_keys = OFF");
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(`
        CREATE TABLE clients_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE COLLATE NOCASE,
          phone TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          client_profile TEXT NOT NULL DEFAULT 'hebergement',
          entry_fee_usd INTEGER NOT NULL DEFAULT 0,
          visitor_party_count INTEGER,
          visitor_visit_kind TEXT,
          visitor_adults_count INTEGER,
          visitor_minors_count INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      db.exec(`
        INSERT INTO clients_new (id, name, email, phone, notes, client_profile, entry_fee_usd, visitor_party_count, visitor_visit_kind, visitor_adults_count, visitor_minors_count, created_at)
        SELECT id, name, email, phone, notes, client_profile,
               COALESCE(entry_fee_usd, 0),
               visitor_party_count,
               visitor_visit_kind,
               visitor_adults_count,
               visitor_minors_count,
               COALESCE(created_at, datetime('now')) FROM clients;
      `);
      db.exec("DROP TABLE clients");
      db.exec("ALTER TABLE clients_new RENAME TO clients");
      db.exec("COMMIT");
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }
}

{
  const cols = db.prepare("PRAGMA table_info(reservations)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "amount_paid")) {
    db.exec("ALTER TABLE reservations ADD COLUMN amount_paid INTEGER NOT NULL DEFAULT 0");
    db.exec(
      `UPDATE reservations SET amount_paid = amount WHERE status IN ('Confirmé', 'En cours')`,
    );
  }
}

{
  const rcols = db.prepare("PRAGMA table_info(reservations)").all() as { name: string }[];
  if (!rcols.some((c) => c.name === "late_penalty_usd")) {
    db.exec("ALTER TABLE reservations ADD COLUMN late_penalty_usd INTEGER NOT NULL DEFAULT 0");
  }
}

{
  const rcols = db.prepare("PRAGMA table_info(reservations)").all() as { name: string }[];
  if (!rcols.some((c) => c.name === "guest_count")) {
    db.exec("ALTER TABLE reservations ADD COLUMN guest_count INTEGER NOT NULL DEFAULT 1");
  }
}

{
  const rcols = db.prepare("PRAGMA table_info(reservations)").all() as { name: string }[];
  if (!rcols.some((c) => c.name === "reservation_kind")) {
    db.exec("ALTER TABLE reservations ADD COLUMN reservation_kind TEXT NOT NULL DEFAULT 'individual'");
  }
}

{
  const rcols = db.prepare("PRAGMA table_info(reservations)").all() as { name: string }[];
  if (!rcols.some((c) => c.name === "booking_channel")) {
    db.exec(`ALTER TABLE reservations ADD COLUMN booking_channel TEXT NOT NULL DEFAULT 'direct'`);
  }
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS reservation_bungalows (
      reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      bungalow_id TEXT NOT NULL REFERENCES bungalows(id) ON DELETE RESTRICT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (reservation_id, bungalow_id)
    );
  `);
  const cnt = (db.prepare("SELECT COUNT(*) AS c FROM reservation_bungalows").get() as { c: number }).c;
  if (cnt === 0) {
    const rows = db.prepare("SELECT id, bungalow_id FROM reservations").all() as { id: string; bungalow_id: string }[];
    const ins = db.prepare(
      "INSERT OR IGNORE INTO reservation_bungalows (reservation_id, bungalow_id, sort_order) VALUES (?, ?, 0)",
    );
    for (const row of rows) {
      ins.run(row.id, row.bungalow_id);
    }
  }
}

{
  const bcols = db.prepare("PRAGMA table_info(bungalows)").all() as { name: string }[];
  if (!bcols.some((c) => c.name === "price_per_night_usd")) {
    db.exec("ALTER TABLE bungalows ADD COLUMN price_per_night_usd INTEGER");
    db.prepare(`UPDATE bungalows SET price_per_night_usd = 250 WHERE code = 'B-D-04' COLLATE NOCASE`).run();
  }
}

{
  const bcols = db.prepare("PRAGMA table_info(bungalows)").all() as { name: string }[];
  if (!bcols.some((c) => c.name === "housekeeping_status")) {
    db.exec(`ALTER TABLE bungalows ADD COLUMN housekeeping_status TEXT NOT NULL DEFAULT 'Propre'`);
  }
}

{
  const ccols = db.prepare("PRAGMA table_info(clients)").all() as { name: string }[];
  if (!ccols.some((c) => c.name === "entry_fee_paid_usd")) {
    db.exec("ALTER TABLE clients ADD COLUMN entry_fee_paid_usd INTEGER NOT NULL DEFAULT 0");
  }
}

{
  db.prepare(
    "INSERT OR IGNORE INTO app_occupancy_rules (id, grace_days, penalty_usd) VALUES (1, 3, 50)",
  ).run();
}

{
  const vecols = db.prepare("PRAGMA table_info(app_visitor_entry)").all() as { name: string }[];
  if (!vecols.some((c) => c.name === "adult_price_usd")) {
    db.exec("ALTER TABLE app_visitor_entry ADD COLUMN adult_price_usd INTEGER NOT NULL DEFAULT 10");
  }
  if (!vecols.some((c) => c.name === "minor_price_usd")) {
    db.exec("ALTER TABLE app_visitor_entry ADD COLUMN minor_price_usd INTEGER NOT NULL DEFAULT 5");
  }
  db.prepare(`UPDATE app_visitor_entry SET adult_price_usd = price_usd WHERE id = 1`).run();
  db.prepare(
    `INSERT OR IGNORE INTO app_visitor_entry (id, price_usd, adult_price_usd, minor_price_usd) VALUES (1, 10, 10, 5)`,
  ).run();
  db.prepare(`UPDATE app_visitor_entry SET price_usd = adult_price_usd WHERE id = 1`).run();
}

{
  const n = (db.prepare("SELECT COUNT(*) AS c FROM reservation_payments").get() as { c: number }).c;
  if (n === 0) {
    const due = db
      .prepare("SELECT id, amount_paid FROM reservations WHERE COALESCE(amount_paid, 0) > 0")
      .all() as { id: string; amount_paid: number }[];
    const ins = db.prepare(
      `INSERT INTO reservation_payments (id, reservation_id, amount, method, note, created_at)
       VALUES (@id, @reservation_id, @amount, @method, @note, datetime('now'))`,
    );
    for (const row of due) {
      ins.run({
        id: randomUUID(),
        reservation_id: row.id,
        amount: row.amount_paid,
        method: "Autre",
        note: "Solde porté depuis les données existantes",
      });
    }
  }
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS maintenance_tickets (
      id TEXT PRIMARY KEY,
      bungalow_id TEXT NOT NULL REFERENCES bungalows(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK (category IN ('panne', 'clim', 'plomberie', 'electricite', 'autre')),
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL CHECK (priority IN ('basse', 'normale', 'haute', 'urgente')),
      status TEXT NOT NULL CHECK (status IN ('ouvert', 'en_cours', 'resolu', 'annule')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_bungalow ON maintenance_tickets(bungalow_id);
    CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_status ON maintenance_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_updated ON maintenance_tickets(updated_at);

    CREATE TABLE IF NOT EXISTS maintenance_ticket_events (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES maintenance_tickets(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('created', 'comment', 'status', 'priority', 'attachment', 'edit')),
      body TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_maintenance_ticket_events_ticket ON maintenance_ticket_events(ticket_id);

    CREATE TABLE IF NOT EXISTS maintenance_ticket_attachments (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL REFERENCES maintenance_tickets(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_length INTEGER NOT NULL CHECK (byte_length > 0),
      stored_name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_maintenance_ticket_attachments_ticket ON maintenance_ticket_attachments(ticket_id);
  `);
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS reservation_operational_workflow (
      reservation_id TEXT PRIMARY KEY REFERENCES reservations(id) ON DELETE CASCADE,
      legal_country_code TEXT NOT NULL DEFAULT 'CD',
      id_document_verified_at TEXT,
      deposit_amount_usd INTEGER NOT NULL DEFAULT 0 CHECK (deposit_amount_usd >= 0 AND deposit_amount_usd <= 999999999),
      deposit_method TEXT NOT NULL DEFAULT '',
      deposit_received_at TEXT,
      arrival_signature_at TEXT,
      arrival_inventory_note TEXT NOT NULL DEFAULT '',
      arrival_inventory_ok INTEGER NOT NULL DEFAULT 0 CHECK (arrival_inventory_ok IN (0, 1)),
      check_in_completed_at TEXT,
      departure_extras_note TEXT NOT NULL DEFAULT '',
      departure_extras_amount_usd INTEGER NOT NULL DEFAULT 0 CHECK (departure_extras_amount_usd >= 0 AND departure_extras_amount_usd <= 999999999),
      keys_returned INTEGER NOT NULL DEFAULT 0 CHECK (keys_returned IN (0, 1)),
      keys_note TEXT NOT NULL DEFAULT '',
      check_out_completed_at TEXT,
      legal_documents_ack_at TEXT,
      legal_ack_doc_ids_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_reservation_operational_updated ON reservation_operational_workflow(updated_at);
  `);
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS visitor_entry_payment_ledger (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      amount_usd INTEGER NOT NULL CHECK (amount_usd > 0),
      method TEXT NOT NULL DEFAULT 'Espèces',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_visitor_entry_payment_ledger_created ON visitor_entry_payment_ledger(created_at);
    CREATE INDEX IF NOT EXISTS idx_visitor_entry_payment_ledger_client ON visitor_entry_payment_ledger(client_id);

    CREATE TABLE IF NOT EXISTS accounting_day_closures (
      business_date TEXT PRIMARY KEY CHECK (length(business_date) = 10),
      closed_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      notes TEXT NOT NULL DEFAULT '',
      expected_cash_usd INTEGER NOT NULL,
      expected_cash_cdf INTEGER NOT NULL,
      counted_cash_usd INTEGER,
      counted_cash_cdf INTEGER,
      fx_cdf_per_usd_snapshot INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_accounting_day_closures_closed_at ON accounting_day_closures(closed_at);
  `);
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_invitations (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL COLLATE NOCASE,
      token_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      consumed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_user_invitations_token ON user_invitations(token_hash);
    CREATE INDEX IF NOT EXISTS idx_user_invitations_expires ON user_invitations(expires_at);
  `);
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_invitations_email_pending ON user_invitations(email) WHERE consumed_at IS NULL`,
  );
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_user_roles (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL UNIQUE COLLATE NOCASE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
      is_app_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_app_admin IN (0, 1)),
      can_manage_app_users INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_app_users IN (0, 1)),
      allow_non_admin_invite INTEGER NOT NULL DEFAULT 0 CHECK (allow_non_admin_invite IN (0, 1))
    );
  `);
  const n = (db.prepare("SELECT COUNT(*) AS c FROM app_user_roles").get() as { c: number }).c;
  if (n === 0) {
    const ins = db.prepare(
      `INSERT INTO app_user_roles (id, label, sort_order, is_system, is_app_admin, can_manage_app_users, allow_non_admin_invite)
       VALUES (@id, @label, @sort_order, @is_system, @is_app_admin, @can_manage_app_users, @allow_non_admin_invite)`,
    );
    ins.run({
      id: "sys-ur-admin",
      label: "Administrateur",
      sort_order: 0,
      is_system: 1,
      is_app_admin: 1,
      can_manage_app_users: 1,
      allow_non_admin_invite: 0,
    });
    ins.run({
      id: "sys-ur-reception",
      label: "Réception",
      sort_order: 1,
      is_system: 1,
      is_app_admin: 0,
      can_manage_app_users: 1,
      allow_non_admin_invite: 1,
    });
    ins.run({
      id: "sys-ur-commercial",
      label: "Commercial",
      sort_order: 2,
      is_system: 1,
      is_app_admin: 0,
      can_manage_app_users: 0,
      allow_non_admin_invite: 0,
    });
    ins.run({
      id: "sys-ur-compta",
      label: "Comptabilité",
      sort_order: 3,
      is_system: 1,
      is_app_admin: 0,
      can_manage_app_users: 0,
      allow_non_admin_invite: 0,
    });
    ins.run({
      id: "sys-ur-financie",
      label: "Financié",
      sort_order: 4,
      is_system: 1,
      is_app_admin: 0,
      can_manage_app_users: 0,
      allow_non_admin_invite: 0,
    });
    ins.run({
      id: "sys-ur-comptable",
      label: "Comptable",
      sort_order: 5,
      is_system: 1,
      is_app_admin: 0,
      can_manage_app_users: 0,
      allow_non_admin_invite: 0,
    });
    ins.run({
      id: "sys-ur-serveur",
      label: "Serveur(se)",
      sort_order: 6,
      is_system: 1,
      is_app_admin: 0,
      can_manage_app_users: 0,
      allow_non_admin_invite: 0,
    });
  }
}

{
  const insMigrateRoles = db.prepare(
    `INSERT OR IGNORE INTO app_user_roles (id, label, sort_order, is_system, is_app_admin, can_manage_app_users, allow_non_admin_invite)
     VALUES (@id, @label, @sort_order, @is_system, @is_app_admin, @can_manage_app_users, @allow_non_admin_invite)`,
  );
  insMigrateRoles.run({
    id: "sys-ur-financie",
    label: "Financié",
    sort_order: 4,
    is_system: 1,
    is_app_admin: 0,
    can_manage_app_users: 0,
    allow_non_admin_invite: 0,
  });
  insMigrateRoles.run({
    id: "sys-ur-comptable",
    label: "Comptable",
    sort_order: 5,
    is_system: 1,
    is_app_admin: 0,
    can_manage_app_users: 0,
    allow_non_admin_invite: 0,
  });
  insMigrateRoles.run({
    id: "sys-ur-serveur",
    label: "Serveur(se)",
    sort_order: 6,
    is_system: 1,
    is_app_admin: 0,
    can_manage_app_users: 0,
    allow_non_admin_invite: 0,
  });
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_permissions (
      code TEXT PRIMARY KEY,
      label_fr TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS app_role_permissions (
      role_id TEXT NOT NULL REFERENCES app_user_roles(id) ON DELETE CASCADE,
      permission_code TEXT NOT NULL REFERENCES app_permissions(code),
      PRIMARY KEY (role_id, permission_code)
    );
  `);
  const insPerm = db.prepare(
    `INSERT OR IGNORE INTO app_permissions (code, label_fr, sort_order) VALUES (@code, @label_fr, @sort_order)`,
  );
  for (const p of PERMISSION_CATALOG) {
    insPerm.run({ code: p.code, label_fr: p.labelFr, sort_order: p.sortOrder });
  }
  const jcnt = (db.prepare(`SELECT COUNT(*) AS c FROM app_role_permissions`).get() as { c: number }).c;
  if (jcnt === 0) {
    const roles = db
      .prepare(`SELECT id, is_app_admin, can_manage_app_users FROM app_user_roles`)
      .all() as { id: string; is_app_admin: number; can_manage_app_users: number }[];
    const insJ = db.prepare(
      `INSERT OR IGNORE INTO app_role_permissions (role_id, permission_code) VALUES (?, ?)`,
    );
    for (const r of roles) {
      if (r.is_app_admin === 1) continue;
      if (r.can_manage_app_users === 1) {
        insJ.run(r.id, "users.invite");
        insJ.run(r.id, "users.manage");
        insJ.run(r.id, "accounting.close_day");
      }
    }
  }
}

{
  const insRolePerm = db.prepare(
    `INSERT OR IGNORE INTO app_role_permissions (role_id, permission_code) VALUES (?, ?)`,
  );
  for (const code of LODGING_MODULE_CODES) {
    insRolePerm.run("sys-ur-reception", code);
  }
  insRolePerm.run("sys-ur-commercial", "lodging.reservations");
  /** Réception : hébergement + répertoire ; pas de droits Finance par défaut (à cocher dans Rôles si besoin). */
  insRolePerm.run("sys-ur-reception", "directory.clients");
  for (const c of ["directory.clients", "finance.invoices", "finance.payments", "finance.counter"]) {
    insRolePerm.run("sys-ur-commercial", c);
  }
  for (const c of ["finance.payments", "finance.counter", "finance.invoices", "directory.clients"]) {
    insRolePerm.run("sys-ur-financie", c);
  }
  for (const c of ["finance.payments", "finance.invoices", "directory.clients"]) {
    insRolePerm.run("sys-ur-compta", c);
    insRolePerm.run("sys-ur-comptable", c);
  }
  for (const c of ["finance.reports"]) {
    insRolePerm.run("sys-ur-commercial", c);
    insRolePerm.run("sys-ur-compta", c);
    insRolePerm.run("sys-ur-financie", c);
    insRolePerm.run("sys-ur-comptable", c);
  }
  for (const c of ["finance.treasury", "finance.cash_book"]) {
    insRolePerm.run("sys-ur-commercial", c);
    insRolePerm.run("sys-ur-financie", c);
    insRolePerm.run("sys-ur-compta", c);
    insRolePerm.run("sys-ur-comptable", c);
  }
  /** Serveur(se) : répertoire ; service salle via `sales.floor` (pas droit caisse comptoir). */
  insRolePerm.run("sys-ur-serveur", "directory.clients");
  db.prepare(
    `DELETE FROM app_role_permissions WHERE role_id = 'sys-ur-serveur' AND permission_code = 'finance.counter'`,
  ).run();
}

{
  db.prepare(`DELETE FROM app_role_permissions WHERE role_id = 'sys-ur-caissiere-terrasse'`).run();
  db.prepare(`DELETE FROM app_user_roles WHERE id = 'sys-ur-caissiere-terrasse'`).run();
}

{
  const insReceptionCash = db.prepare(
    `INSERT OR IGNORE INTO app_role_permissions (role_id, permission_code) VALUES (?, ?)`,
  );
  const legacyReceptionRoles = db
    .prepare(
      `SELECT DISTINCT role_id FROM app_role_permissions
       WHERE permission_code IN ('lodging.reservations', 'lodging.stay_reception')`,
    )
    .all() as { role_id: string }[];
  for (const r of legacyReceptionRoles) {
    insReceptionCash.run(r.role_id, "lodging.reception_cash");
  }
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL DEFAULT (datetime('now')),
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      meta_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
  `);
}

{
  const ccols = db.prepare("PRAGMA table_info(clients)").all() as { name: string }[];
  if (!ccols.some((c) => c.name === "updated_at")) {
    db.exec(`ALTER TABLE clients ADD COLUMN updated_at TEXT`);
    db.exec(
      `UPDATE clients SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL`,
    );
  }
}

{
  const bcols = db.prepare("PRAGMA table_info(bungalows)").all() as { name: string }[];
  if (!bcols.some((c) => c.name === "created_at")) {
    db.exec(`ALTER TABLE bungalows ADD COLUMN created_at TEXT`);
    db.exec(`ALTER TABLE bungalows ADD COLUMN updated_at TEXT`);
    db.exec(
      `UPDATE bungalows SET created_at = datetime('now'), updated_at = datetime('now') WHERE created_at IS NULL`,
    );
  }
}

{
  const rcols = db.prepare("PRAGMA table_info(reservations)").all() as { name: string }[];
  if (!rcols.some((c) => c.name === "created_at")) {
    db.exec(`ALTER TABLE reservations ADD COLUMN created_at TEXT`);
    db.exec(`ALTER TABLE reservations ADD COLUMN updated_at TEXT`);
    db.exec(
      `UPDATE reservations SET created_at = datetime('now'), updated_at = datetime('now') WHERE created_at IS NULL`,
    );
  }
}

{
  const ucols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!ucols.some((c) => c.name === "created_at")) {
    db.exec(`ALTER TABLE users ADD COLUMN created_at TEXT`);
    db.exec(`ALTER TABLE users ADD COLUMN updated_at TEXT`);
    db.exec(
      `UPDATE users SET created_at = datetime('now'), updated_at = datetime('now') WHERE created_at IS NULL`,
    );
  }
  if (!ucols.some((c) => c.name === "last_login_at")) {
    db.exec(`ALTER TABLE users ADD COLUMN last_login_at TEXT`);
  }
  if (!ucols.some((c) => c.name === "totp_enabled")) {
    db.exec(`ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0 CHECK (totp_enabled IN (0, 1))`);
  }
  if (!ucols.some((c) => c.name === "totp_secret")) {
    db.exec(`ALTER TABLE users ADD COLUMN totp_secret TEXT`);
  }
  if (!ucols.some((c) => c.name === "totp_pending_secret")) {
    db.exec(`ALTER TABLE users ADD COLUMN totp_pending_secret TEXT`);
  }
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      user_agent TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(user_id, revoked_at);
  `);
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_locations (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      label TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('depot', 'consumption')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS stock_points_of_sale (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_main INTEGER NOT NULL DEFAULT 0 CHECK (is_main IN (0, 1)),
      stock_location_id TEXT NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
    );
    CREATE INDEX IF NOT EXISTS idx_stock_pos_location ON stock_points_of_sale(stock_location_id);

    CREATE TABLE IF NOT EXISTS stock_suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      lead_time_days INTEGER,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_items (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      label TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'unite',
      unit_qty REAL NOT NULL DEFAULT 1 CHECK (unit_qty > 0),
      category TEXT NOT NULL DEFAULT 'general',
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      avg_cost_cdf INTEGER NOT NULL DEFAULT 0 CHECK (avg_cost_cdf >= 0),
      sale_price_usd_cents INTEGER NOT NULL DEFAULT 0 CHECK (sale_price_usd_cents >= 0 AND sale_price_usd_cents <= 999999999),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_documents (
      id TEXT PRIMARY KEY,
      doc_type TEXT NOT NULL CHECK (doc_type IN ('receipt', 'transfer', 'adjustment', 'inventory')),
      supplier_id TEXT REFERENCES stock_suppliers(id) ON DELETE SET NULL,
      from_location_id TEXT REFERENCES stock_locations(id) ON DELETE SET NULL,
      to_location_id TEXT REFERENCES stock_locations(id) ON DELETE SET NULL,
      external_ref TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stock_documents_created ON stock_documents(created_at DESC);

    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES stock_documents(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES stock_items(id) ON DELETE RESTRICT,
      location_id TEXT NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
      qty_delta REAL NOT NULL,
      unit_cost_cdf INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cdf >= 0),
      ledger_kind TEXT NOT NULL CHECK (ledger_kind IN ('receipt', 'transfer_out', 'transfer_in', 'adjustment', 'inventory')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_stock_movements_doc ON stock_movements(document_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_item_loc ON stock_movements(item_id, location_id);

    CREATE TABLE IF NOT EXISTS stock_item_location_policies (
      item_id TEXT NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
      location_id TEXT NOT NULL REFERENCES stock_locations(id) ON DELETE CASCADE,
      min_qty REAL,
      max_qty REAL,
      reorder_point REAL,
      PRIMARY KEY (item_id, location_id)
    );
  `);

  const cscols = db.prepare("PRAGMA table_info(counter_sales)").all() as { name: string }[];
  if (!cscols.some((c) => c.name === "point_of_sale_id")) {
    db.exec(`
      ALTER TABLE counter_sales ADD COLUMN point_of_sale_id TEXT REFERENCES stock_points_of_sale(id) ON DELETE SET NULL;
    `);
  }

  const nLoc = (db.prepare("SELECT COUNT(*) AS c FROM stock_locations").get() as { c: number }).c;
  if (nLoc === 0) {
    const insLoc = db.prepare(
      `INSERT INTO stock_locations (id, code, label, kind, sort_order, active) VALUES (@id, @code, @label, @kind, @sort_order, 1)`,
    );
    insLoc.run({
      id: "loc-depot",
      code: "DEPOT",
      label: "Dépôt central",
      kind: "depot",
      sort_order: 0,
    });
    insLoc.run({
      id: "loc-resto",
      code: "RESTO",
      label: "Restaurant / cuisine",
      kind: "consumption",
      sort_order: 1,
    });
    insLoc.run({
      id: "loc-t1",
      code: "T1",
      label: "Terrasse 1 — caisse principale",
      kind: "consumption",
      sort_order: 2,
    });
    insLoc.run({
      id: "loc-piscine",
      code: "PISCINE",
      label: "Terrasse piscine",
      kind: "consumption",
      sort_order: 3,
    });
    insLoc.run({
      id: "loc-padel",
      code: "PADEL",
      label: "Terrasse Padel",
      kind: "consumption",
      sort_order: 4,
    });

    const insPos = db.prepare(
      `INSERT INTO stock_points_of_sale (id, code, label, sort_order, is_main, stock_location_id, active)
       VALUES (@id, @code, @label, @sort_order, @is_main, @stock_location_id, 1)`,
    );
    insPos.run({
      id: "pos-t1",
      code: "T1",
      label: "Terrasse 1 (caisse principale)",
      sort_order: 0,
      is_main: 1,
      stock_location_id: "loc-t1",
    });
    insPos.run({
      id: "pos-piscine",
      code: "PISCINE",
      label: "Terrasse piscine",
      sort_order: 1,
      is_main: 0,
      stock_location_id: "loc-piscine",
    });
    insPos.run({
      id: "pos-padel",
      code: "PADEL",
      label: "Terrasse Padel",
      sort_order: 2,
      is_main: 0,
      stock_location_id: "loc-padel",
    });
  }

  db.prepare(
    `UPDATE counter_sales SET point_of_sale_id = 'pos-t1' WHERE point_of_sale_id IS NULL`,
  ).run();

  const insRolePerm = db.prepare(
    `INSERT OR IGNORE INTO app_role_permissions (role_id, permission_code) VALUES (?, ?)`,
  );
  insRolePerm.run("sys-ur-reception", "logistics.inventory");
  insRolePerm.run("sys-ur-compta", "logistics.inventory");
  insRolePerm.run("sys-ur-comptable", "logistics.inventory");
  insRolePerm.run("sys-ur-commercial", "logistics.po_release_finance");
  insRolePerm.run("sys-ur-financie", "logistics.po_release_finance");
  insRolePerm.run("sys-ur-compta", "logistics.po_release_accounting");
  insRolePerm.run("sys-ur-comptable", "logistics.po_release_accounting");
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_purchase_orders (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL REFERENCES stock_suppliers(id),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'pending_payment', 'approved', 'rejected', 'closed')),
      note TEXT NOT NULL DEFAULT '',
      external_ref TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      submitted_at TEXT,
      manager_approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      manager_approved_at TEXT,
      dg_approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      dg_approved_at TEXT,
      finance_released_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      finance_released_at TEXT,
      finance_funding_detail TEXT NOT NULL DEFAULT '',
      accounting_released_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      accounting_released_at TEXT,
      accounting_funding_detail TEXT NOT NULL DEFAULT '',
      rejected_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      rejected_at TEXT,
      rejection_note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_stock_po_status ON stock_purchase_orders(status);
    CREATE INDEX IF NOT EXISTS idx_stock_po_supplier ON stock_purchase_orders(supplier_id);

    CREATE TABLE IF NOT EXISTS stock_purchase_order_lines (
      id TEXT PRIMARY KEY,
      purchase_order_id TEXT NOT NULL REFERENCES stock_purchase_orders(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES stock_items(id),
      qty_ordered REAL NOT NULL CHECK (qty_ordered > 0),
      unit_cost_cdf_est INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cdf_est >= 0),
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE (purchase_order_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_stock_po_lines_po ON stock_purchase_order_lines(purchase_order_id);
  `);

  const poCols = db.prepare("PRAGMA table_info(stock_purchase_orders)").all() as { name: string }[];
  if (poCols.length > 0 && !poCols.some((c) => c.name === "finance_released_by_user_id")) {
    db.pragma("foreign_keys = OFF");
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec(`
        CREATE TABLE stock_purchase_orders_mig (
          id TEXT PRIMARY KEY,
          supplier_id TEXT NOT NULL REFERENCES stock_suppliers(id),
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'pending_payment', 'approved', 'rejected', 'closed')),
          note TEXT NOT NULL DEFAULT '',
          external_ref TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          submitted_at TEXT,
          manager_approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          manager_approved_at TEXT,
          dg_approved_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          dg_approved_at TEXT,
          finance_released_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          finance_released_at TEXT,
          accounting_released_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          accounting_released_at TEXT,
          rejected_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          rejected_at TEXT,
          rejection_note TEXT NOT NULL DEFAULT ''
        );
      `);
      db.exec(`
        INSERT INTO stock_purchase_orders_mig (
          id, supplier_id, status, note, external_ref, created_at, created_by_user_id, submitted_at,
          manager_approved_by_user_id, manager_approved_at, dg_approved_by_user_id, dg_approved_at,
          finance_released_by_user_id, finance_released_at, accounting_released_by_user_id, accounting_released_at,
          rejected_by_user_id, rejected_at, rejection_note
        )
        SELECT
          id, supplier_id, status, note, external_ref, created_at, created_by_user_id, submitted_at,
          manager_approved_by_user_id, manager_approved_at, dg_approved_by_user_id, dg_approved_at,
          NULL, NULL, NULL, NULL,
          rejected_by_user_id, rejected_at, rejection_note
        FROM stock_purchase_orders;
      `);
      db.exec(`DROP TABLE stock_purchase_orders`);
      db.exec(`ALTER TABLE stock_purchase_orders_mig RENAME TO stock_purchase_orders`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_po_status ON stock_purchase_orders(status)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_po_supplier ON stock_purchase_orders(supplier_id)`);
      db.exec("COMMIT");
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }

  const poFundingCols = db.prepare("PRAGMA table_info(stock_purchase_orders)").all() as { name: string }[];
  if (poFundingCols.length > 0) {
    if (!poFundingCols.some((c) => c.name === "finance_funding_detail")) {
      db.exec(`ALTER TABLE stock_purchase_orders ADD COLUMN finance_funding_detail TEXT NOT NULL DEFAULT ''`);
    }
    if (!poFundingCols.some((c) => c.name === "accounting_funding_detail")) {
      db.exec(`ALTER TABLE stock_purchase_orders ADD COLUMN accounting_funding_detail TEXT NOT NULL DEFAULT ''`);
    }
    if (!poFundingCols.some((c) => c.name === "supplier_payment_recorded_at")) {
      db.exec(`ALTER TABLE stock_purchase_orders ADD COLUMN supplier_payment_recorded_at TEXT`);
    }
    if (!poFundingCols.some((c) => c.name === "supplier_payment_movement_id")) {
      db.exec(`ALTER TABLE stock_purchase_orders ADD COLUMN supplier_payment_movement_id TEXT`);
    }
  }

  const poCreateSqlRow = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'stock_purchase_orders'")
    .get() as { sql: string } | undefined;
  const poCreateSql = poCreateSqlRow?.sql ?? "";
  if (poCreateSql.includes("pending_finance")) {
    db.pragma("foreign_keys = OFF");
    try {
      db.exec("BEGIN IMMEDIATE");
      const createPp = poCreateSql
        .replace(/^CREATE TABLE stock_purchase_orders\b/m, "CREATE TABLE stock_purchase_orders__pp")
        .replace(
          /CHECK\s*\(\s*status\s+IN\s*\([^)]+\)\s*\)/i,
          "CHECK (status IN ('draft', 'submitted', 'pending_payment', 'approved', 'rejected', 'closed'))",
        );
      db.exec("DROP TABLE IF EXISTS stock_purchase_orders__pp");
      db.exec(createPp);
      const colMeta = db
        .prepare("PRAGMA table_info(stock_purchase_orders)")
        .all() as { name: string; cid: number }[];
      const colNames = [...colMeta].sort((a, b) => a.cid - b.cid).map((r) => r.name);
      const selectParts = colNames.map((c) =>
        c === "status"
          ? `(CASE WHEN status = 'pending_finance' THEN 'pending_payment' ELSE status END)`
          : c,
      );
      db.exec(
        `INSERT INTO stock_purchase_orders__pp (${colNames.join(", ")}) SELECT ${selectParts.join(", ")} FROM stock_purchase_orders`,
      );
      db.exec(`DROP TABLE stock_purchase_orders`);
      db.exec(`ALTER TABLE stock_purchase_orders__pp RENAME TO stock_purchase_orders`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_po_status ON stock_purchase_orders(status)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_stock_po_supplier ON stock_purchase_orders(supplier_id)`);
      db.exec("COMMIT");
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw e;
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }

  const doccols = db.prepare("PRAGMA table_info(stock_documents)").all() as { name: string }[];
  if (!doccols.some((c) => c.name === "purchase_order_id")) {
    db.exec(
      `ALTER TABLE stock_documents ADD COLUMN purchase_order_id TEXT REFERENCES stock_purchase_orders(id) ON DELETE SET NULL`,
    );
  }
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_item_categories (
      code TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
    );
    CREATE TABLE IF NOT EXISTS stock_item_units (
      code TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
    );
    CREATE TABLE IF NOT EXISTS stock_item_subcategories (
      code TEXT PRIMARY KEY,
      category_code TEXT NOT NULL REFERENCES stock_item_categories(code) ON DELETE CASCADE,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
    );
    CREATE INDEX IF NOT EXISTS idx_stock_item_subcats_cat ON stock_item_subcategories(category_code);
  `);

  /** Référentiel catégories : toujours INSERT OR IGNORE pour bases manquantes (évite FK sous-catégories si la table n’était pas vide sans les codes standard). */
  const insCatOrIgnore = db.prepare(
    `INSERT OR IGNORE INTO stock_item_categories (code, label, sort_order, active) VALUES (@code, @label, @sort_order, 1)`,
  );
  for (const row of [
    { code: "general", label: "Général", sort_order: 0 },
    { code: "restauration", label: "Restauration", sort_order: 1 },
    { code: "minibar", label: "Minibar", sort_order: 2 },
    { code: "linge", label: "Linge", sort_order: 3 },
    { code: "hygiene_entretien", label: "Hygiène & entretien", sort_order: 4 },
    { code: "consommables_chambre", label: "Consommables chambre", sort_order: 5 },
  ] as const) {
    insCatOrIgnore.run(row);
  }

  const insUnitOrIgnore = db.prepare(
    `INSERT OR IGNORE INTO stock_item_units (code, label, sort_order, active) VALUES (@code, @label, @sort_order, 1)`,
  );
  for (const row of [
    { code: "unite", label: "Unité", sort_order: 0 },
    { code: "kg", label: "Kilogramme", sort_order: 1 },
    { code: "l", label: "Litre", sort_order: 2 },
    { code: "carton", label: "Carton", sort_order: 3 },
    { code: "colis", label: "Colis / pack", sort_order: 4 },
    { code: "rouleau", label: "Rouleau", sort_order: 5 },
    { code: "palette", label: "Palette", sort_order: 6 },
  ] as const) {
    insUnitOrIgnore.run(row);
  }

  const stockItemsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='stock_items'")
    .get() as { sql: string } | undefined;
  if (stockItemsSql?.sql?.includes("CHECK (category IN")) {
    const runMig = db.transaction(() => {
      db.exec(`
        CREATE TABLE stock_items_mig (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL UNIQUE COLLATE NOCASE,
          label TEXT NOT NULL,
          unit TEXT NOT NULL DEFAULT 'unite',
          unit_qty REAL NOT NULL DEFAULT 1 CHECK (unit_qty > 0),
          category TEXT NOT NULL DEFAULT 'general',
          active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
          avg_cost_cdf INTEGER NOT NULL DEFAULT 0 CHECK (avg_cost_cdf >= 0),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO stock_items_mig (id, code, label, unit, unit_qty, category, active, avg_cost_cdf, created_at)
        SELECT
          id,
          code,
          label,
          CASE lower(trim(COALESCE(unit, '')))
            WHEN '' THEN 'unite'
            WHEN 'unité' THEN 'unite'
            WHEN 'unite' THEN 'unite'
            WHEN 'kg' THEN 'kg'
            WHEN 'kilogramme' THEN 'kg'
            WHEN 'l' THEN 'l'
            WHEN 'litre' THEN 'l'
            WHEN 'ltr' THEN 'l'
            WHEN 'carton' THEN 'carton'
            WHEN 'cartons' THEN 'carton'
            ELSE lower(replace(trim(unit), ' ', '_'))
          END,
          1,
          category,
          active,
          avg_cost_cdf,
          created_at
        FROM stock_items;
        DROP TABLE stock_items;
        ALTER TABLE stock_items_mig RENAME TO stock_items;
      `);
    });
    runMig();
  }

  const ensureUnit = db.prepare(
    `INSERT OR IGNORE INTO stock_item_units (code, label, sort_order, active) VALUES (?, ?, 900, 1)`,
  );
  const orphanUnits = db
    .prepare(
      `SELECT DISTINCT i.unit AS code FROM stock_items i
       LEFT JOIN stock_item_units u ON u.code = i.unit
       WHERE u.code IS NULL AND i.unit IS NOT NULL AND trim(i.unit) != ''`,
    )
    .all() as { code: string }[];
  for (const row of orphanUnits) {
    ensureUnit.run(row.code, row.code);
  }

  const ensureCat = db.prepare(
    `INSERT OR IGNORE INTO stock_item_categories (code, label, sort_order, active) VALUES (?, ?, 900, 1)`,
  );
  const orphanCats = db
    .prepare(
      `SELECT DISTINCT i.category AS code FROM stock_items i
       LEFT JOIN stock_item_categories c ON c.code = i.category
       WHERE c.code IS NULL AND i.category IS NOT NULL AND trim(i.category) != ''`,
    )
    .all() as { code: string }[];
  for (const row of orphanCats) {
    ensureCat.run(row.code, row.code);
  }

  db.prepare(`UPDATE stock_items SET category = 'general' WHERE category NOT IN (SELECT code FROM stock_item_categories)`).run();
  db.prepare(`UPDATE stock_items SET unit = 'unite' WHERE unit NOT IN (SELECT code FROM stock_item_units)`).run();

  const defaultStockSubcategories: { code: string; category_code: string; label: string; sort_order: number }[] = [
    { code: "divers", category_code: "general", label: "Divers", sort_order: 10 },
    { code: "fournitures_bureau", category_code: "general", label: "Fournitures bureau", sort_order: 20 },
    { code: "aliments_secs", category_code: "restauration", label: "Aliments secs", sort_order: 10 },
    { code: "aliments_frais", category_code: "restauration", label: "Produits frais", sort_order: 20 },
    { code: "surgeles", category_code: "restauration", label: "Surgelés", sort_order: 30 },
    { code: "epices_condiments", category_code: "restauration", label: "Épices & condiments", sort_order: 40 },
    { code: "boissons_service", category_code: "restauration", label: "Boissons (service restauration / bar)", sort_order: 50 },
    { code: "boissons_alcool_service", category_code: "restauration", label: "Boissons alcool (service)", sort_order: 60 },
    { code: "soft", category_code: "minibar", label: "Sans alcool", sort_order: 10 },
    { code: "alcool", category_code: "minibar", label: "Avec alcool", sort_order: 20 },
    { code: "encas", category_code: "minibar", label: "Encas", sort_order: 30 },
    { code: "lit", category_code: "linge", label: "Linge de lit", sort_order: 10 },
    { code: "bain", category_code: "linge", label: "Linge de bain", sort_order: 20 },
    { code: "piscine", category_code: "linge", label: "Linge / textile piscine", sort_order: 30 },
    { code: "papier_sanitaire", category_code: "hygiene_entretien", label: "Papier sanitaire", sort_order: 10 },
    { code: "papier_menager", category_code: "hygiene_entretien", label: "Papier ménager", sort_order: 20 },
    { code: "sacs_dechets", category_code: "hygiene_entretien", label: "Sacs & déchets", sort_order: 30 },
    { code: "produits_nettoyage", category_code: "hygiene_entretien", label: "Produits nettoyage", sort_order: 40 },
    { code: "desinfection", category_code: "hygiene_entretien", label: "Désinfection", sort_order: 50 },
    { code: "amenities", category_code: "consommables_chambre", label: "Produits d'accueil", sort_order: 10 },
    { code: "jetable_chambre", category_code: "consommables_chambre", label: "Jetable chambre", sort_order: 20 },
  ];
  const insSubOrIgnore = db.prepare(
    `INSERT OR IGNORE INTO stock_item_subcategories (code, category_code, label, sort_order, active) VALUES (@code, @category_code, @label, @sort_order, 1)`,
  );
  for (const row of defaultStockSubcategories) {
    insSubOrIgnore.run(row);
  }

  const stockItemCols = db.prepare("PRAGMA table_info(stock_items)").all() as { name: string }[];
  if (!stockItemCols.some((c) => c.name === "unit_qty")) {
    db.exec(`ALTER TABLE stock_items ADD COLUMN unit_qty REAL NOT NULL DEFAULT 1`);
    db.prepare(`UPDATE stock_items SET unit_qty = 1 WHERE unit_qty IS NULL OR unit_qty <= 0`).run();
  }

  const stockItemCols2 = db.prepare("PRAGMA table_info(stock_items)").all() as { name: string }[];
  if (!stockItemCols2.some((c) => c.name === "subcategory")) {
    db.exec(`ALTER TABLE stock_items ADD COLUMN subcategory TEXT NOT NULL DEFAULT ''`);
  }

  let stockItemSaleCols = db.prepare("PRAGMA table_info(stock_items)").all() as { name: string }[];
  if (!stockItemSaleCols.some((c) => c.name === "sale_price_usd_cents")) {
    db.exec(
      `ALTER TABLE stock_items ADD COLUMN sale_price_usd_cents INTEGER NOT NULL DEFAULT 0 CHECK (sale_price_usd_cents >= 0 AND sale_price_usd_cents <= 999999999)`,
    );
    stockItemSaleCols = db.prepare("PRAGMA table_info(stock_items)").all() as { name: string }[];
  }
  if (stockItemSaleCols.some((c) => c.name === "sale_price_cdf")) {
    try {
      db.exec(`ALTER TABLE stock_items DROP COLUMN sale_price_cdf`);
    } catch {
      /* SQLite < 3.35 : colonne obsolète ignorée par l’application */
    }
  }

  const supCols = db.prepare("PRAGMA table_info(stock_suppliers)").all() as { name: string }[];
  if (!supCols.some((c) => c.name === "lead_time_days")) {
    db.exec(`ALTER TABLE stock_suppliers ADD COLUMN lead_time_days INTEGER`);
  }
  if (!supCols.some((c) => c.name === "address")) {
    db.exec(`ALTER TABLE stock_suppliers ADD COLUMN address TEXT NOT NULL DEFAULT ''`);
  }
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS treasury_register_reports (
      id TEXT PRIMARY KEY,
      point_of_sale_id TEXT NOT NULL REFERENCES stock_points_of_sale(id) ON DELETE RESTRICT,
      report_date TEXT NOT NULL,
      opening_float_cdf INTEGER NOT NULL DEFAULT 0 CHECK (opening_float_cdf >= 0 AND opening_float_cdf <= 999999999),
      counted_cash_cdf INTEGER NOT NULL CHECK (counted_cash_cdf >= 0 AND counted_cash_cdf <= 999999999),
      notes_cashier TEXT NOT NULL DEFAULT '',
      submitted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(point_of_sale_id, report_date)
    );
    CREATE INDEX IF NOT EXISTS idx_treasury_reports_date ON treasury_register_reports(report_date DESC);
    CREATE INDEX IF NOT EXISTS idx_treasury_reports_pos ON treasury_register_reports(point_of_sale_id);
  `);
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_cash_accounts (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      label TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('physical', 'bank')),
      currency TEXT NOT NULL DEFAULT 'CDF' CHECK (currency IN ('CDF', 'USD')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_finance_cash_accounts_active ON finance_cash_accounts(active, sort_order);

    CREATE TABLE IF NOT EXISTS finance_cash_movements (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK (category IN (
        'expense', 'bank_deposit', 'bank_withdrawal', 'adjustment_in', 'adjustment_out'
      )),
      occurred_at TEXT NOT NULL,
      source_account_id TEXT REFERENCES finance_cash_accounts(id) ON DELETE RESTRICT,
      target_account_id TEXT REFERENCES finance_cash_accounts(id) ON DELETE RESTRICT,
      amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= 9007199254740991),
      currency TEXT NOT NULL DEFAULT 'CDF' CHECK (currency IN ('CDF', 'USD')),
      label TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_finance_cash_mov_occurred ON finance_cash_movements(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_finance_cash_mov_source ON finance_cash_movements(source_account_id);
    CREATE INDEX IF NOT EXISTS idx_finance_cash_mov_target ON finance_cash_movements(target_account_id);
  `);

  const movSqlRow = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='finance_cash_movements'`)
    .get() as { sql: string } | undefined;
  if (movSqlRow?.sql?.includes("amount <= 999999999")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      ALTER TABLE finance_cash_movements RENAME TO finance_cash_movements_old;
      CREATE TABLE finance_cash_movements (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL CHECK (category IN (
          'expense', 'bank_deposit', 'bank_withdrawal', 'adjustment_in', 'adjustment_out'
        )),
        occurred_at TEXT NOT NULL,
        source_account_id TEXT REFERENCES finance_cash_accounts(id) ON DELETE RESTRICT,
        target_account_id TEXT REFERENCES finance_cash_accounts(id) ON DELETE RESTRICT,
        amount INTEGER NOT NULL CHECK (amount > 0 AND amount <= 9007199254740991),
        currency TEXT NOT NULL DEFAULT 'CDF' CHECK (currency IN ('CDF', 'USD')),
        label TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO finance_cash_movements SELECT * FROM finance_cash_movements_old;
      DROP TABLE finance_cash_movements_old;
      CREATE INDEX IF NOT EXISTS idx_finance_cash_mov_occurred ON finance_cash_movements(occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_finance_cash_mov_source ON finance_cash_movements(source_account_id);
      CREATE INDEX IF NOT EXISTS idx_finance_cash_mov_target ON finance_cash_movements(target_account_id);
      PRAGMA foreign_keys = ON;
    `);
  }

  const nAcc = (db.prepare("SELECT COUNT(*) AS c FROM finance_cash_accounts").get() as { c: number }).c;
  if (nAcc === 0) {
    const ins = db.prepare(
      `INSERT INTO finance_cash_accounts (id, code, label, kind, currency, sort_order, active)
       VALUES (@id, @code, @label, @kind, @currency, @sort_order, 1)`,
    );
    ins.run({
      id: "fca-caisse-cdf",
      code: "CAISSE_CDF",
      label: "Caisse principale (espèces CDF)",
      kind: "physical",
      currency: "CDF",
      sort_order: 0,
    });
    ins.run({
      id: "fca-banque-cdf",
      code: "BANQUE_CDF",
      label: "Compte bancaire principal (CDF)",
      kind: "bank",
      currency: "CDF",
      sort_order: 1,
    });
  }
  const nUsdPhy = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM finance_cash_accounts WHERE active = 1 AND kind = 'physical' AND currency = 'USD'`,
      )
      .get() as { c: number }
  ).c;
  if (nUsdPhy === 0) {
    const maxSo = (
      db.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM finance_cash_accounts`).get() as { m: number }
    ).m;
    const insUsd = db.prepare(
      `INSERT INTO finance_cash_accounts (id, code, label, kind, currency, sort_order, active)
       VALUES (@id, @code, @label, @kind, @currency, @sort_order, 1)`,
    );
    insUsd.run({
      id: "fca-caisse-usd",
      code: "CAISSE_USD",
      label: "Caisse réception (USD)",
      kind: "physical",
      currency: "USD",
      sort_order: maxSo + 1,
    });
  }
}

{
  const trcols = db.prepare("PRAGMA table_info(treasury_register_reports)").all() as { name: string }[];
  if (!trcols.some((c) => c.name === "status")) {
    db.exec(`ALTER TABLE treasury_register_reports ADD COLUMN status TEXT`);
    db.exec(`ALTER TABLE treasury_register_reports ADD COLUMN validated_at TEXT`);
    db.exec(
      `ALTER TABLE treasury_register_reports ADD COLUMN validated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL`,
    );
    db.exec(
      `ALTER TABLE treasury_register_reports ADD COLUMN cash_book_movement_id TEXT REFERENCES finance_cash_movements(id) ON DELETE SET NULL`,
    );
    db.exec(`ALTER TABLE treasury_register_reports ADD COLUMN notes_treasury TEXT NOT NULL DEFAULT ''`);
    db.prepare(`UPDATE treasury_register_reports SET status = 'validated' WHERE status IS NULL`).run();
  }
}

{
  const recExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reception_register_reports'")
    .get() as { name: string } | undefined;
  const recCols = recExists
    ? (db.prepare("PRAGMA table_info(reception_register_reports)").all() as { name: string }[])
    : [];
  const hasOwnerCol = recCols.some((c) => c.name === "report_owner_user_id");

  if (!recExists) {
    db.exec(`
      CREATE TABLE reception_register_reports (
        id TEXT PRIMARY KEY,
        report_date TEXT NOT NULL,
        report_owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        opening_float_usd INTEGER NOT NULL DEFAULT 0 CHECK (opening_float_usd >= 0 AND opening_float_usd <= 999999999),
        counted_cash_usd INTEGER NOT NULL CHECK (counted_cash_usd >= 0 AND counted_cash_usd <= 999999999),
        notes_cashier TEXT NOT NULL DEFAULT '',
        submitted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
        status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'validated')),
        validated_at TEXT,
        validated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        cash_book_movement_id TEXT REFERENCES finance_cash_movements(id) ON DELETE SET NULL,
        notes_treasury TEXT NOT NULL DEFAULT '',
        UNIQUE(report_date, report_owner_user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_reception_register_reports_date ON reception_register_reports(report_date DESC);
    `);
  } else if (!hasOwnerCol) {
    const fallbackUser = db.prepare(`SELECT id FROM users ORDER BY email ASC LIMIT 1`).get() as { id: string } | undefined;
    if (!fallbackUser) {
      db.exec(`DROP TABLE reception_register_reports`);
      db.exec(`
        CREATE TABLE reception_register_reports (
          id TEXT PRIMARY KEY,
          report_date TEXT NOT NULL,
          report_owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          opening_float_usd INTEGER NOT NULL DEFAULT 0 CHECK (opening_float_usd >= 0 AND opening_float_usd <= 999999999),
          counted_cash_usd INTEGER NOT NULL CHECK (counted_cash_usd >= 0 AND counted_cash_usd <= 999999999),
          notes_cashier TEXT NOT NULL DEFAULT '',
          submitted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
          status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'validated')),
          validated_at TEXT,
          validated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          cash_book_movement_id TEXT REFERENCES finance_cash_movements(id) ON DELETE SET NULL,
          notes_treasury TEXT NOT NULL DEFAULT '',
          UNIQUE(report_date, report_owner_user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_reception_register_reports_date ON reception_register_reports(report_date DESC);
      `);
    } else {
      db.exec(`
        CREATE TABLE reception_register_reports__m (
          id TEXT PRIMARY KEY,
          report_date TEXT NOT NULL,
          report_owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          opening_float_usd INTEGER NOT NULL DEFAULT 0 CHECK (opening_float_usd >= 0 AND opening_float_usd <= 999999999),
          counted_cash_usd INTEGER NOT NULL CHECK (counted_cash_usd >= 0 AND counted_cash_usd <= 999999999),
          notes_cashier TEXT NOT NULL DEFAULT '',
          submitted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
          status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'validated')),
          validated_at TEXT,
          validated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
          cash_book_movement_id TEXT REFERENCES finance_cash_movements(id) ON DELETE SET NULL,
          notes_treasury TEXT NOT NULL DEFAULT '',
          UNIQUE(report_date, report_owner_user_id)
        );
        INSERT INTO reception_register_reports__m (
          id, report_date, report_owner_user_id, opening_float_usd, counted_cash_usd, notes_cashier,
          submitted_by_user_id, submitted_at, status, validated_at, validated_by_user_id,
          cash_book_movement_id, notes_treasury
        )
        SELECT id, report_date,
          COALESCE(submitted_by_user_id, '${fallbackUser.id}'),
          opening_float_usd, counted_cash_usd, notes_cashier,
          submitted_by_user_id, submitted_at, status, validated_at, validated_by_user_id,
          cash_book_movement_id, notes_treasury
        FROM reception_register_reports;
        DROP TABLE reception_register_reports;
        ALTER TABLE reception_register_reports__m RENAME TO reception_register_reports;
        CREATE INDEX IF NOT EXISTS idx_reception_register_reports_date ON reception_register_reports(report_date DESC);
      `);
    }
  }
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_user_point_of_sale (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      point_of_sale_id TEXT NOT NULL REFERENCES stock_points_of_sale(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, point_of_sale_id)
    );
    CREATE INDEX IF NOT EXISTS idx_app_user_pos_sale ON app_user_point_of_sale(point_of_sale_id);
  `);
  const main = db
    .prepare(
      `SELECT id FROM stock_points_of_sale WHERE active = 1 ORDER BY is_main DESC, sort_order ASC LIMIT 1`,
    )
    .get() as { id: string } | undefined;
  if (main) {
    const ins = db.prepare(
      `INSERT OR IGNORE INTO app_user_point_of_sale (user_id, point_of_sale_id) VALUES (?, ?)`,
    );
    const counterUsers = db
      .prepare(
        `SELECT u.id FROM users u
         JOIN app_user_roles r ON r.label = u.role COLLATE NOCASE
         JOIN app_role_permissions p ON p.role_id = r.id AND p.permission_code = 'finance.counter'
         WHERE u.active = 1`,
      )
      .all() as { id: string }[];
    const hasAssign = db.prepare(`SELECT 1 AS x FROM app_user_point_of_sale WHERE user_id = ?`);
    for (const u of counterUsers) {
      if (!hasAssign.get(u.id)) {
        ins.run(u.id, main.id);
      }
    }
  }
}

{
  const rpcols = db.prepare("PRAGMA table_info(reservation_payments)").all() as { name: string }[];
  if (!rpcols.some((c) => c.name === "received_by_user_id")) {
    db.exec(
      `ALTER TABLE reservation_payments ADD COLUMN received_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL`,
    );
  }
}

{
  let rpcols = db.prepare("PRAGMA table_info(reservation_payments)").all() as { name: string }[];
  if (!rpcols.some((c) => c.name === "currency")) {
    db.exec(`ALTER TABLE reservation_payments ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'`);
  }
  rpcols = db.prepare("PRAGMA table_info(reservation_payments)").all() as { name: string }[];
  if (!rpcols.some((c) => c.name === "amount_usd_equivalent")) {
    db.exec(`ALTER TABLE reservation_payments ADD COLUMN amount_usd_equivalent INTEGER`);
    db.prepare(`UPDATE reservation_payments SET amount_usd_equivalent = amount WHERE amount_usd_equivalent IS NULL`).run();
  }
}

{
  let vlcols = db.prepare("PRAGMA table_info(visitor_entry_payment_ledger)").all() as { name: string }[];
  if (!vlcols.some((c) => c.name === "received_by_user_id")) {
    db.exec(
      `ALTER TABLE visitor_entry_payment_ledger ADD COLUMN received_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL`,
    );
  }
  vlcols = db.prepare("PRAGMA table_info(visitor_entry_payment_ledger)").all() as { name: string }[];
  if (!vlcols.some((c) => c.name === "currency")) {
    db.exec(`ALTER TABLE visitor_entry_payment_ledger ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'`);
  }
  vlcols = db.prepare("PRAGMA table_info(visitor_entry_payment_ledger)").all() as { name: string }[];
  if (!vlcols.some((c) => c.name === "amount_nominal")) {
    db.exec(`ALTER TABLE visitor_entry_payment_ledger ADD COLUMN amount_nominal INTEGER`);
    db.prepare(`UPDATE visitor_entry_payment_ledger SET amount_nominal = amount_usd WHERE amount_nominal IS NULL`).run();
  }
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS treasury_cash_day_openings (
      business_date TEXT PRIMARY KEY,
      opened_at TEXT NOT NULL DEFAULT (datetime('now')),
      opened_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      notes TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_treasury_cash_day_openings_opened_at ON treasury_cash_day_openings(opened_at DESC);
  `);
  const tcdoCols = db.prepare("PRAGMA table_info(treasury_cash_day_openings)").all() as { name: string }[];
  if (tcdoCols.length > 0 && !tcdoCols.some((c) => c.name === "reception_opening_float_usd")) {
    db.exec(
      `ALTER TABLE treasury_cash_day_openings ADD COLUMN reception_opening_float_usd INTEGER NOT NULL DEFAULT 0`,
    );
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS treasury_cash_day_pos_openings (
      business_date TEXT NOT NULL,
      point_of_sale_id TEXT NOT NULL,
      opening_float_cdf INTEGER NOT NULL DEFAULT 0 CHECK (opening_float_cdf >= 0 AND opening_float_cdf <= 999999999),
      PRIMARY KEY (business_date, point_of_sale_id),
      FOREIGN KEY (point_of_sale_id) REFERENCES stock_points_of_sale(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_treasury_cash_day_pos_openings_pos ON treasury_cash_day_pos_openings(point_of_sale_id);
  `);
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS dining_terrace_tables (
      id TEXT PRIMARY KEY,
      point_of_sale_id TEXT NOT NULL REFERENCES stock_points_of_sale(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      seats INTEGER NOT NULL DEFAULT 4 CHECK(seats >= 1 AND seats <= 99),
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(point_of_sale_id, code)
    );
    CREATE INDEX IF NOT EXISTS idx_dining_terrace_tables_pos ON dining_terrace_tables(point_of_sale_id);
  `);
}

{
  const csCols = db.prepare("PRAGMA table_info(counter_sales)").all() as { name: string }[];
  if (!csCols.some((c) => c.name === "dining_table_id")) {
    db.exec(
      `ALTER TABLE counter_sales ADD COLUMN dining_table_id TEXT REFERENCES dining_terrace_tables(id) ON DELETE SET NULL`,
    );
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS counter_sale_lines (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL REFERENCES counter_sales(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES stock_items(id) ON DELETE RESTRICT,
      qty INTEGER NOT NULL CHECK(qty >= 1 AND qty <= 9999),
      unit_price_usd_cents INTEGER NOT NULL CHECK(unit_price_usd_cents >= 0),
      line_total_cdf INTEGER NOT NULL CHECK(line_total_cdf >= 0),
      label_snapshot TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_counter_sale_lines_sale ON counter_sale_lines(sale_id);
  `);
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS floor_service_tabs (
      id TEXT PRIMARY KEY,
      point_of_sale_id TEXT NOT NULL REFERENCES stock_points_of_sale(id) ON DELETE CASCADE,
      dining_table_id TEXT NOT NULL REFERENCES dining_terrace_tables(id) ON DELETE CASCADE,
      opened_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      opened_at TEXT NOT NULL DEFAULT (datetime('now')),
      note TEXT NOT NULL DEFAULT '',
      settled_at TEXT,
      counter_sale_id TEXT REFERENCES counter_sales(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_floor_tabs_pos ON floor_service_tabs(point_of_sale_id);
    CREATE INDEX IF NOT EXISTS idx_floor_tabs_open ON floor_service_tabs(point_of_sale_id, dining_table_id) WHERE settled_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS ux_floor_one_open_tab_per_table ON floor_service_tabs(dining_table_id) WHERE settled_at IS NULL;

    CREATE TABLE IF NOT EXISTS floor_service_tab_lines (
      id TEXT PRIMARY KEY,
      tab_id TEXT NOT NULL REFERENCES floor_service_tabs(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES stock_items(id) ON DELETE RESTRICT,
      qty INTEGER NOT NULL CHECK(qty >= 1 AND qty <= 9999),
      UNIQUE(tab_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_floor_tab_lines_tab ON floor_service_tab_lines(tab_id);
  `);
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_item_point_of_sale (
      item_id TEXT NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
      point_of_sale_id TEXT NOT NULL REFERENCES stock_points_of_sale(id) ON DELETE CASCADE,
      PRIMARY KEY (item_id, point_of_sale_id)
    );
    CREATE INDEX IF NOT EXISTS idx_stock_item_point_of_sale_pos ON stock_item_point_of_sale(point_of_sale_id);
  `);
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS counter_sale_serial (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      next_n INTEGER NOT NULL DEFAULT 1 CHECK (next_n >= 1)
    );
    INSERT OR IGNORE INTO counter_sale_serial (id, next_n) VALUES (1, 1);
  `);

  const csColsSaleNo = db.prepare("PRAGMA table_info(counter_sales)").all() as { name: string }[];
  if (!csColsSaleNo.some((c) => c.name === "sale_number")) {
    db.exec(`ALTER TABLE counter_sales ADD COLUMN sale_number INTEGER`);
  }

  const ftColsSaleNo = db.prepare("PRAGMA table_info(floor_service_tabs)").all() as { name: string }[];
  if (!ftColsSaleNo.some((c) => c.name === "sale_number")) {
    db.exec(`ALTER TABLE floor_service_tabs ADD COLUMN sale_number INTEGER`);
  }

  const pendingBackfill = db
    .prepare(`SELECT COUNT(*) AS c FROM counter_sales WHERE sale_number IS NULL`)
    .get() as { c: number };
  if (pendingBackfill.c > 0) {
    const rows = db
      .prepare(`SELECT id FROM counter_sales WHERE sale_number IS NULL ORDER BY datetime(created_at) ASC, id ASC`)
      .all() as { id: string }[];
    const maxExisting = Number(
      (db.prepare(`SELECT COALESCE(MAX(sale_number), 0) AS m FROM counter_sales WHERE sale_number IS NOT NULL`).get() as {
        m: number;
      })?.m ?? 0,
    );
    let next = maxExisting + 1;
    const stmtUp = db.prepare(`UPDATE counter_sales SET sale_number = ? WHERE id = ?`);
    for (const row of rows) {
      stmtUp.run(next++, row.id);
    }
    const syncedMax = Number(
      (db.prepare(`SELECT COALESCE(MAX(sale_number), 0) AS m FROM counter_sales`).get() as { m: number })?.m ?? 0,
    );
    db.prepare(`UPDATE counter_sale_serial SET next_n = ?`).run(syncedMax + 1);
  } else {
    const maxAll = Number(
      (db.prepare(`SELECT COALESCE(MAX(sale_number), 0) AS m FROM counter_sales`).get() as { m: number })?.m ?? 0,
    );
    const seqNow = db.prepare(`SELECT next_n FROM counter_sale_serial WHERE id = 1`).get() as { next_n: number };
    const synced = Math.max(typeof seqNow?.next_n === "number" ? seqNow.next_n : 1, maxAll + 1);
    db.prepare(`UPDATE counter_sale_serial SET next_n = ?`).run(synced);
  }

  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_counter_sales_sale_number ON counter_sales(sale_number) WHERE sale_number IS NOT NULL`,
  );
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_floor_service_tabs_sale_number ON floor_service_tabs(sale_number) WHERE sale_number IS NOT NULL`,
  );
}

/** AAAAMMJJ sans tirets dans `invoice_ref` (clé `business_date` inchangée : AAAA-MM-JJ). */
function businessDateSegmentForInvoice(isoYmd: string): string {
  const s = isoYmd.trim();
  if (/^\d{4}-\d{2}-\d{2}$/u.test(s)) return s.replace(/-/g, "");
  const digits = s.replace(/\D/g, "").slice(0, 8);
  return digits.length === 8 ? digits : "19700101";
}

/** Ancienne `CF-AAAA-MM-JJ-NNNN` ou actuelle `CF-AAAAMMJJ-NNNN` → `{ isoDay, seqNum }`. */
function parseCfCounterInvoiceParts(ref: string): { isoDay: string; seqNum: number } | null {
  const t = ref.trim();
  const legacy = /^CF-(\d{4}-\d{2}-\d{2})-(\d{4})$/u.exec(t);
  if (legacy) {
    const seqNum = Number.parseInt(legacy[2]!, 10);
    if (!Number.isFinite(seqNum)) return null;
    return { isoDay: legacy[1]!, seqNum };
  }
  const cur = /^CF-(\d{8})-(\d{4})$/u.exec(t);
  if (cur) {
    const c = cur[1]!;
    const seqNum = Number.parseInt(cur[2]!, 10);
    if (c.length !== 8 || !Number.isFinite(seqNum)) return null;
    const isoDay = `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}`;
    return { isoDay, seqNum };
  }
  return null;
}

{
  db.exec(`
    CREATE TABLE IF NOT EXISTS counter_invoice_daily_seq (
      business_date TEXT NOT NULL PRIMARY KEY CHECK (length(business_date) = 10),
      next_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_seq >= 1)
    );
  `);

  const csInv = db.prepare("PRAGMA table_info(counter_sales)").all() as { name: string }[];
  if (!csInv.some((c) => c.name === "invoice_ref")) {
    db.exec(`ALTER TABLE counter_sales ADD COLUMN invoice_ref TEXT`);
  }
  const ftInv = db.prepare("PRAGMA table_info(floor_service_tabs)").all() as { name: string }[];
  if (!ftInv.some((c) => c.name === "invoice_ref")) {
    db.exec(`ALTER TABLE floor_service_tabs ADD COLUMN invoice_ref TEXT`);
  }

  const invNull = db.prepare(`SELECT COUNT(*) AS c FROM counter_sales WHERE invoice_ref IS NULL OR trim(invoice_ref) = ''`).get() as {
    c: number;
  };
  if (invNull.c > 0) {
    const perDayMax = new Map<string, number>();
    const seeded = db
      .prepare(`SELECT invoice_ref FROM counter_sales WHERE invoice_ref IS NOT NULL AND length(trim(invoice_ref)) > 0`)
      .all() as { invoice_ref: string }[];
    for (const { invoice_ref } of seeded) {
      const parsed = parseCfCounterInvoiceParts(invoice_ref);
      if (!parsed) continue;
      perDayMax.set(parsed.isoDay, Math.max(perDayMax.get(parsed.isoDay) ?? 0, parsed.seqNum));
    }
    const rows = db
      .prepare(
        `SELECT id, created_at FROM counter_sales WHERE invoice_ref IS NULL OR trim(invoice_ref) = ''
         ORDER BY datetime(created_at) ASC, id ASC`,
      )
      .all() as { id: string; created_at: string }[];
    const stmtSet = db.prepare(`UPDATE counter_sales SET invoice_ref = ? WHERE id = ?`);
    for (const row of rows) {
      let d = "";
      if (typeof row.created_at === "string" && /^\d{4}-\d{2}-\d{2}/u.test(row.created_at)) {
        d = row.created_at.slice(0, 10);
      } else {
        const parsed = db
          .prepare(`SELECT strftime('%Y-%m-%d', ?) AS d`)
          .get(row.created_at) as { d: string } | undefined;
        d = parsed?.d ?? "1970-01-01";
      }
      const next = (perDayMax.get(d) ?? 0) + 1;
      perDayMax.set(d, next);
      stmtSet.run(`CF-${businessDateSegmentForInvoice(d)}-${String(next).padStart(4, "0")}`, row.id);
    }
    for (const [d, mx] of perDayMax.entries()) {
      db.prepare(
        `INSERT INTO counter_invoice_daily_seq (business_date, next_seq) VALUES (?, ?)
         ON CONFLICT(business_date) DO UPDATE SET next_seq = MAX(counter_invoice_daily_seq.next_seq, excluded.next_seq)`,
      ).run(d, mx + 1);
    }
  }

  db.prepare(
    `UPDATE floor_service_tabs SET invoice_ref = (
       SELECT cs.invoice_ref FROM counter_sales cs WHERE cs.id = floor_service_tabs.counter_sale_id
     )
     WHERE counter_sale_id IS NOT NULL
       AND (invoice_ref IS NULL OR trim(invoice_ref) = '')`,
  ).run();

  {
    const upCs = db.prepare(`UPDATE counter_sales SET invoice_ref = ? WHERE id = ?`);
    const csRows = db
      .prepare(`SELECT id, invoice_ref FROM counter_sales WHERE invoice_ref IS NOT NULL AND length(trim(invoice_ref)) > 0`)
      .all() as { id: string; invoice_ref: string }[];
    for (const r of csRows) {
      const p = parseCfCounterInvoiceParts(r.invoice_ref);
      if (!p) continue;
      const norm = `CF-${businessDateSegmentForInvoice(p.isoDay)}-${String(p.seqNum).padStart(4, "0")}`;
      if (norm !== r.invoice_ref.trim()) upCs.run(norm, r.id);
    }
    const upFt = db.prepare(`UPDATE floor_service_tabs SET invoice_ref = ? WHERE id = ?`);
    const ftRows = db
      .prepare(`SELECT id, invoice_ref FROM floor_service_tabs WHERE invoice_ref IS NOT NULL AND length(trim(invoice_ref)) > 0`)
      .all() as { id: string; invoice_ref: string }[];
    for (const r of ftRows) {
      const p = parseCfCounterInvoiceParts(r.invoice_ref);
      if (!p) continue;
      const norm = `CF-${businessDateSegmentForInvoice(p.isoDay)}-${String(p.seqNum).padStart(4, "0")}`;
      if (norm !== r.invoice_ref.trim()) upFt.run(norm, r.id);
    }
  }

  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_counter_sales_invoice_ref ON counter_sales(invoice_ref) WHERE invoice_ref IS NOT NULL AND length(trim(invoice_ref)) > 0`,
  );
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_floor_service_tabs_invoice_ref ON floor_service_tabs(invoice_ref) WHERE invoice_ref IS NOT NULL AND length(trim(invoice_ref)) > 0`,
  );
}

/**
 * Référence de facture comptoir : `CF-{AAAAMMJJ}-{NNNN}` (compteur par jour métier, clé interne `AAAA-MM-JJ`).
 * À utiliser uniquement dans une transaction SQLite englobante.
 */
export function allocateNextInvoiceRefUnsafe(businessDate: string): string {
  db.prepare(`INSERT OR IGNORE INTO counter_invoice_daily_seq (business_date, next_seq) VALUES (?, 1)`).run(businessDate);
  db.prepare(`UPDATE counter_invoice_daily_seq SET next_seq = next_seq + 1 WHERE business_date = ?`).run(businessDate);
  const r = db
    .prepare(`SELECT next_seq FROM counter_invoice_daily_seq WHERE business_date = ?`)
    .get(businessDate) as { next_seq: number } | undefined;
  const seq = typeof r?.next_seq === "number" && Number.isFinite(r.next_seq) && r.next_seq >= 2 ? r.next_seq - 1 : 1;
  return `CF-${businessDateSegmentForInvoice(businessDate)}-${String(seq).padStart(4, "0")}`;
}

/** Onglet service salle : rattache une référence facture dès l’addition ouverte (`opened_at`). */
export function assignInvoiceRefIfMissingForOpenTabUnsafe(tabId: string): string {
  const row = db
    .prepare(`SELECT invoice_ref, opened_at FROM floor_service_tabs WHERE id = ? AND settled_at IS NULL`)
    .get(tabId) as { invoice_ref: string | null; opened_at: string } | undefined;
  if (!row) {
    throw new Error("floor_tab_not_open");
  }
  if (row.invoice_ref && row.invoice_ref.trim().length > 0) return row.invoice_ref;
  const biz = typeof row.opened_at === "string" ? row.opened_at.slice(0, 10) : "1970-01-01";
  const inv = allocateNextInvoiceRefUnsafe(biz);
  const info = db
    .prepare(
      `UPDATE floor_service_tabs SET invoice_ref = ? WHERE id = ? AND settled_at IS NULL AND (invoice_ref IS NULL OR trim(invoice_ref) = '')`,
    )
    .run(inv, tabId);
  if (info.changes > 0) return inv;
  const retry = db
    .prepare(`SELECT invoice_ref FROM floor_service_tabs WHERE id = ? AND settled_at IS NULL`)
    .get(tabId) as { invoice_ref: string | null } | undefined;
  if (retry?.invoice_ref && retry.invoice_ref.trim().length > 0) return retry.invoice_ref;
  throw new Error("floor_tab_invoice_ref_race");
}

export function ensureFloorTabInvoiceRef(tabId: string): string | null {
  try {
    return db.transaction(() => assignInvoiceRefIfMissingForOpenTabUnsafe(tabId))();
  } catch {
    return null;
  }
}

/**
 * @deprecated Conservé pour d’anciens chemins ; préférez les références `invoice_ref`.
 */
export function nextSaleSequenceNumberUnsafe(): number {
  const row = db.prepare(`SELECT next_n FROM counter_sale_serial WHERE id = 1`).get() as { next_n: number } | undefined;
  const allocated = typeof row?.next_n === "number" && Number.isFinite(row.next_n) && row.next_n >= 1 ? row.next_n : 1;
  db.prepare(`UPDATE counter_sale_serial SET next_n = next_n + 1 WHERE id = 1`).run();
  return allocated;
}

{
  const insFloorPerm = db.prepare(
    `INSERT OR IGNORE INTO app_role_permissions (role_id, permission_code) VALUES (?, ?)`,
  );
  insFloorPerm.run("sys-ur-serveur", "sales.floor");
}
