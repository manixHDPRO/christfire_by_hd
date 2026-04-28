import { randomUUID } from "node:crypto";
import { db } from "./db.js";

export type AuditAction = "create" | "update" | "delete";

export function recordAudit(entry: {
  actorUserId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  summary: string;
  meta?: Record<string, unknown>;
}): void {
  try {
    db.prepare(
      `INSERT INTO audit_log (id, actor_user_id, action, entity_type, entity_id, summary, meta_json, at)
       VALUES (@id, @actor_user_id, @action, @entity_type, @entity_id, @summary, @meta_json, datetime('now'))`,
    ).run({
      id: randomUUID(),
      actor_user_id: entry.actorUserId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      summary: entry.summary.slice(0, 500),
      meta_json: JSON.stringify(entry.meta ?? {}),
    });
  } catch (e) {
    console.error("[audit_log]", e);
  }
}
