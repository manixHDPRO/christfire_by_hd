import { useAuth } from "@/auth/AuthContext";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { userHasPermission } from "@/lib/permissions";
import {
  apiCloseAccountingDay,
  apiGetNightAuditSummary,
  apiListAccountingClosures,
  apiUrl,
  nightAuditExportUrl,
} from "@/lib/api";
import { formatPaymentNominalWithUsdEquiv } from "@/lib/paymentDisplay";
import type { AccountingDayClosure, AuthUser, NightAuditSummary } from "@/types";
import { motion } from "framer-motion";
import { Download, Lock, Moon, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

function localISODate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMethodTotals(by: Record<string, number>): string {
  return Object.entries(by)
    .sort(([a], [b]) => a.localeCompare(b, "fr"))
    .map(([k, v]) => `${k} : ${v.toLocaleString("fr-FR")}`)
    .join(" · ");
}

function canManageNightAudit(user: AuthUser | null | undefined): boolean {
  return userHasPermission(user, "accounting.close_day");
}

async function downloadNightAuditFile(date: string, format: "csv" | "json"): Promise<void> {
  const url = nightAuditExportUrl(date, format);
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return;
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `cloture-${date}.${format === "csv" ? "csv" : "json"}`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

export function NightAudit() {
  const { user } = useAuth();
  const canClose = canManageNightAudit(user);

  const [businessDate, setBusinessDate] = useState(() => localISODate());
  const [summary, setSummary] = useState<NightAuditSummary | null>(null);
  const [closures, setClosures] = useState<AccountingDayClosure[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);
  const [closeNotes, setCloseNotes] = useState("");
  const [countedUsd, setCountedUsd] = useState("");
  const [countedCdf, setCountedCdf] = useState("");
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeErr, setCloseErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setApiError(false);
    setLoading(true);
    const [s, c] = await Promise.all([apiGetNightAuditSummary(businessDate), apiListAccountingClosures()]);
    setLoading(false);
    if (s === null || c === null) {
      setApiError(true);
      setSummary(null);
      setClosures(null);
      return;
    }
    setSummary(s);
    setClosures(c);
  }, [businessDate]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const closureForDay = summary?.closure ?? null;

  const variancePreview = useMemo(() => {
    if (!summary) return { usd: null as number | null, cdf: null as number | null };
    const u = countedUsd.trim() === "" ? null : Number.parseInt(countedUsd, 10);
    const c = countedCdf.trim() === "" ? null : Number.parseInt(countedCdf, 10);
    return {
      usd: u != null && !Number.isNaN(u) ? u - summary.expectedCashUsd : null,
      cdf: c != null && !Number.isNaN(c) ? c - summary.expectedCashCdf : null,
    };
  }, [summary, countedUsd, countedCdf]);

  const onCloseDay = async () => {
    if (!summary || closureForDay) return;
    setCloseErr(null);
    setCloseBusy(true);
    const u = countedUsd.trim() === "" ? undefined : Number.parseInt(countedUsd, 10);
    const c = countedCdf.trim() === "" ? undefined : Number.parseInt(countedCdf, 10);
    if (u !== undefined && (Number.isNaN(u) || u < 0)) {
      setCloseErr("Montant USD invalide.");
      setCloseBusy(false);
      return;
    }
    if (c !== undefined && (Number.isNaN(c) || c < 0)) {
      setCloseErr("Montant CDF invalide.");
      setCloseBusy(false);
      return;
    }
    const res = await apiCloseAccountingDay({
      businessDate,
      notes: closeNotes,
      countedCashUsd: u,
      countedCashCdf: c,
    });
    setCloseBusy(false);
    if (!res.ok) {
      switch (res.code) {
        case "already_closed":
          setCloseErr("Cette journée est déjà clôturée.");
          break;
        case "forbidden":
          setCloseErr("Droits insuffisants (rôle sans accès clôture).");
          break;
        case "future_date":
          setCloseErr("Impossible de clôturer une date future.");
          break;
        case "unauthorized":
          setCloseErr("Session expirée.");
          break;
        default:
          setCloseErr("La clôture a échoué. Réessayez.");
      }
      void reload();
      return;
    }
    setCloseNotes("");
    setCountedUsd("");
    setCountedCdf("");
    void reload();
  };

  return (
    <div>
      <Breadcrumb items={[{ label: "Finance", to: "/finance" }, { label: "Clôture & audit" }]} />
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-3 font-display text-4xl tracking-wide text-white">
            <Moon className="h-9 w-9 shrink-0 text-brand-cream/90" aria-hidden />
            Clôture de journée
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/45">
            Rapprochement caisse (espèces attendues vs comptage), synthèse des encaissements réservations, droits
            d’entrée visiteur et comptoir, verrouillage de journée pour la fiabilité des exports.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-white/50">
            <span className="whitespace-nowrap">Date d’activité</span>
            <input
              type="date"
              value={businessDate}
              onChange={(e) => setBusinessDate(e.target.value)}
              className="rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/50"
            />
          </label>
          <motion.button
            type="button"
            onClick={() => void reload()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/85 outline-none transition-colors hover:bg-white/10 disabled:opacity-50"
            whileTap={{ scale: 0.98 }}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Actualiser
          </motion.button>
        </div>
      </header>

      {apiError ? (
        <p
          className="mb-6 rounded-xl border border-brand-orange/30 bg-brand-orange/10 px-4 py-3 text-sm text-brand-cream/95"
          role="alert"
        >
          Impossible de charger l’audit. Vérifiez la session et que l’API tourne ({apiUrl("/api/health")}).
        </p>
      ) : null}

      {loading && !summary ? <p className="mb-6 text-sm text-white/45">Chargement…</p> : null}

      {summary ? (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Réservations (USD)</p>
              <p className="mt-1 font-mono text-2xl text-white">{summary.reservationPayments.totalUsd.toLocaleString("fr-FR")} $</p>
              <p className="mt-2 text-[11px] text-white/45">{summary.reservationPayments.count} mouvements</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Visiteurs (USD)</p>
              <p className="mt-1 font-mono text-2xl text-white">{summary.visitorEntryPayments.totalUsd.toLocaleString("fr-FR")} $</p>
              <p className="mt-2 text-[11px] text-white/45">{summary.visitorEntryPayments.count} encaissements enregistrés</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Comptoir (CDF)</p>
              <p className="mt-1 font-mono text-2xl text-white">{summary.counterSales.totalCdf.toLocaleString("fr-FR")} FC</p>
              <p className="mt-2 text-[11px] text-white/45">{summary.counterSales.count} ventes</p>
            </div>
            <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 backdrop-blur-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200/70">Caisse espèces attendue</p>
              <p className="mt-1 text-sm text-emerald-100/95">
                USD : <span className="font-mono">{summary.expectedCashUsd.toLocaleString("fr-FR")}</span>
              </p>
              <p className="mt-1 text-sm text-emerald-100/95">
                CDF : <span className="font-mono">{summary.expectedCashCdf.toLocaleString("fr-FR")}</span>
              </p>
              <p className="mt-2 text-[11px] text-emerald-200/60">FX : 1 USD = {summary.fxCdfPerUsd.toLocaleString("fr-FR")} CDF (paramètres)</p>
            </div>
          </div>

          {closureForDay ? (
            <div className="mb-6 flex flex-wrap items-start gap-3 rounded-2xl border border-amber-400/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-50">
              <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" aria-hidden />
              <div>
                <p className="font-medium text-amber-100">Journée verrouillée</p>
                <p className="mt-1 text-amber-100/80">
                  Clôturée le {new Date(closureForDay.closedAt).toLocaleString("fr-FR")}
                  {closureForDay.closedByName ? ` par ${closureForDay.closedByName}` : ""}.
                </p>
                {closureForDay.notes ? <p className="mt-2 text-amber-100/70">Note : {closureForDay.notes}</p> : null}
                {(closureForDay.countedCashUsd != null || closureForDay.countedCashCdf != null) && (
                  <p className="mt-2 text-xs text-amber-100/75">
                    Comptage : {closureForDay.countedCashUsd != null ? `${closureForDay.countedCashUsd} USD` : "—"} ·{" "}
                    {closureForDay.countedCashCdf != null ? `${closureForDay.countedCashCdf.toLocaleString("fr-FR")} CDF` : "—"}
                    {closureForDay.varianceCashUsd != null && (
                      <span className="ml-2">· Écart USD : {closureForDay.varianceCashUsd.toLocaleString("fr-FR")}</span>
                    )}
                    {closureForDay.varianceCashCdf != null && (
                      <span className="ml-2">· Écart CDF : {closureForDay.varianceCashCdf.toLocaleString("fr-FR")}</span>
                    )}
                  </p>
                )}
              </div>
            </div>
          ) : null}

          <div className="mb-8 grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-white/10 glass-panel p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">Exports</h2>
              <p className="mt-2 text-xs text-white/40">
                Fichiers d’audit pour la date sélectionnée (détail des lignes inclus en CSV).
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void downloadNightAuditFile(businessDate, "csv")}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
                >
                  <Download className="h-4 w-4" />
                  CSV
                </button>
                <button
                  type="button"
                  onClick={() => void downloadNightAuditFile(businessDate, "json")}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
                >
                  <Download className="h-4 w-4" />
                  JSON
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 glass-panel p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">Rapprochement & clôture</h2>
              {!canClose ? (
                <p className="mt-3 text-sm text-white/45">Seuls l’administrateur et la réception peuvent verrouiller une journée.</p>
              ) : closureForDay ? (
                <p className="mt-3 text-sm text-white/45">Cette date est déjà clôturée. Les exports conservent l’état figé.</p>
              ) : (
                <>
                  <p className="mt-2 text-xs text-white/40">
                    Saisissez le comptage physique des espèces (optionnel) puis enregistrez la clôture. Les montants attendus
                    proviennent des lignes « Espèces » du jour.
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs text-white/50">
                      Comptage caisse USD
                      <input
                        type="number"
                        min={0}
                        value={countedUsd}
                        onChange={(e) => setCountedUsd(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/50"
                        placeholder={`Attendu : ${summary.expectedCashUsd}`}
                      />
                    </label>
                    <label className="block text-xs text-white/50">
                      Comptage caisse CDF
                      <input
                        type="number"
                        min={0}
                        value={countedCdf}
                        onChange={(e) => setCountedCdf(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/50"
                        placeholder={`Attendu : ${summary.expectedCashCdf}`}
                      />
                    </label>
                  </div>
                  {(variancePreview.usd != null || variancePreview.cdf != null) && (
                    <p className="mt-3 text-xs text-white/55">
                      Écart prévu :{" "}
                      {variancePreview.usd != null && (
                        <span className="font-mono text-white/80">USD {variancePreview.usd >= 0 ? "+" : ""}{variancePreview.usd}</span>
                      )}
                      {variancePreview.usd != null && variancePreview.cdf != null ? " · " : ""}
                      {variancePreview.cdf != null && (
                        <span className="font-mono text-white/80">
                          CDF {variancePreview.cdf >= 0 ? "+" : ""}
                          {variancePreview.cdf.toLocaleString("fr-FR")}
                        </span>
                      )}
                    </p>
                  )}
                  <label className="mt-4 block text-xs text-white/50">
                    Note de clôture
                    <textarea
                      value={closeNotes}
                      onChange={(e) => setCloseNotes(e.target.value)}
                      rows={2}
                      className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/50"
                      placeholder="Ex. double validation caisse, incident POS…"
                    />
                  </label>
                  {closeErr ? (
                    <p className="mt-3 text-sm text-red-300" role="alert">
                      {closeErr}
                    </p>
                  ) : null}
                  <motion.button
                    type="button"
                    disabled={closeBusy}
                    onClick={() => void onCloseDay()}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl border border-brand-orange/40 bg-brand-red/20 px-4 py-2.5 text-sm font-medium text-brand-cream hover:bg-brand-red/30 disabled:opacity-50"
                    whileTap={{ scale: 0.98 }}
                  >
                    <Lock className="h-4 w-4" />
                    {closeBusy ? "Clôture…" : "Verrouiller cette journée"}
                  </motion.button>
                </>
              )}
            </section>
          </div>

          <div className="mb-10 grid gap-6 lg:grid-cols-3">
            <section className="rounded-2xl border border-white/10 glass-panel p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-white/45">Paiements réservation</h3>
              <p className="mt-2 text-[11px] text-white/40">{formatMethodTotals(summary.reservationPayments.byMethod)}</p>
              <div className="mt-3 max-h-64 overflow-auto text-xs">
                <table className="w-full text-left text-white/75">
                  <thead className="sticky top-0 bg-zinc-900/95 text-[10px] uppercase text-white/35">
                    <tr>
                      <th className="py-1 pr-2">Heure</th>
                      <th className="py-1 pr-2">Montant</th>
                      <th className="py-1">Méth.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.reservationPayments.lines.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-4 text-center text-white/35">
                          Aucun encaissement
                        </td>
                      </tr>
                    ) : (
                      summary.reservationPayments.lines.map((row) => (
                        <tr key={row.id} className="border-t border-white/5">
                          <td className="py-1.5 pr-2 whitespace-nowrap text-white/55">
                            {row.createdAt.replace("T", " ").slice(0, 16)}
                          </td>
                          <td className="py-1.5 pr-2 text-[11px] leading-snug text-white/80">
                            {formatPaymentNominalWithUsdEquiv(row.currency, row.amountNominal, row.amountUsd)}
                          </td>
                          <td className="py-1.5">{row.method}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="rounded-2xl border border-white/10 glass-panel p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-white/45">Droits d’entrée visiteur</h3>
              <p className="mt-2 text-[11px] text-white/40">{formatMethodTotals(summary.visitorEntryPayments.byMethod)}</p>
              <div className="mt-3 max-h-64 overflow-auto text-xs">
                <table className="w-full text-left text-white/75">
                  <thead className="sticky top-0 bg-zinc-900/95 text-[10px] uppercase text-white/35">
                    <tr>
                      <th className="py-1 pr-2">Heure</th>
                      <th className="py-1 pr-2">Montant</th>
                      <th className="py-1">Client</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.visitorEntryPayments.lines.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-4 text-center text-white/35">
                          Aucun encaissement
                        </td>
                      </tr>
                    ) : (
                      summary.visitorEntryPayments.lines.map((row) => (
                        <tr key={row.id} className="border-t border-white/5">
                          <td className="py-1.5 pr-2 whitespace-nowrap text-white/55">
                            {row.createdAt.replace("T", " ").slice(0, 16)}
                          </td>
                          <td className="py-1.5 pr-2 text-[11px] leading-snug text-white/80">
                            {formatPaymentNominalWithUsdEquiv(row.currency, row.amountNominal, row.amountUsd)}
                          </td>
                          <td className="py-1.5 truncate" title={row.clientName}>
                            {row.clientName}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="rounded-2xl border border-white/10 glass-panel p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-white/45">Ventes comptoir</h3>
              <p className="mt-2 text-[11px] text-white/40">{formatMethodTotals(summary.counterSales.byMethod)}</p>
              <div className="mt-3 max-h-64 overflow-auto text-xs">
                <table className="w-full text-left text-white/75">
                  <thead className="sticky top-0 bg-zinc-900/95 text-[10px] uppercase text-white/35">
                    <tr>
                      <th className="py-1 pr-2">Heure</th>
                      <th className="py-1 pr-2">CDF</th>
                      <th className="py-1 pr-2">Caisse</th>
                      <th className="py-1">Libellé</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.counterSales.lines.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-white/35">
                          Aucune vente
                        </td>
                      </tr>
                    ) : (
                      summary.counterSales.lines.map((row) => (
                        <tr key={row.id} className="border-t border-white/5">
                          <td className="py-1.5 pr-2 whitespace-nowrap text-white/55">
                            {row.createdAt.replace("T", " ").slice(0, 16)}
                          </td>
                          <td className="py-1.5 pr-2 font-mono">{row.amountCdf.toLocaleString("fr-FR")}</td>
                          <td className="py-1.5 pr-2 truncate text-white/50" title={row.pointOfSaleLabel ?? ""}>
                            {row.pointOfSaleLabel ?? "—"}
                          </td>
                          <td className="py-1.5 truncate" title={row.label}>
                            {row.label}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {closures && closures.length > 0 ? (
            <section className="rounded-2xl border border-white/10 glass-panel p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">Historique des clôtures</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm text-white/80">
                  <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                    <tr>
                      <th className="py-2 pr-4">Date</th>
                      <th className="py-2 pr-4">Clôturée le</th>
                      <th className="py-2 pr-4">Par</th>
                      <th className="py-2 pr-4 text-right">Attendu USD</th>
                      <th className="py-2 pr-4 text-right">Attendu CDF</th>
                      <th className="py-2 text-right">Écart USD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closures.slice(0, 40).map((c) => (
                      <tr key={c.businessDate} className="border-t border-white/5">
                        <td className="py-2 pr-4 font-mono text-white/90">{c.businessDate}</td>
                        <td className="py-2 pr-4 text-white/55">{new Date(c.closedAt).toLocaleString("fr-FR")}</td>
                        <td className="py-2 pr-4">{c.closedByName ?? "—"}</td>
                        <td className="py-2 pr-4 text-right font-mono">{c.expectedCashUsd}</td>
                        <td className="py-2 pr-4 text-right font-mono">{c.expectedCashCdf.toLocaleString("fr-FR")}</td>
                        <td className="py-2 text-right font-mono">
                          {c.varianceCashUsd == null ? "—" : c.varianceCashUsd.toLocaleString("fr-FR")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
