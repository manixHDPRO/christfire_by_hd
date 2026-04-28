import type { Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { recordAudit } from "../auditLog.js";
import { db } from "../db.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";

const codeSchema = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9_]*$/, "code slug (lettre minuscule, chiffres, _)");

const postSchema = z.object({
  code: codeSchema,
  label: z.string().min(1).max(120).trim(),
  hint: z.string().max(500).optional().default(""),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional().default(99),
  emailOptional: z.boolean().optional().default(false),
  appliesEntryFee: z.boolean().optional().default(false),
});

const patchSchema = z.object({
  label: z.string().min(1).max(120).trim().optional(),
  hint: z.string().max(500).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  emailOptional: z.boolean().optional(),
  appliesEntryFee: z.boolean().optional(),
});

type ProfileRow = {
  code: string;
  label: string;
  hint: string;
  sortOrder: number;
  emailOptional: number;
  appliesEntryFee: number;
};

function rowToProfile(row: ProfileRow) {
  return {
    code: row.code,
    label: row.label,
    hint: row.hint,
    sortOrder: row.sortOrder,
    emailOptional: row.emailOptional === 1,
    appliesEntryFee: row.appliesEntryFee === 1,
  };
}

export function clientProfileTypeRoutes(): Router {
  const r = createRouter();

  r.get("/", requireAuth, (_req: AuthedRequest, res: Response) => {
    const rows = db
      .prepare(
        `SELECT code, label, hint, sort_order AS sortOrder, email_optional AS emailOptional,
                applies_entry_fee AS appliesEntryFee
         FROM client_profile_types
         ORDER BY sort_order ASC, code ASC`,
      )
      .all() as ProfileRow[];
    res.json({ profiles: rows.map(rowToProfile) });
  });

  r.post("/", requireAuth, requireAnyPermission("directory.client_profiles"), (req: AuthedRequest, res: Response) => {
    const parsed = postSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const { code, label, hint, sortOrder, emailOptional, appliesEntryFee } = parsed.data;
    try {
      db.prepare(
        `INSERT INTO client_profile_types (code, label, hint, sort_order, email_optional, applies_entry_fee, default_entry_fee_cdf)
         VALUES (@code, @label, @hint, @sort_order, @eo, @af, 0)`,
      ).run({
        code,
        label,
        hint: hint.trim(),
        sort_order: sortOrder,
        eo: emailOptional ? 1 : 0,
        af: appliesEntryFee ? 1 : 0,
      });
    } catch {
      res.status(409).json({ code: "code_taken" });
      return;
    }
    const row = db
      .prepare(
        `SELECT code, label, hint, sort_order AS sortOrder, email_optional AS emailOptional,
                applies_entry_fee AS appliesEntryFee
         FROM client_profile_types WHERE code = ?`,
      )
      .get(code) as ProfileRow;
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "create",
      entityType: "client_profile_type",
      entityId: code,
      summary: `Profil client créé : ${code} — ${label}`,
    });
    res.status(201).json({ profile: rowToProfile(row) });
  });

  r.patch("/:code", requireAuth, requireAnyPermission("directory.client_profiles"), (req: AuthedRequest, res: Response) => {
    const code = typeof req.params.code === "string" ? req.params.code : req.params.code[0];
    if (!code || !/^[a-z][a-z0-9_]*$/.test(code)) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const body = parsed.data;
    const has =
      body.label !== undefined ||
      body.hint !== undefined ||
      body.sortOrder !== undefined ||
      body.emailOptional !== undefined ||
      body.appliesEntryFee !== undefined;
    if (!has) {
      res.status(400).json({ code: "validation_error" });
      return;
    }

    const cur = db
      .prepare(
        `SELECT code, label, hint, sort_order AS sortOrder, email_optional AS emailOptional,
                applies_entry_fee AS appliesEntryFee
         FROM client_profile_types WHERE code = ?`,
      )
      .get(code) as ProfileRow | undefined;
    if (!cur) {
      res.status(404).json({ code: "not_found" });
      return;
    }

    const nextLabel = body.label ?? cur.label;
    const nextHint = body.hint !== undefined ? body.hint.trim() : cur.hint;
    const nextSort = body.sortOrder ?? cur.sortOrder;
    const nextEmailOpt = body.emailOptional !== undefined ? (body.emailOptional ? 1 : 0) : cur.emailOptional;
    const nextApplies = body.appliesEntryFee !== undefined ? (body.appliesEntryFee ? 1 : 0) : cur.appliesEntryFee;

    db.prepare(
      `UPDATE client_profile_types SET
         label = @label, hint = @hint, sort_order = @sort_order,
         email_optional = @eo, applies_entry_fee = @af,
         default_entry_fee_cdf = CASE WHEN @af != 1 THEN 0 ELSE default_entry_fee_cdf END
       WHERE code = @code`,
    ).run({
      code,
      label: nextLabel,
      hint: nextHint,
      sort_order: nextSort,
      eo: nextEmailOpt,
      af: nextApplies,
    });

    const row = db
      .prepare(
        `SELECT code, label, hint, sort_order AS sortOrder, email_optional AS emailOptional,
                applies_entry_fee AS appliesEntryFee
         FROM client_profile_types WHERE code = ?`,
      )
      .get(code) as ProfileRow;
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "update",
      entityType: "client_profile_type",
      entityId: code,
      summary: `Profil client modifié : ${code}`,
    });
    res.json({ profile: rowToProfile(row) });
  });

  r.delete("/:code", requireAuth, requireAnyPermission("directory.client_profiles"), (req: AuthedRequest, res: Response) => {
    const code = typeof req.params.code === "string" ? req.params.code : req.params.code[0];
    if (!code || !/^[a-z][a-z0-9_]*$/.test(code)) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const total = (db.prepare("SELECT COUNT(*) AS c FROM client_profile_types").get() as { c: number }).c;
    if (total <= 1) {
      res.status(400).json({ code: "last_profile" });
      return;
    }
    const inUse = (
      db.prepare("SELECT COUNT(*) AS c FROM clients WHERE client_profile = ?").get(code) as { c: number }
    ).c;
    if (inUse > 0) {
      res.status(409).json({ code: "in_use" });
      return;
    }
    const info = db.prepare("DELETE FROM client_profile_types WHERE code = ?").run(code);
    if (info.changes === 0) {
      res.status(404).json({ code: "not_found" });
      return;
    }
    recordAudit({
      actorUserId: req.auth?.sub ?? null,
      action: "delete",
      entityType: "client_profile_type",
      entityId: code,
      summary: `Profil client supprimé : ${code}`,
    });
    res.status(204).end();
  });

  return r;
}
