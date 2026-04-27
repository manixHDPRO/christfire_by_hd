import { randomUUID } from "node:crypto";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { insertFinanceCashExpense } from "../financeCashExpense.js";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth.js";
import { requireAnyPermission } from "../middleware/requirePermission.js";

const CASH_BOOK_PERM = "finance.cash_book" as const;

/** Aligné sur INTEGER JS / SQLite pratique (tests volumineux, ex. 100 Mds CDF). */
const FINANCE_CASH_AMOUNT_MAX = Number.MAX_SAFE_INTEGER;

const movementCategories = z.enum([
  "expense",
  "bank_deposit",
  "bank_withdrawal",
  "adjustment_in",
  "adjustment_out",
]);

const createMovementSchema = z.object({
  category: movementCategories,
  occurredAt: z.string().min(10).max(40),
  sourceAccountId: z.string().max(80).optional().nullable(),
  targetAccountId: z.string().max(80).optional().nullable(),
  amount: z.number().int().min(1).max(FINANCE_CASH_AMOUNT_MAX),
  currency: z.enum(["CDF", "USD"]).optional().default("CDF"),
  label: z.string().min(1).max(200),
  note: z.string().max(1000).optional().default(""),
});

const createAccountSchema = z.object({
  label: z.string().min(1).max(120),
  kind: z.enum(["physical", "bank"]),
  currency: z.enum(["CDF", "USD"]).optional().default("CDF"),
  code: z.string().min(1).max(32).optional(),
});

type AccountRow = {
  id: string;
  code: string;
  label: string;
  kind: string;
  currency: string;
  sort_order: number;
  active: number;
};

function getAccount(id: string | null | undefined): AccountRow | undefined {
  if (!id?.trim()) return undefined;
  return db
    .prepare(
      `SELECT id, code, label, kind, currency, sort_order, active FROM finance_cash_accounts WHERE id = ? AND active = 1`,
    )
    .get(id.trim()) as AccountRow | undefined;
}

function balanceForAccount(accountId: string): number {
  const inSum =
    (db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS s FROM finance_cash_movements WHERE target_account_id = ?`,
      )
      .get(accountId) as { s: number })?.s ?? 0;
  const outSum =
    (db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS s FROM finance_cash_movements WHERE source_account_id = ?`,
      )
      .get(accountId) as { s: number })?.s ?? 0;
  return inSum - outSum;
}

function normalizeOccurredAt(raw: string): string {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t}T12:00:00`;
  return t;
}

function getMovementWithJoins(id: string): Record<string, unknown> | undefined {
  return db
    .prepare(
      `SELECT m.id, m.category, m.occurred_at AS occurredAt, m.source_account_id AS sourceAccountId,
              m.target_account_id AS targetAccountId, m.amount, m.currency, m.label, m.note,
              m.created_at AS createdAt, m.created_by_user_id AS createdByUserId,
              sa.label AS sourceAccountLabel, ta.label AS targetAccountLabel,
              u.name AS createdByName
       FROM finance_cash_movements m
       LEFT JOIN finance_cash_accounts sa ON sa.id = m.source_account_id
       LEFT JOIN finance_cash_accounts ta ON ta.id = m.target_account_id
       LEFT JOIN users u ON u.id = m.created_by_user_id
       WHERE m.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
}

export function cashBookRoutes(): Router {
  const r = createRouter();

  r.get("/accounts", requireAuth, requireAnyPermission(CASH_BOOK_PERM), (_req: Request, res: Response) => {
    const rows = db
      .prepare(
        `SELECT id, code, label, kind, currency, sort_order AS sortOrder, active
         FROM finance_cash_accounts WHERE active = 1 ORDER BY sort_order ASC, label ASC`,
      )
      .all() as {
        id: string;
        code: string;
        label: string;
        kind: string;
        currency: string;
        sortOrder: number;
        active: number;
      }[];
    const accounts = rows.map((a) => ({
      id: a.id,
      code: a.code,
      label: a.label,
      kind: a.kind,
      currency: a.currency,
      sortOrder: a.sortOrder,
      balance: balanceForAccount(a.id),
    }));
    res.json({ accounts });
  });

  r.post("/accounts", requireAuth, requireAnyPermission(CASH_BOOK_PERM), (req: AuthedRequest, res: Response) => {
    const parsed = createAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const { label, kind, currency } = parsed.data;
    let code = parsed.data.code?.trim().toUpperCase().replace(/\s+/g, "_") ?? "";
    if (!code) {
      code = `ACC_${randomUUID().slice(0, 8).toUpperCase()}`;
    }
    const exists = db.prepare("SELECT 1 FROM finance_cash_accounts WHERE code = ? COLLATE NOCASE").get(code);
    if (exists) {
      res.status(409).json({ code: "code_exists" });
      return;
    }
    const maxRow = db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM finance_cash_accounts").get() as {
      m: number;
    };
    const id = randomUUID();
    try {
      db.prepare(
        `INSERT INTO finance_cash_accounts (id, code, label, kind, currency, sort_order, active)
         VALUES (@id, @code, @label, @kind, @currency, @sort_order, 1)`,
      ).run({
        id,
        code,
        label: label.trim(),
        kind,
        currency,
        sort_order: maxRow.m + 1,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ code: "insert_failed" });
      return;
    }
    const row = getAccount(id);
    res.status(201).json({
      account: row
        ? {
            id: row.id,
            code: row.code,
            label: row.label,
            kind: row.kind,
            currency: row.currency,
            sortOrder: row.sort_order,
            balance: 0,
          }
        : null,
    });
  });

  r.get("/movements", requireAuth, requireAnyPermission(CASH_BOOK_PERM), (req: Request, res: Response) => {
    const from = typeof req.query.from === "string" && req.query.from.trim() ? req.query.from.trim() : null;
    const to = typeof req.query.to === "string" && req.query.to.trim() ? req.query.to.trim() : null;
    const accountId = typeof req.query.accountId === "string" && req.query.accountId.trim() ? req.query.accountId.trim() : null;

    const conditions: string[] = ["1=1"];
    const params: string[] = [];
    if (from) {
      conditions.push("date(m.occurred_at) >= date(?)");
      params.push(from);
    }
    if (to) {
      conditions.push("date(m.occurred_at) <= date(?)");
      params.push(to);
    }
    if (accountId) {
      conditions.push("(m.source_account_id = ? OR m.target_account_id = ?)");
      params.push(accountId, accountId);
    }

    const sql = `
      SELECT m.id, m.category, m.occurred_at AS occurredAt, m.source_account_id AS sourceAccountId,
             m.target_account_id AS targetAccountId, m.amount, m.currency, m.label, m.note,
             m.created_at AS createdAt, m.created_by_user_id AS createdByUserId,
             sa.label AS sourceAccountLabel, ta.label AS targetAccountLabel,
             u.name AS createdByName
      FROM finance_cash_movements m
      LEFT JOIN finance_cash_accounts sa ON sa.id = m.source_account_id
      LEFT JOIN finance_cash_accounts ta ON ta.id = m.target_account_id
      LEFT JOIN users u ON u.id = m.created_by_user_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY m.occurred_at DESC, m.created_at DESC, m.id DESC
      LIMIT 500
    `;
    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    res.json({ movements: rows });
  });

  r.post("/movements", requireAuth, requireAnyPermission(CASH_BOOK_PERM), (req: AuthedRequest, res: Response) => {
    const parsed = createMovementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: "validation_error" });
      return;
    }
    const data = parsed.data;
    const occurredAt = normalizeOccurredAt(data.occurredAt);
    const currency = data.currency;
    let sourceId = data.sourceAccountId?.trim() || null;
    let targetId = data.targetAccountId?.trim() || null;
    const userId = req.auth?.sub ?? null;

    if (data.category === "expense") {
      const ins = insertFinanceCashExpense({
        userId,
        occurredAt: data.occurredAt,
        sourceAccountId: data.sourceAccountId ?? "",
        amount: data.amount,
        currency: data.currency,
        label: data.label,
        note: data.note,
      });
      if (!ins.ok) {
        const body: { code: string; field?: string; hint?: string } = { code: ins.code };
        if (ins.field) body.field = ins.field;
        if (ins.hint) body.hint = ins.hint;
        res.status(400).json(body);
        return;
      }
      const row = getMovementWithJoins(ins.id);
      res.status(201).json({ movement: row });
      return;
    }

    const src = sourceId ? getAccount(sourceId) : undefined;
    const tgt = targetId ? getAccount(targetId) : undefined;

    const ensureCurrency = (row: AccountRow | undefined, field: string): boolean => {
      if (!row) return false;
      if (row.currency !== currency) {
        res.status(400).json({ code: "currency_mismatch", field });
        return false;
      }
      return true;
    };

    switch (data.category) {
      case "bank_deposit":
        if (!sourceId || !targetId) {
          res.status(400).json({ code: "invalid_accounts", hint: "bank_deposit requires source and target" });
          return;
        }
        if (!src || !tgt) {
          res.status(400).json({ code: "unknown_account" });
          return;
        }
        if (src.kind !== "physical" || tgt.kind !== "bank") {
          res.status(400).json({ code: "invalid_account_kinds", hint: "physical to bank" });
          return;
        }
        if (!ensureCurrency(src, "source") || !ensureCurrency(tgt, "target")) return;
        break;
      case "bank_withdrawal":
        if (!sourceId || !targetId) {
          res.status(400).json({ code: "invalid_accounts", hint: "bank_withdrawal requires source and target" });
          return;
        }
        if (!src || !tgt) {
          res.status(400).json({ code: "unknown_account" });
          return;
        }
        if (src.kind !== "bank" || tgt.kind !== "physical") {
          res.status(400).json({ code: "invalid_account_kinds", hint: "bank to physical" });
          return;
        }
        if (!ensureCurrency(src, "source") || !ensureCurrency(tgt, "target")) return;
        break;
      case "adjustment_in":
        if (sourceId || !targetId) {
          res.status(400).json({ code: "invalid_accounts", hint: "adjustment_in requires target only" });
          return;
        }
        if (!tgt) {
          res.status(400).json({ code: "unknown_account" });
          return;
        }
        if (!ensureCurrency(tgt, "target")) return;
        break;
      case "adjustment_out":
        if (!sourceId || targetId) {
          res.status(400).json({ code: "invalid_accounts", hint: "adjustment_out requires source only" });
          return;
        }
        if (!src) {
          res.status(400).json({ code: "unknown_account" });
          return;
        }
        if (!ensureCurrency(src, "source")) return;
        break;
      default:
        res.status(400).json({ code: "invalid_category" });
        return;
    }

    const id = randomUUID();
    try {
      db.prepare(
        `INSERT INTO finance_cash_movements
         (id, category, occurred_at, source_account_id, target_account_id, amount, currency, label, note, created_by_user_id)
         VALUES (@id, @category, @occurred_at, @source_account_id, @target_account_id, @amount, @currency, @label, @note, @created_by_user_id)`,
      ).run({
        id,
        category: data.category,
        occurred_at: occurredAt,
        source_account_id: sourceId,
        target_account_id: targetId,
        amount: data.amount,
        currency,
        label: data.label.trim(),
        note: data.note.trim(),
        created_by_user_id: userId,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ code: "insert_failed" });
      return;
    }

    const row = getMovementWithJoins(id);
    res.status(201).json({ movement: row });
  });

  return r;
}
