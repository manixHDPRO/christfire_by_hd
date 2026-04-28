import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { db } from "../db.js";
import type { AuthedRequest } from "../middleware/requireAuth.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";
import { LODGING_MODULE_CODES } from "../permissionCodes.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const uploadsDir = path.join(repoRoot, "data", "maintenance-uploads");

fs.mkdirSync(uploadsDir, { recursive: true });

const categorySchema = z.enum(["panne", "clim", "plomberie", "electricite", "autre"]);
const prioritySchema = z.enum(["basse", "normale", "haute", "urgente"]);
const statusSchema = z.enum(["ouvert", "en_cours", "resolu", "annule"]);

const createTicketSchema = z.object({
  bungalowId: z.string().min(1).max(80),
  category: categorySchema,
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(8000).optional().default(""),
  priority: prioritySchema.optional().default("normale"),
});

const patchTicketSchema = z.object({
  title: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(8000).optional(),
  priority: prioritySchema.optional(),
  status: statusSchema.optional(),
});

const commentSchema = z.object({
  body: z.string().min(1).max(8000).trim(),
});

const attachmentSchema = z.object({
  fileName: z.string().min(1).max(240).trim(),
  mimeType: z.string().min(3).max(120),
  dataBase64: z.string().min(1),
});

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

type TicketRow = {
  id: string;
  bungalow_id: string;
  category: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  created_by_user_id: string | null;
  bungalow_code?: string;
};

type EventRow = {
  id: string;
  ticket_id: string;
  kind: string;
  body: string;
  meta_json: string;
  created_at: string;
  user_id: string | null;
  user_name: string | null;
};

type AttachmentRow = {
  id: string;
  ticket_id: string;
  file_name: string;
  mime_type: string;
  byte_length: number;
  stored_name: string;
  created_at: string;
  created_by_user_id: string | null;
};

function extForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "application/pdf":
      return ".pdf";
    default:
      return "";
  }
}

function ticketToPublic(row: TicketRow) {
  return {
    id: row.id,
    bungalowId: row.bungalow_id,
    bungalowCode: row.bungalow_code,
    category: row.category,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByUserId: row.created_by_user_id,
  };
}

function parseMeta(json: string): Record<string, unknown> {
  try {
    const p = JSON.parse(json) as unknown;
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function eventToPublic(row: EventRow) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    kind: row.kind,
    body: row.body,
    meta: parseMeta(row.meta_json),
    createdAt: row.created_at,
    userId: row.user_id,
    userName: row.user_name,
  };
}

function attachmentToPublic(row: AttachmentRow) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteLength: row.byte_length,
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id,
  };
}

function touchTicketUpdated(ticketId: string): void {
  db.prepare(`UPDATE maintenance_tickets SET updated_at = datetime('now') WHERE id = ?`).run(ticketId);
}

function insertEvent(
  ticketId: string,
  kind: "created" | "comment" | "status" | "priority" | "attachment" | "edit",
  body: string,
  meta: Record<string, unknown>,
  userId: string | null,
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO maintenance_ticket_events (id, ticket_id, kind, body, meta_json, user_id)
     VALUES (@id, @ticket_id, @kind, @body, @meta_json, @user_id)`,
  ).run({
    id,
    ticket_id: ticketId,
    kind,
    body,
    meta_json: JSON.stringify(meta),
    user_id: userId,
  });
  return id;
}

function pathParam(p: string | string[] | undefined): string | undefined {
  if (typeof p === "string" && p.length > 0) return p;
  if (Array.isArray(p) && typeof p[0] === "string" && p[0].length > 0) return p[0];
  return undefined;
}

function loadTicket(id: string): TicketRow | undefined {
  return db
    .prepare(
      `SELECT t.id, t.bungalow_id, t.category, t.title, t.description, t.priority, t.status,
              t.created_at, t.updated_at, t.created_by_user_id, b.code AS bungalow_code
       FROM maintenance_tickets t
       JOIN bungalows b ON b.id = t.bungalow_id
       WHERE t.id = ?`,
    )
    .get(id) as TicketRow | undefined;
}

export function maintenanceTicketRoutes(): Router {
  const r = createRouter();

  r.get("/", requireAuth, requireAnyPermission(...LODGING_MODULE_CODES), (req: AuthedRequest, res: Response) => {
    const bungalowId = typeof req.query.bungalowId === "string" ? req.query.bungalowId : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const priority = typeof req.query.priority === "string" ? req.query.priority : undefined;

    let sql = `SELECT t.id, t.bungalow_id, t.category, t.title, t.description, t.priority, t.status,
                      t.created_at, t.updated_at, t.created_by_user_id, b.code AS bungalow_code
 FROM maintenance_tickets t
               JOIN bungalows b ON b.id = t.bungalow_id
               WHERE 1=1`;
    const params: string[] = [];
    if (bungalowId) {
      sql += ` AND t.bungalow_id = ?`;
      params.push(bungalowId);
    }
    if (status) {
      sql += ` AND t.status = ?`;
      params.push(status);
    }
    if (priority) {
      sql += ` AND t.priority = ?`;
      params.push(priority);
    }
    sql += ` ORDER BY t.updated_at DESC, t.created_at DESC`;
    const rows = db.prepare(sql).all(...params) as TicketRow[];
    res.json({ tickets: rows.map(ticketToPublic) });
  });

  r.post("/", requireAuth, requireAnyPermission("lodging.maintenance"), (req: AuthedRequest, res: Response) => {
    const parsed = createTicketSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const bungalow = db.prepare("SELECT id FROM bungalows WHERE id = ?").get(parsed.data.bungalowId) as
      | { id: string }
      | undefined;
    if (!bungalow) {
      res.status(400).json({ code: "unknown_bungalow" });
      return;
    }
    const id = randomUUID();
    const uid = req.auth?.sub ?? null;
    try {
      db.prepare(
        `INSERT INTO maintenance_tickets (id, bungalow_id, category, title, description, priority, status, created_by_user_id)
         VALUES (@id, @bungalow_id, @category, @title, @description, @priority, 'ouvert', @created_by_user_id)`,
      ).run({
        id,
        bungalow_id: parsed.data.bungalowId,
        category: parsed.data.category,
        title: parsed.data.title,
        description: parsed.data.description ?? "",
        priority: parsed.data.priority,
        created_by_user_id: uid,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ code: "server_error" });
      return;
    }
    insertEvent(id, "created", parsed.data.title, { category: parsed.data.category }, uid);
    const row = loadTicket(id);
    if (!row) {
      res.status(500).json({ code: "server_error" });
      return;
    }
    res.status(201).json({ ticket: ticketToPublic(row) });
  });

  r.get("/:id", requireAuth, requireAnyPermission(...LODGING_MODULE_CODES), (req: AuthedRequest, res: Response) => {
    const tid = pathParam(req.params.id);
    if (!tid) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const row = loadTicket(tid);
    if (!row) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const events = db
      .prepare(
        `SELECT e.id, e.ticket_id, e.kind, e.body, e.meta_json, e.created_at, e.user_id, u.name AS user_name
         FROM maintenance_ticket_events e
         LEFT JOIN users u ON u.id = e.user_id
         WHERE e.ticket_id = ?
         ORDER BY e.created_at ASC, e.id ASC`,
      )
      .all(row.id) as EventRow[];
    const attachments = db
      .prepare(
        `SELECT id, ticket_id, file_name, mime_type, byte_length, stored_name, created_at, created_by_user_id
         FROM maintenance_ticket_attachments WHERE ticket_id = ? ORDER BY created_at ASC`,
      )
      .all(row.id) as AttachmentRow[];
    res.json({
      ticket: ticketToPublic(row),
      events: events.map(eventToPublic),
      attachments: attachments.map(attachmentToPublic),
    });
  });

  r.patch("/:id", requireAuth, requireAnyPermission("lodging.maintenance"), (req: AuthedRequest, res: Response) => {
    const tid = pathParam(req.params.id);
    if (!tid) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const parsed = patchTicketSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const current = db
      .prepare(
        `SELECT id, bungalow_id, category, title, description, priority, status, created_at, updated_at, created_by_user_id
         FROM maintenance_tickets WHERE id = ?`,
      )
      .get(tid) as Omit<TicketRow, "bungalow_code"> | undefined;
    if (!current) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const uid = req.auth?.sub ?? null;
    const next = {
      title: parsed.data.title ?? current.title,
      description: parsed.data.description !== undefined ? parsed.data.description : current.description,
      priority: parsed.data.priority ?? current.priority,
      status: parsed.data.status ?? current.status,
    };
    if (parsed.data.status !== undefined && parsed.data.status !== current.status) {
      insertEvent(
        current.id,
        "status",
        `${current.status} → ${parsed.data.status}`,
        { from: current.status, to: parsed.data.status },
        uid,
      );
    }
    if (parsed.data.priority !== undefined && parsed.data.priority !== current.priority) {
      insertEvent(
        current.id,
        "priority",
        `${current.priority} → ${parsed.data.priority}`,
        { from: current.priority, to: parsed.data.priority },
        uid,
      );
    }
    if (parsed.data.title !== undefined && parsed.data.title !== current.title) {
      insertEvent(current.id, "edit", "Titre modifié", { field: "title" }, uid);
    }
    if (parsed.data.description !== undefined && parsed.data.description !== current.description) {
      insertEvent(current.id, "edit", "Description mise à jour", { field: "description" }, uid);
    }
    try {
      db.prepare(
        `UPDATE maintenance_tickets SET title=@title, description=@description, priority=@priority, status=@status,
 updated_at = datetime('now') WHERE id=@id`,
      ).run({
        id: current.id,
        title: next.title,
        description: next.description,
        priority: next.priority,
        status: next.status,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ code: "server_error" });
      return;
    }
    const row = loadTicket(current.id);
    if (!row) {
      res.status(500).json({ code: "server_error" });
      return;
    }
    res.json({ ticket: ticketToPublic(row) });
  });

  r.post(
    "/:id/comments",
    requireAuth,
    requireAnyPermission("lodging.maintenance"),
    (req: AuthedRequest, res: Response) => {
    const tid = pathParam(req.params.id);
    if (!tid) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const parsed = commentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const ticket = db.prepare("SELECT id FROM maintenance_tickets WHERE id = ?").get(tid) as
      | { id: string }
      | undefined;
    if (!ticket) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const uid = req.auth?.sub ?? null;
    insertEvent(ticket.id, "comment", parsed.data.body, {}, uid);
    touchTicketUpdated(ticket.id);
    res.status(201).json({ ok: true });
  });

  r.post(
    "/:id/attachments",
    requireAuth,
    requireAnyPermission("lodging.maintenance"),
    (req: AuthedRequest, res: Response) => {
    const tid = pathParam(req.params.id);
    if (!tid) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const parsed = attachmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const mime = parsed.data.mimeType.trim().toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      res.status(400).json({ code: "unsupported_mime" });
      return;
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(parsed.data.dataBase64, "base64");
    } catch {
      res.status(400).json({ code: "invalid_base64" });
      return;
    }
    if (!buf.length || buf.length > MAX_ATTACHMENT_BYTES) {
      res.status(400).json({ code: "file_too_large" });
      return;
    }
    const ticket = db.prepare("SELECT id FROM maintenance_tickets WHERE id = ?").get(tid) as
      | { id: string }
      | undefined;
    if (!ticket) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const ext = extForMime(mime);
    const storedName = `${randomUUID()}${ext}`;
    const abs = path.join(uploadsDir, storedName);
    const id = randomUUID();
    const uid = req.auth?.sub ?? null;
    try {
      fs.writeFileSync(abs, buf);
      db.prepare(
        `INSERT INTO maintenance_ticket_attachments (id, ticket_id, file_name, mime_type, byte_length, stored_name, created_by_user_id)
         VALUES (@id, @ticket_id, @file_name, @mime_type, @byte_length, @stored_name, @created_by_user_id)`,
      ).run({
        id,
        ticket_id: ticket.id,
        file_name: parsed.data.fileName,
        mime_type: mime,
        byte_length: buf.length,
        stored_name: storedName,
        created_by_user_id: uid,
      });
    } catch (e) {
      console.error(e);
      try {
        fs.unlinkSync(abs);
      } catch {
        /* ignore */
      }
      res.status(500).json({ code: "server_error" });
      return;
    }
    insertEvent(
      ticket.id,
      "attachment",
      parsed.data.fileName,
      { attachmentId: id, mimeType: mime, byteLength: buf.length },
      uid,
    );
    touchTicketUpdated(ticket.id);
    const row = db
      .prepare(
        `SELECT id, ticket_id, file_name, mime_type, byte_length, stored_name, created_at, created_by_user_id
         FROM maintenance_ticket_attachments WHERE id = ?`,
      )
      .get(id) as AttachmentRow;
    res.status(201).json({ attachment: attachmentToPublic(row) });
  });

  r.get(
    "/:id/attachments/:attachmentId/file",
    requireAuth,
    requireAnyPermission(...LODGING_MODULE_CODES),
    (req: AuthedRequest, res: Response) => {
    const ticketId = pathParam(req.params.id);
    const attachmentId = pathParam(req.params.attachmentId);
    if (!ticketId || !attachmentId) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const row = db
      .prepare(
        `SELECT a.stored_name, a.file_name, a.mime_type, a.ticket_id
         FROM maintenance_ticket_attachments a
         WHERE a.id = ?`,
      )
      .get(attachmentId) as
      | { stored_name: string; file_name: string; mime_type: string; ticket_id: string }
      | undefined;
    if (!row || row.ticket_id !== ticketId) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    const abs = path.join(uploadsDir, row.stored_name);
    if (!fs.existsSync(abs)) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    res.setHeader("Content-Type", row.mime_type);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);
    fs.createReadStream(abs).pipe(res);
  });

  return r;
}
