import { randomUUID } from "node:crypto";
import { db } from "./db.js";

/** Aligné sur `cashBookRoutes` et le client (montants entiers). */
export const FINANCE_CASH_AMOUNT_MAX = Number.MAX_SAFE_INTEGER;

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

function normalizeOccurredAt(raw: string): string {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t}T12:00:00`;
  return t;
}

export function insertFinanceCashExpense(params: {
  userId: string | null;
  occurredAt: string;
  sourceAccountId: string;
  amount: number;
  currency: "CDF" | "USD";
  label: string;
  note: string;
}): { ok: true; id: string } | { ok: false; code: string; field?: string; hint?: string } {
  const { amount, currency, label, note, userId } = params;
  if (!Number.isInteger(amount) || amount < 1 || amount > FINANCE_CASH_AMOUNT_MAX) {
    return { ok: false, code: "validation_error" };
  }
  const sourceId = params.sourceAccountId?.trim() || null;
  if (!sourceId) {
    return { ok: false, code: "invalid_accounts", hint: "expense requires source" };
  }
  const src = getAccount(sourceId);
  if (!src) {
    return { ok: false, code: "unknown_account" };
  }
  if (src.currency !== currency) {
    return { ok: false, code: "currency_mismatch", field: "source" };
  }
  const occurred = normalizeOccurredAt(params.occurredAt);
  const id = randomUUID();
  try {
    db.prepare(
      `INSERT INTO finance_cash_movements
       (id, category, occurred_at, source_account_id, target_account_id, amount, currency, label, note, created_by_user_id)
       VALUES (@id, 'expense', @occurred_at, @source_account_id, NULL, @amount, @currency, @label, @note, @created_by_user_id)`,
    ).run({
      id,
      occurred_at: occurred,
      source_account_id: sourceId,
      amount,
      currency,
      label: label.trim(),
      note: note.trim(),
      created_by_user_id: userId,
    });
  } catch (e) {
    console.error(e);
    return { ok: false, code: "insert_failed" };
  }
  return { ok: true, id };
}
