import type { Client, Invoice, PaymentStatus, VisitorEntryPaymentLedgerRow } from "@/types";

export function visitorEntryFeePaymentStatus(dueUsd: number, paidUsd: number): PaymentStatus {
  const due = Math.max(0, Math.floor(dueUsd));
  const paid = Math.max(0, Math.floor(paidUsd));
  if (due <= 0) return "Payé";
  if (paid >= due) return "Payé";
  if (paid > 0) return "Partiel";
  return "En attente";
}

/** Une ligne de facturation par encaissement enregistré (journal SQL). */
export function visitorLedgerRowToInvoice(row: VisitorEntryPaymentLedgerRow): Invoice {
  const raw = row.createdAt ?? "";
  const date = raw.length >= 10 ? raw.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const y = date.slice(0, 4);
  const short = row.id.replace(/-/g, "").slice(0, 6).toUpperCase();
  const notePart = row.note?.trim() ? ` — ${row.note.trim().slice(0, 48)}` : "";
  const nom = row.amountNominal ?? row.amountUsd;
  const cur = row.currency === "CDF" ? "CDF" : "USD";
  const curPart =
    cur === "CDF" && nom !== row.amountUsd
      ? ` — ${nom.toLocaleString("fr-CD")} FC (équiv. ${row.amountUsd} $)`
      : "";
  return {
    id: `bill-visitor-ledger-${row.id}`,
    reservationId: `visitor-ledger-${row.id}`,
    clientId: row.clientId,
    number: `CF-V-ENC-${y}-${short}`,
    total: Math.max(0, Math.floor(row.amountUsd)),
    payment: "Payé",
    issuedAt: date,
    lineLabel: `Encaissement droit d’entrée (${row.method})${curPart}${notePart}`,
  };
}

export function visitorLedgerRowsToInvoices(rows: VisitorEntryPaymentLedgerRow[]): Invoice[] {
  return [...rows]
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.id.localeCompare(a.id))
    .map(visitorLedgerRowToInvoice);
}

/**
 * Facture « solde courant » visiteur : uniquement s’il reste quelque chose à encaisser.
 * Les encaissements passés apparaissent chacun comme une ligne du journal (`visitorLedgerRowsToInvoices`).
 */
export function visitorEntryFeeOpenInvoice(c: Client): Invoice | null {
  const due = Math.max(0, Math.floor(c.entryFeeUsd ?? 0));
  if (due < 1) return null;
  const paid = Math.max(0, Math.floor(c.entryFeePaidUsd ?? 0));
  if (paid >= due) return null;
  const issued = (c.updatedAt ?? c.createdAt ?? "").slice(0, 10);
  const date = issued.length >= 10 ? issued : new Date().toISOString().slice(0, 10);
  const y = date.slice(0, 4);
  const short = c.id.replace(/-/g, "").slice(0, 6).toUpperCase();
  return {
    id: `bill-visitor-open-${c.id}`,
    reservationId: `visitor-open-${c.id}`,
    clientId: c.id,
    number: `CF-V-${y}-${short}`,
    total: due,
    payment: visitorEntryFeePaymentStatus(due, paid),
    issuedAt: date,
    lineLabel: "Droit d’entrée visiteur (échéance en cours)",
  };
}
