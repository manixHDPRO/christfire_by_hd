import { Breadcrumb } from "@/components/layout/Breadcrumb";
import {
  apiGetVisitorEntryPaymentsLedger,
  apiListClients,
  apiListPayments,
  apiListReservations,
} from "@/lib/api";
import { formatPaymentNominalWithUsdEquiv } from "@/lib/paymentDisplay";
import { normalizeReservationFromApi } from "@/lib/reservationBungalows";
import { reservationToBillingRow } from "@/lib/reservationBilling";
import { visitorEntryFeeOpenInvoice, visitorLedgerRowToInvoice } from "@/lib/visitorBilling";
import type { Client, Invoice, PaymentStatus, ReservationPaymentLedgerRow } from "@/types";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

const payStyles: Record<PaymentStatus, string> = {
  "En attente": "border-amber-400/30 bg-amber-500/10 text-amber-100",
  Partiel: "border-brand-orange/35 bg-brand-orange/10 text-brand-cream",
  Payé: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
  Remboursé: "border-white/20 bg-white/5 text-white/60",
};

export function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [reservationPaymentsLedger, setReservationPaymentsLedger] = useState<ReservationPaymentLedgerRow[]>([]);
  const [reservationLedgerUnavailable, setReservationLedgerUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const [resList, cl, ledger, resPayLedger] = await Promise.all([
        apiListReservations(),
        apiListClients(),
        apiGetVisitorEntryPaymentsLedger(),
        apiListPayments(),
      ]);
      if (cancelled) return;
      setLoading(false);
      if (resList === null || cl === null) {
        setApiError(true);
        setInvoices([]);
        setClients([]);
        setReservationPaymentsLedger([]);
        setReservationLedgerUnavailable(true);
        return;
      }
      setApiError(false);
      if (resPayLedger === null) {
        setReservationPaymentsLedger([]);
        setReservationLedgerUnavailable(true);
      } else {
        setReservationPaymentsLedger(resPayLedger);
        setReservationLedgerUnavailable(false);
      }
      const norm = resList.map((r) =>
        normalizeReservationFromApi({
          ...r,
          amountPaid: r.amountPaid ?? 0,
          latePenaltyUsd: r.latePenaltyUsd ?? 0,
        }),
      );
      setClients(cl);
      const fromRes = norm.map(reservationToBillingRow);
      const fromVisitorLedger = (ledger ?? []).map(visitorLedgerRowToInvoice);
      const fromVisitorOpen = cl
        .map(visitorEntryFeeOpenInvoice)
        .filter((x): x is Invoice => x != null);
      setInvoices([...fromVisitorLedger, ...fromVisitorOpen, ...fromRes]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(
    () =>
      [...invoices].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt) || a.id.localeCompare(b.id)),
    [invoices],
  );

  const reservationLedgerRows = useMemo(
    () =>
      [...reservationPaymentsLedger].sort(
        (a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.id.localeCompare(a.id),
      ),
    [reservationPaymentsLedger],
  );

  return (
    <div>
      <Breadcrumb items={[{ label: "Finance", to: "/finance" }, { label: "Facturation" }]} />
      <header className="mb-8">
        <h1 className="font-display text-4xl tracking-wide text-white">Facturation</h1>
        <p className="mt-2 text-sm text-white/45">
          Réservations et droits d’entrée visiteur : montant dû et statut d’encaissement (SQLite). Export PDF en atelier.
        </p>
      </header>

      {apiError ? (
        <p className="mb-6 rounded-xl border border-brand-orange/30 bg-brand-orange/10 px-4 py-3 text-sm text-brand-cream/95" role="alert">
          Impossible de charger la facturation. Vérifiez la session et le serveur API.
        </p>
      ) : null}

      {loading ? (
        <p className="mb-6 text-sm text-white/45">Chargement…</p>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-white/10 glass-panel">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
            <tr>
              <th className="px-4 py-3">N° pièce</th>
              <th className="px-4 py-3">Nature</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Émission</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Paiement</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-white/40">
                  Aucune pièce à afficher.
                </td>
              </tr>
            ) : (
              rows.map((inv, i) => {
                const cl = clients.find((c) => c.id === inv.clientId);
                return (
                  <motion.tr
                    key={inv.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.04, 0.4) }}
                    className="border-b border-white/5 hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-4 font-mono text-xs text-brand-orange/90">{inv.number}</td>
                    <td className="px-4 py-4 text-xs text-white/55">{inv.lineLabel ?? "—"}</td>
                    <td className="px-4 py-4 text-white/80">{cl?.name ?? "—"}</td>
                    <td className="px-4 py-4 text-white/45">{inv.issuedAt}</td>
                    <td className="px-4 py-4 text-right font-medium text-brand-cream/90">
                      {inv.total.toLocaleString("fr-FR")} $
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase ${payStyles[inv.payment]}`}
                      >
                        {inv.payment}
                      </span>
                    </td>
                  </motion.tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!loading && !apiError ? (
        <>
          <header className="mb-4 mt-12">
            <h2 className="font-display text-2xl tracking-wide text-white">Journal des encaissements (réservations)</h2>
            <p className="mt-2 text-sm text-white/45">
              Mouvements enregistrés sur les séjours : montant saisi (USD ou francs congolais) et crédit en dollars sur le
              solde.
            </p>
          </header>

          {reservationLedgerUnavailable ? (
            <p
              className="mb-6 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm text-white/55"
              role="status"
            >
              Le journal détaillé des paiements réservation n’est pas disponible (droits insuffisants, session expirée ou
              erreur réseau). Les opérations d’encaissement restent possibles depuis{" "}
              <strong className="text-white/70">Paiements</strong> pour les profils autorisés.
            </p>
          ) : null}

          {!reservationLedgerUnavailable ? (
            <div className="overflow-hidden rounded-2xl border border-white/10 glass-panel">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Unité</th>
                    <th className="px-4 py-3">Séjour</th>
                    <th className="px-4 py-3">Montant</th>
                    <th className="px-4 py-3">Méthode</th>
                    <th className="px-4 py-3 text-right">Cumul USD après</th>
                    <th className="px-4 py-3">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {reservationLedgerRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-white/40">
                        Aucun encaissement réservation en base.
                      </td>
                    </tr>
                  ) : (
                    reservationLedgerRows.map((p, i) => (
                      <motion.tr
                        key={p.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i * 0.02, 0.3) }}
                        className="border-b border-white/5 hover:bg-white/[0.02]"
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-white/55">
                          {(p.createdAt ?? "").replace("T", " ").slice(0, 16)}
                        </td>
                        <td className="px-4 py-3 text-white/85">{p.clientName}</td>
                        <td className="px-4 py-3 text-xs text-brand-orange/85">{p.bungalowCode}</td>
                        <td className="px-4 py-3 text-xs text-white/50">
                          {p.stayStart} → {p.stayEnd}
                        </td>
                        <td className="px-4 py-3 text-xs leading-snug text-brand-cream/90">
                          {formatPaymentNominalWithUsdEquiv(p.currency, p.amount, p.amountUsdEquivalent)}
                        </td>
                        <td className="px-4 py-3 text-white/60">{p.method}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-white/70">
                          {p.reservationAmountPaid != null ? `${p.reservationAmountPaid} $` : "—"}
                        </td>
                        <td className="max-w-[200px] truncate px-4 py-3 text-xs text-white/40" title={p.note}>
                          {p.note?.trim() ? p.note : "—"}
                        </td>
                      </motion.tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
