import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import { db } from "../db.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";

const MAX = 400;

type AuditRow = {
  id: string;
  at: string;
  action: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
};

export function auditRoutes(): Router {
  const r = createRouter();

  r.get("/", requireAuth, requireAnyPermission("admin.audit"), (req: AuthedRequest, res: Response) => {
    const actorUserId =
      typeof req.query.actorUserId === "string" ? req.query.actorUserId.trim() : "";
    const rows = actorUserId
      ? (db
          .prepare(
            `SELECT a.id, a.at, a.action, a.entity_type, a.entity_id, a.summary, a.actor_user_id,
                    u.name AS actor_name, u.email AS actor_email
             FROM audit_log a
             LEFT JOIN users u ON u.id = a.actor_user_id
             WHERE a.actor_user_id = ?
             ORDER BY a.at DESC, a.id DESC
             LIMIT ?`,
          )
          .all(actorUserId, MAX) as AuditRow[])
      : (db
          .prepare(
            `SELECT a.id, a.at, a.action, a.entity_type, a.entity_id, a.summary, a.actor_user_id,
                    u.name AS actor_name, u.email AS actor_email
             FROM audit_log a
             LEFT JOIN users u ON u.id = a.actor_user_id
             ORDER BY a.at DESC, a.id DESC
             LIMIT ?`,
          )
          .all(MAX) as AuditRow[]);
    res.json({
      entries: rows.map((row) => ({
        id: row.id,
        at: row.at,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        summary: row.summary,
        actorUserId: row.actor_user_id,
        actorName: row.actor_name,
        actorEmail: row.actor_email,
      })),
    });
  });

  return r;
}
