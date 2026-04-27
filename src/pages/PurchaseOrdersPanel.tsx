import { useAuth } from "@/auth/AuthContext";
import {
  apiApprovePurchaseOrderDg,
  apiApprovePurchaseOrderManager,
  apiCreatePurchaseOrder,
  apiGetExchangeRate,
  apiGetPurchaseOrder,
  apiListFinanceCashAccounts,
  apiListPurchaseOrders,
  apiPatchPurchaseOrder,
  apiRecordPurchaseOrderSupplierPayment,
  apiRejectPurchaseOrder,
  apiReleasePurchaseOrderAccounting,
  apiReleasePurchaseOrderFinance,
  apiReopenPurchaseOrder,
  apiSubmitPurchaseOrder,
} from "@/lib/api";
import { MessageDialog } from "@/components/ui/MessageDialog";
import {
  playPurchaseOrderApprovalChime,
  playPurchaseOrderSubmittedChime,
  suppressRemotePurchaseOrderSubmitSoundForMs,
} from "@/lib/notificationSounds";
import { userHasPermission } from "@/lib/permissions";
import type { FinanceCashAccount, PurchaseOrderDetail, PurchaseOrderListRow, StockItem, StockSupplier } from "@/types";
import { Eye, FileText, Plus, Printer, RefreshCw, Wallet, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const STATUS_FR: Record<string, string> = {
  draft: "Brouillon",
  submitted: "En attente d’approbation",
  pending_finance: "Attente déblocage finance / compta",
  approved: "Approuvé",
  rejected: "Refusé",
  closed: "Clôturé (livré)",
};

function formatPoCdf(n: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n));
}

function formatPoUsd(n: number) {
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

/** Conversion indicative : taux = CDF pour 1 USD (paramètres application). */
function cdfToUsd(cdf: number, cdfPerUsd: number | null): number | null {
  if (cdfPerUsd == null || cdfPerUsd <= 0 || !Number.isFinite(cdfPerUsd)) return null;
  return cdf / cdfPerUsd;
}

function formatPoWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 16) : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type LineForm = { itemId: string; qtyOrdered: string; unitCostCdfEst: string };

export function PurchaseOrdersPanel({
  suppliers,
  items,
  onDataChanged,
}: {
  suppliers: StockSupplier[];
  items: StockItem[];
  onDataChanged?: () => void;
}) {
  const { user } = useAuth();
  const canApproveMgr = userHasPermission(user, "logistics.po_approve_manager");
  const canApproveDg = userHasPermission(user, "logistics.po_approve_dg");
  /** Aperçu « document » réservé aux profils habilités à viser le BC (Manager ou Direction générale). */
  const canPoApproverPreview = canApproveMgr || canApproveDg;
  const canReject = canApproveMgr || canApproveDg;
  const canReleaseFin = userHasPermission(user, "logistics.po_release_finance");
  const canReleaseAcc = userHasPermission(user, "logistics.po_release_accounting");
  const canCashBook = userHasPermission(user, "finance.cash_book");

  const [list, setList] = useState<PurchaseOrderListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [filterStatus, setFilterStatus] = useState("");

  const [newSupplier, setNewSupplier] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newLines, setNewLines] = useState<LineForm[]>([{ itemId: "", qtyOrdered: "1", unitCostCdfEst: "0" }]);

  const [rejectNote, setRejectNote] = useState("");
  const [releaseFinanceDetail, setReleaseFinanceDetail] = useState("");
  const [releaseAccountingDetail, setReleaseAccountingDetail] = useState("");

  const [draftEditNote, setDraftEditNote] = useState("");
  const [draftEditRef, setDraftEditRef] = useState("");
  const [draftEditSupplier, setDraftEditSupplier] = useState("");
  const [draftEditLines, setDraftEditLines] = useState<LineForm[]>([]);
  const [poPreviewOpen, setPoPreviewOpen] = useState(false);

  const [supplierPayOpen, setSupplierPayOpen] = useState(false);
  const [payAccounts, setPayAccounts] = useState<FinanceCashAccount[]>([]);
  const [payAccountsLoading, setPayAccountsLoading] = useState(false);
  const [paySourceId, setPaySourceId] = useState("");
  const [payOccurredAt, setPayOccurredAt] = useState("");
  const [payExtraNote, setPayExtraNote] = useState("");
  const [paySubmitBusy, setPaySubmitBusy] = useState(false);
  const [payFormErr, setPayFormErr] = useState<string | null>(null);
  const [fxCdfPerUsd, setFxCdfPerUsd] = useState<number | null>(null);

  /** Paiement BC lié : uniquement CDF, montant = total des lignes (serveur). */
  const payAccountsCdf = useMemo(() => payAccounts.filter((a) => a.currency === "CDF"), [payAccounts]);

  useEffect(() => {
    if (!paySourceId) return;
    if (!payAccountsCdf.some((a) => a.id === paySourceId)) setPaySourceId("");
  }, [payAccountsCdf, paySourceId]);

  const reloadList = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const rows = await apiListPurchaseOrders(filterStatus.trim() || undefined);
    setLoading(false);
    if (!rows) {
      setErr("Liste des bons de commande indisponible.");
      setList([]);
      return;
    }
    setList(rows);
  }, [filterStatus]);

  useEffect(() => {
    void reloadList();
  }, [reloadList]);

  useEffect(() => {
    void apiGetExchangeRate().then((r) => setFxCdfPerUsd(r?.cdfPerUsd ?? null));
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    const d = await apiGetPurchaseOrder(id);
    setDetailLoading(false);
    setDetail(d);
    if (d) {
      setDraftEditNote(d.note);
      setDraftEditRef(d.externalRef);
      setDraftEditSupplier(d.supplierId);
      setDraftEditLines(
        d.lines.map((l) => ({
          itemId: l.itemId,
          qtyOrdered: String(l.qtyOrdered),
          unitCostCdfEst: String(l.unitCostCdfEst),
        })),
      );
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (!poPreviewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPoPreviewOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [poPreviewOpen]);

  useEffect(() => {
    if (!detail) setPoPreviewOpen(false);
  }, [detail]);

  useEffect(() => {
    if (!supplierPayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSupplierPayOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [supplierPayOpen]);

  const openSupplierPayment = useCallback(async () => {
    if (!detail || detail.status !== "approved" || detail.supplierPaymentRecordedAt) return;
    if (detail.estimatedTotalCdf < 1) {
      setFlash("Le total estimé du bon est nul : impossible d’enregistrer un paiement fournisseur.");
      return;
    }
    setPayFormErr(null);
    setSupplierPayOpen(true);
    setPayOccurredAt(localDateKey(new Date()));
    setPaySourceId("");
    setPayExtraNote("");
    setPayAccountsLoading(true);
    const acc = await apiListFinanceCashAccounts();
    setPayAccountsLoading(false);
    setPayAccounts(acc ?? []);
  }, [detail]);

  const submitSupplierPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || detail.status !== "approved" || detail.supplierPaymentRecordedAt) return;
    setPayFormErr(null);
    if (!paySourceId.trim()) {
      setPayFormErr("Choisissez le compte (caisse ou banque) d’où part le paiement.");
      return;
    }
    setPaySubmitBusy(true);
    const res = await apiRecordPurchaseOrderSupplierPayment(detail.id, {
      occurredAt: payOccurredAt.trim() || localDateKey(new Date()),
      sourceAccountId: paySourceId.trim(),
      note: payExtraNote.trim() || undefined,
    });
    setPaySubmitBusy(false);
    if (!res.ok) {
      const msg =
        res.code === "already_paid"
          ? "Ce bon a déjà un paiement fournisseur enregistré."
          : res.code === "zero_total"
            ? "Le total du bon est nul : paiement impossible."
            : res.code === "invalid_status"
              ? "Le bon n’est pas au statut approuvé."
              : res.code === "currency_mismatch"
                ? "Le compte choisi n’est pas en CDF (le paiement BC est en CDF, total des lignes)."
                : res.code === "unknown_account"
                  ? "Compte introuvable ou inactif."
                  : res.code === "forbidden"
                    ? "Droits insuffisants sur le livre de caisse."
                    : "Enregistrement refusé. Vérifiez le compte et la date.";
      setPayFormErr(msg);
      return;
    }
    setDetail(res.purchaseOrder);
    setSupplierPayOpen(false);
    setFlash(
      `Paiement fournisseur enregistré : ${formatPoCdf(detail.estimatedTotalCdf)} CDF${
        cdfToUsd(detail.estimatedTotalCdf, fxCdfPerUsd) != null
          ? ` (≈ ${formatPoUsd(cdfToUsd(detail.estimatedTotalCdf, fxCdfPerUsd)!)} USD)`
          : ""
      } au livre de caisse (total du bon).`,
    );
    onDataChanged?.();
    await reloadList();
  };

  const refreshAll = async () => {
    await reloadList();
    onDataChanged?.();
    if (selectedId) await loadDetail(selectedId);
  };

  const parseLines = (rows: LineForm[]): { itemId: string; qtyOrdered: number; unitCostCdfEst: number }[] | null => {
    const out: { itemId: string; qtyOrdered: number; unitCostCdfEst: number }[] = [];
    const seen = new Set<string>();
    for (const ln of rows) {
      if (!ln.itemId.trim()) continue;
      if (seen.has(ln.itemId)) return null;
      seen.add(ln.itemId);
      const q = Number(ln.qtyOrdered.replace(",", "."));
      const c = Math.round(Number(ln.unitCostCdfEst.replace(/\s/g, "")));
      if (!Number.isFinite(q) || q <= 0) return null;
      if (!Number.isFinite(c) || c < 0) return null;
      out.push({ itemId: ln.itemId.trim(), qtyOrdered: q, unitCostCdfEst: c });
    }
    return out.length ? out : null;
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFlash(null);
    const lines = parseLines(newLines);
    if (!lines) {
      setFlash("Lignes invalides (articles uniques, qté > 0).");
      return;
    }
    if (!newSupplier.trim()) {
      setFlash("Choisissez un fournisseur.");
      return;
    }
    setBusy(true);
    const res = await apiCreatePurchaseOrder({
      supplierId: newSupplier,
      note: newNote.trim(),
      lines,
    });
    setBusy(false);
    if (!res.ok) {
      setFlash("Création impossible.");
      return;
    }
    setFlash("Bon de commande créé (brouillon).");
    setNewNote("");
    setNewLines([{ itemId: "", qtyOrdered: "1", unitCostCdfEst: "0" }]);
    setSelectedId(res.id);
    await refreshAll();
  };

  const saveDraft = async () => {
    if (!detail || detail.status !== "draft") return;
    const lines = parseLines(draftEditLines);
    if (!lines) {
      setFlash("Lignes invalides.");
      return;
    }
    setBusy(true);
    setFlash(null);
    const res = await apiPatchPurchaseOrder(detail.id, {
      supplierId: draftEditSupplier,
      externalRef: draftEditRef.trim(),
      note: draftEditNote.trim(),
      lines,
    });
    setBusy(false);
    if (!res.ok) {
      setFlash("Enregistrement refusé.");
      return;
    }
    setDetail(res.purchaseOrder);
    setFlash("Brouillon enregistré.");
    await reloadList();
  };

  const act = async (
    label: string,
    fn: () => Promise<{ ok: boolean }>,
    sound?: "po_submitted" | "po_approved",
  ) => {
    setBusy(true);
    setFlash(null);
    const r = await fn();
    setBusy(false);
    if (r.ok) {
      if (sound === "po_submitted") {
        suppressRemotePurchaseOrderSubmitSoundForMs(45_000);
        playPurchaseOrderSubmittedChime();
      } else if (sound === "po_approved") {
        playPurchaseOrderApprovalChime();
      }
      setFlash(label);
      await refreshAll();
    } else setFlash("Action refusée ou erreur réseau.");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-brand-orange/80" />
          <h2 className="font-display text-xl text-brand-cream/95">Bons de commande</h2>
        </div>
        <button
          type="button"
          onClick={() => void refreshAll()}
          disabled={loading || busy}
          className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:bg-white/5 disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </button>
      </div>

      <p className="text-xs text-white/45">
        Tout achat doit disposer d’un bon approuvé par le <strong className="text-white/55">Manager</strong> et la{" "}
        <strong className="text-white/55">Direction générale</strong> (deux signataires distincts). Attribuez les droits
        correspondants dans Paramètres → Rôles.
      </p>

      <MessageDialog
        open={!!(err || flash)}
        message={err || flash || ""}
        variant={err ? "warning" : "success"}
        onClose={() => {
          setErr(null);
          setFlash(null);
        }}
      />

      <form onSubmit={submitCreate} className="rounded-2xl border border-white/10 glass-panel p-5">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-white/50">Nouveau bon (brouillon)</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">Fournisseur</label>
            <select
              value={newSupplier}
              onChange={(e) => setNewSupplier(e.target.value)}
              className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
              required
            >
              <option value="">— Choisir —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col justify-end rounded-xl border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase text-white/40">Numéro de bon</p>
            <p className="mt-1 text-xs text-white/55">
              Attribué automatiquement à l’enregistrement : préfixe <span className="font-mono text-white/70">BC-</span>
              <span className="font-mono text-white/70">{new Date().getFullYear()}</span>
              <span className="font-mono text-white/70">-</span>
              <span className="text-white/45">####</span> (séquence annuelle).
            </p>
          </div>
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-[10px] font-semibold uppercase text-white/40">Note</label>
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
          />
        </div>
        <div className="mt-3 space-y-3">
          {newLines.map((ln, i) => (
            <div
              key={i}
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(5.5rem,auto)_minmax(7.5rem,auto)] sm:items-end"
            >
              <div>
                <label
                  htmlFor={`po-new-line-${i}-article`}
                  className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/40"
                >
                  Article
                </label>
                <select
                  id={`po-new-line-${i}-article`}
                  value={ln.itemId}
                  onChange={(e) => {
                    const next = [...newLines];
                    next[i] = { ...ln, itemId: e.target.value };
                    setNewLines(next);
                  }}
                  className="w-full min-w-0 rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40"
                >
                  <option value="">— Choisir —</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.code} — {it.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor={`po-new-line-${i}-qty`}
                  className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/40"
                >
                  Quantité
                </label>
                <input
                  id={`po-new-line-${i}-qty`}
                  value={ln.qtyOrdered}
                  onChange={(e) => {
                    const next = [...newLines];
                    next[i] = { ...ln, qtyOrdered: e.target.value };
                    setNewLines(next);
                  }}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 sm:max-w-[6.5rem]"
                />
              </div>
              <div>
                <label
                  htmlFor={`po-new-line-${i}-cost`}
                  className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/40"
                >
                  Coût unit. est. (CDF)
                </label>
                <input
                  id={`po-new-line-${i}-cost`}
                  value={ln.unitCostCdfEst}
                  onChange={(e) => {
                    const next = [...newLines];
                    next[i] = { ...ln, unitCostCdfEst: e.target.value };
                    setNewLines(next);
                  }}
                  inputMode="numeric"
                  placeholder="0"
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 sm:max-w-[8.5rem]"
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setNewLines([...newLines, { itemId: "", qtyOrdered: "1", unitCostCdfEst: "0" }])}
            className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:bg-white/5"
          >
            <Plus className="h-3.5 w-3.5" /> Ligne
          </button>
        </div>
        {fxCdfPerUsd != null ? (
          <p className="text-[10px] text-white/35">
            Équivalents USD sur le détail / l’aperçu : taux indicatif 1 USD = {formatPoCdf(fxCdfPerUsd)} CDF
            (Paramètres).
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          Créer le brouillon
        </button>
      </form>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
        <div className="rounded-2xl border border-white/10 glass-panel p-4">
          <div className="mb-3 flex items-center gap-2">
            <label className="text-[10px] font-semibold uppercase text-white/40">Statut</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="flex-1 rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-white outline-none"
            >
              <option value="">Tous</option>
              <option value="draft">Brouillon</option>
              <option value="submitted">En attente</option>
              <option value="approved">Approuvé</option>
              <option value="rejected">Refusé</option>
              <option value="closed">Clôturé</option>
            </select>
          </div>
          <ul className="max-h-[420px] space-y-1 overflow-auto text-sm">
            {loading ? (
              <li className="text-white/40">Chargement…</li>
            ) : list.length === 0 ? (
              <li className="text-white/40">Aucun bon.</li>
            ) : (
              list.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    className={[
                      "w-full rounded-xl border px-3 py-2 text-left transition-colors",
                      selectedId === row.id
                        ? "border-brand-orange/40 bg-brand-red/15 text-brand-cream"
                        : "border-white/10 bg-black/20 text-white/75 hover:border-white/20",
                    ].join(" ")}
                  >
                    <span className="block font-mono text-[11px] text-white/45">{row.externalRef || row.id.slice(0, 8)}</span>
                    <span className="block text-xs text-white/55">{row.supplierName}</span>
                    <span className="mt-0.5 inline-block rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/60">
                      {STATUS_FR[row.status] ?? row.status}
                      {row.status === "approved" && row.supplierPaymentRecordedAt ? " · Payé fourn." : ""}
                    </span>
                    {fxCdfPerUsd != null && row.estimatedTotalCdf > 0 && cdfToUsd(row.estimatedTotalCdf, fxCdfPerUsd) != null ? (
                      <span className="mt-0.5 block font-mono text-[10px] text-white/40">
                        ≈ {formatPoUsd(cdfToUsd(row.estimatedTotalCdf, fxCdfPerUsd)!)} USD
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="min-h-[200px] rounded-2xl border border-white/10 glass-panel p-5">
          {!selectedId ? (
            <p className="text-sm text-white/40">Sélectionnez un bon dans la liste.</p>
          ) : detailLoading || !detail ? (
            <p className="text-sm text-white/40">Chargement du détail…</p>
          ) : (
            <div className="space-y-4">
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs text-white/45">{detail.id}</p>
                  <h3 className="font-display text-lg text-brand-cream/95">
                    {detail.externalRef || "Bon de commande"} · {detail.supplierName}
                  </h3>
                  <p className="mt-1 text-xs text-white/50">
                    {STATUS_FR[detail.status] ?? detail.status}
                    {detail.createdByName ? ` · créé par ${detail.createdByName}` : null}
                  </p>
                </div>
                {canPoApproverPreview ? (
                  <button
                    type="button"
                    onClick={() => setPoPreviewOpen(true)}
                    className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-brand-orange/35 bg-brand-orange/10 px-3 py-2 text-xs font-semibold text-brand-cream/95 hover:bg-brand-orange/20"
                  >
                    <Eye className="h-4 w-4 text-brand-orange/90" aria-hidden />
                    Aperçu du bon
                  </button>
                ) : null}
              </header>
              <p className="text-sm text-white/70">
                Total estimé :{" "}
                <span className="font-mono tabular-nums text-brand-cream/95">
                  {formatPoCdf(detail.estimatedTotalCdf)} CDF
                </span>
                {cdfToUsd(detail.estimatedTotalCdf, fxCdfPerUsd) != null ? (
                  <>
                    {" "}
                    <span className="text-white/45">·</span> ≈{" "}
                    <span className="font-mono tabular-nums text-white/70">
                      {formatPoUsd(cdfToUsd(detail.estimatedTotalCdf, fxCdfPerUsd)!)}
                    </span>{" "}
                    USD
                  </>
                ) : null}
                {fxCdfPerUsd != null ? (
                  <span className="ml-1 block text-[10px] text-white/35 sm:ml-2 sm:inline">
                    (conversion indicative : 1 USD = {formatPoCdf(fxCdfPerUsd)} CDF)
                  </span>
                ) : null}
                {fxCdfPerUsd == null ? (
                  <span className="ml-1 block text-[10px] text-amber-200/60 sm:inline">
                    Taux CDF/USD indisponible — ouvrez la session ou configurez le taux dans Paramètres.
                  </span>
                ) : null}
              </p>

              {detail.status === "draft" ? (
                <div className="space-y-3 border-t border-white/10 pt-4">
                  <p className="text-xs font-semibold uppercase text-white/45">Modifier le brouillon</p>
                  <div>
                    <label
                      htmlFor="po-draft-supplier"
                      className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/40"
                    >
                      Fournisseur
                    </label>
                    <select
                      id="po-draft-supplier"
                      value={draftEditSupplier}
                      onChange={(e) => setDraftEditSupplier(e.target.value)}
                      className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none"
                    >
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="po-draft-ref"
                      className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/40"
                    >
                      Numéro / référence BC
                    </label>
                    <input
                      id="po-draft-ref"
                      value={draftEditRef}
                      onChange={(e) => setDraftEditRef(e.target.value)}
                      className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none"
                      placeholder="ex. BC-2026-0001"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="po-draft-note"
                      className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/40"
                    >
                      Note
                    </label>
                    <textarea
                      id="po-draft-note"
                      value={draftEditNote}
                      onChange={(e) => setDraftEditNote(e.target.value)}
                      rows={2}
                      className="w-full resize-none rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none"
                    />
                  </div>
                  <div className="space-y-3">
                    {draftEditLines.map((ln, i) => (
                      <div
                        key={i}
                        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(5rem,auto)_minmax(6.5rem,auto)] sm:items-end"
                      >
                        <div>
                          <label
                            htmlFor={`po-draft-line-${i}-article`}
                            className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/40"
                          >
                            Article
                          </label>
                          <select
                            id={`po-draft-line-${i}-article`}
                            value={ln.itemId}
                            onChange={(e) => {
                              const next = [...draftEditLines];
                              next[i] = { ...ln, itemId: e.target.value };
                              setDraftEditLines(next);
                            }}
                            className="w-full min-w-0 rounded-xl border border-white/15 bg-black/30 px-2 py-2 text-xs text-white outline-none"
                          >
                            {items.map((it) => (
                              <option key={it.id} value={it.id}>
                                {it.code} — {it.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label
                            htmlFor={`po-draft-line-${i}-qty`}
                            className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/40"
                          >
                            Quantité
                          </label>
                          <input
                            id={`po-draft-line-${i}-qty`}
                            value={ln.qtyOrdered}
                            onChange={(e) => {
                              const next = [...draftEditLines];
                              next[i] = { ...ln, qtyOrdered: e.target.value };
                              setDraftEditLines(next);
                            }}
                            inputMode="decimal"
                            className="w-full rounded-xl border border-white/15 bg-black/30 px-2 py-2 font-mono text-xs text-white outline-none sm:max-w-[5.5rem]"
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`po-draft-line-${i}-cost`}
                            className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/40"
                          >
                            Coût unit. est. (CDF)
                          </label>
                          <input
                            id={`po-draft-line-${i}-cost`}
                            value={ln.unitCostCdfEst}
                            onChange={(e) => {
                              const next = [...draftEditLines];
                              next[i] = { ...ln, unitCostCdfEst: e.target.value };
                              setDraftEditLines(next);
                            }}
                            inputMode="numeric"
                            className="w-full rounded-xl border border-white/15 bg-black/30 px-2 py-2 font-mono text-xs text-white outline-none sm:max-w-[7rem]"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  {fxCdfPerUsd != null ? (
                    <p className="text-[10px] text-white/35">
                      Équivalents USD : 1 USD = {formatPoCdf(fxCdfPerUsd)} CDF (indicatif, voir aperçu du bon).
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void saveDraft()}
                      className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-40"
                    >
                      Enregistrer
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          "Bon soumis pour approbation.",
                          async () => {
                            const r = await apiSubmitPurchaseOrder(detail.id);
                            if (r.ok) setDetail(r.purchaseOrder);
                            return { ok: r.ok };
                          },
                          "po_submitted",
                        )
                      }
                      className="rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      Soumettre pour approbation
                    </button>
                  </div>
                </div>
              ) : null}

              {detail.status === "submitted" ? (
                <div className="space-y-3 border-t border-white/10 pt-4">
                  <div className="grid gap-2 text-xs text-white/60 sm:grid-cols-2">
                    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                      <p className="font-semibold uppercase tracking-wide text-white/40">Manager</p>
                      <p className="mt-1 text-white/75">
                        {detail.managerApprovedAt
                          ? `✓ ${detail.managerApprovedByName ?? "—"} · ${detail.managerApprovedAt.slice(0, 16)}`
                          : "En attente"}
                      </p>
                      {canApproveMgr && !detail.managerApprovedAt ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              "Approbation Manager enregistrée.",
                              async () => {
                                const r = await apiApprovePurchaseOrderManager(detail.id);
                                if (r.ok) setDetail(r.purchaseOrder);
                                return { ok: r.ok };
                              },
                              "po_approved",
                            )
                          }
                          className="mt-2 rounded-lg bg-emerald-600/80 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                        >
                          Approuver (Manager)
                        </button>
                      ) : null}
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                      <p className="font-semibold uppercase tracking-wide text-white/40">Direction générale</p>
                      <p className="mt-1 text-white/75">
                        {detail.dgApprovedAt
                          ? `✓ ${detail.dgApprovedByName ?? "—"} · ${detail.dgApprovedAt.slice(0, 16)}`
                          : "En attente"}
                      </p>
                      {canApproveDg && !detail.dgApprovedAt ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              "Approbation DG enregistrée.",
                              async () => {
                                const r = await apiApprovePurchaseOrderDg(detail.id);
                                if (r.ok) setDetail(r.purchaseOrder);
                                return { ok: r.ok };
                              },
                              "po_approved",
                            )
                          }
                          className="mt-2 rounded-lg bg-emerald-600/80 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                        >
                          Approuver (Direction générale)
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {canReject ? (
                    <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
                      <p className="text-[11px] font-semibold uppercase text-rose-200/70">Refuser le bon</p>
                      <textarea
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        rows={2}
                        placeholder="Motif…"
                        className="mt-2 w-full resize-none rounded-lg border border-white/15 bg-black/30 px-2 py-2 text-xs text-white outline-none"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void act("Bon refusé.", async () => {
                            const r = await apiRejectPurchaseOrder(detail.id, rejectNote);
                            if (r.ok) {
                              setDetail(r.purchaseOrder);
                              setRejectNote("");
                            }
                            return { ok: r.ok };
                          })
                        }
                        className="mt-2 rounded-lg border border-rose-400/40 px-3 py-1.5 text-[11px] font-semibold text-rose-200/90 disabled:opacity-40"
                      >
                        Refuser
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {detail.status === "pending_finance" ? (
                <div className="space-y-3 border-t border-white/10 pt-4">
                  <p className="text-xs text-amber-200/80">
                    Deux validations distinctes sont requises : <strong>Finance</strong> et <strong>Comptabilité</strong>{" "}
                    (deux utilisateurs différents). Saisissez le détail du déblocage (réf. fonds, compte, etc.).
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                      <p className="text-[11px] font-semibold uppercase text-white/45">Finance</p>
                      <p className="mt-1 text-xs text-white/60">
                        {detail.financeReleasedAt
                          ? `✓ ${detail.financeReleasedByName ?? "—"} · ${detail.financeReleasedAt.slice(0, 16)}`
                          : "En attente"}
                      </p>
                      {canReleaseFin && !detail.financeReleasedAt ? (
                        <>
                          <textarea
                            value={releaseFinanceDetail}
                            onChange={(e) => setReleaseFinanceDetail(e.target.value)}
                            rows={2}
                            placeholder="Détail obligatoire…"
                            className="mt-2 w-full resize-none rounded-lg border border-white/15 bg-black/30 px-2 py-2 text-xs text-white outline-none"
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void act("Déblocage finance enregistré.", async () => {
                                const r = await apiReleasePurchaseOrderFinance(detail.id, releaseFinanceDetail.trim());
                                if (r.ok) {
                                  setDetail(r.purchaseOrder);
                                  setReleaseFinanceDetail("");
                                }
                                return { ok: r.ok };
                              })
                            }
                            className="mt-2 rounded-lg bg-amber-600/85 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                          >
                            Valider (Finance)
                          </button>
                        </>
                      ) : null}
                    </div>
                    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                      <p className="text-[11px] font-semibold uppercase text-white/45">Comptabilité</p>
                      <p className="mt-1 text-xs text-white/60">
                        {detail.accountingReleasedAt
                          ? `✓ ${detail.accountingReleasedByName ?? "—"} · ${detail.accountingReleasedAt.slice(0, 16)}`
                          : "En attente"}
                      </p>
                      {canReleaseAcc && !detail.accountingReleasedAt ? (
                        <>
                          <textarea
                            value={releaseAccountingDetail}
                            onChange={(e) => setReleaseAccountingDetail(e.target.value)}
                            rows={2}
                            placeholder="Détail obligatoire…"
                            className="mt-2 w-full resize-none rounded-lg border border-white/15 bg-black/30 px-2 py-2 text-xs text-white outline-none"
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void act("Déblocage comptabilité enregistré.", async () => {
                                const r = await apiReleasePurchaseOrderAccounting(
                                  detail.id,
                                  releaseAccountingDetail.trim(),
                                );
                                if (r.ok) {
                                  setDetail(r.purchaseOrder);
                                  setReleaseAccountingDetail("");
                                }
                                return { ok: r.ok };
                              })
                            }
                            className="mt-2 rounded-lg bg-amber-600/85 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                          >
                            Valider (Comptabilité)
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {detail.status === "approved" ? (
                <div className="space-y-3 border-t border-white/10 pt-4">
                  <p className="text-xs text-white/55">
                    Bon approuvé : vous pouvez réceptionner les marchandises au dépôt. Un seul paiement fournisseur peut
                    être enregistré ici : il crée une <strong className="text-white/70">dépense</strong> au livre de
                    caisse pour le <strong className="text-white/70">total estimé du bon en CDF</strong> (équivalent USD
                    affiché à titre indicatif selon le taux des paramètres).
                  </p>
                  {detail.supplierPaymentRecordedAt ? (
                    <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100/90">
                      Paiement fournisseur déjà enregistré le{" "}
                      <span className="font-medium">{formatPoWhen(detail.supplierPaymentRecordedAt)}</span> —{" "}
                      {formatPoCdf(detail.estimatedTotalCdf)} CDF
                      {cdfToUsd(detail.estimatedTotalCdf, fxCdfPerUsd) != null
                        ? ` (≈ ${formatPoUsd(cdfToUsd(detail.estimatedTotalCdf, fxCdfPerUsd)!)} USD)`
                        : ""}{" "}
                      (une seule écriture ; livre de caisse en CDF).
                    </p>
                  ) : detail.estimatedTotalCdf < 1 ? (
                    <p className="text-xs text-amber-200/85">Total du bon nul : enregistrement du paiement indisponible.</p>
                  ) : canCashBook ? (
                    <button
                      type="button"
                      onClick={() => void openSupplierPayment()}
                      className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-100/95 hover:bg-emerald-500/20"
                    >
                      <Wallet className="h-4 w-4 text-emerald-300/90" aria-hidden />
                      Enregistrer le paiement fournisseur
                    </button>
                  ) : (
                    <p className="text-xs text-white/40">
                      Le bouton de paiement nécessite le droit{" "}
                      <span className="font-mono text-white/50">finance.cash_book</span> (livre de caisse).{" "}
                      <Link to="/livre-caisse" className="text-brand-orange/90 underline hover:text-brand-orange">
                        Ouvrir le livre de caisse
                      </Link>
                    </p>
                  )}
                </div>
              ) : null}

              {detail.status === "rejected" ? (
                <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white/60">
                  <p className="font-semibold text-rose-200/80">Refus</p>
                  <p className="mt-1">{detail.rejectionNote || "—"}</p>
                  <p className="mt-1 text-white/45">
                    Par {detail.rejectedByName ?? "—"} · {detail.rejectedAt?.slice(0, 16) ?? "—"}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act("Bon rouvert en brouillon.", async () => {
                        const r = await apiReopenPurchaseOrder(detail.id);
                        if (r.ok) setDetail(r.purchaseOrder);
                        return { ok: r.ok };
                      })
                    }
                    className="mt-3 rounded-lg border border-white/20 px-3 py-1.5 text-[11px] font-semibold text-white/80 disabled:opacity-40"
                  >
                    Rouvrir en brouillon
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {poPreviewOpen && detail && canPoApproverPreview ? (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 print:static print:inset-auto print:z-auto print:block print:p-0">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm print:hidden"
            aria-label="Fermer l’aperçu"
            onClick={() => setPoPreviewOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="po-preview-title"
            className="relative z-[1] flex max-h-[min(92vh,920px)] w-full max-w-3xl flex-col rounded-2xl border border-white/15 bg-[#1a1210] shadow-2xl print:max-h-none print:max-w-none print:border-0 print:shadow-none"
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3 print:hidden">
              <h2 id="po-preview-title" className="font-display text-base text-brand-cream/95">
                Aperçu — Bon de commande
              </h2>
              <button
                type="button"
                onClick={() => setPoPreviewOpen(false)}
                className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
                aria-label="Fermer"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-sm print:overflow-visible">
              <div className="border-b border-white/10 pb-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">Bon de commande</p>
                <p className="mt-1 font-display text-xl text-white">{detail.externalRef || "—"}</p>
                <p className="mt-2 text-white/75">
                  <span className="text-white/45">Fournisseur : </span>
                  {detail.supplierName}
                </p>
                <p className="mt-1 text-white/75">
                  <span className="text-white/45">Statut : </span>
                  {STATUS_FR[detail.status] ?? detail.status}
                </p>
                <div className="mt-3 grid gap-1 text-xs text-white/55 sm:grid-cols-2">
                  <p>
                    <span className="text-white/40">Créé le : </span>
                    {formatPoWhen(detail.createdAt)}
                    {detail.createdByName ? ` · ${detail.createdByName}` : null}
                  </p>
                  <p>
                    <span className="text-white/40">Soumis le : </span>
                    {formatPoWhen(detail.submittedAt)}
                  </p>
                </div>
              </div>
              {(detail.managerApprovedAt || detail.dgApprovedAt) && (
                <div className="mt-4 grid gap-2 text-xs text-white/60 sm:grid-cols-2">
                  <p>
                    <span className="font-semibold text-white/45">Visa Manager : </span>
                    {detail.managerApprovedAt
                      ? `${detail.managerApprovedByName ?? "—"} · ${formatPoWhen(detail.managerApprovedAt)}`
                      : "—"}
                  </p>
                  <p>
                    <span className="font-semibold text-white/45">Visa Direction générale : </span>
                    {detail.dgApprovedAt
                      ? `${detail.dgApprovedByName ?? "—"} · ${formatPoWhen(detail.dgApprovedAt)}`
                      : "—"}
                  </p>
                </div>
              )}
              {detail.note.trim() ? (
                <div className="mt-4 rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-white/70">
                  <p className="font-semibold uppercase tracking-wide text-white/40">Note</p>
                  <p className="mt-1 whitespace-pre-wrap">{detail.note}</p>
                </div>
              ) : null}
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/15 text-[10px] font-semibold uppercase tracking-wide text-white/45">
                      <th className="py-2 pr-3">Article</th>
                      <th className="py-2 pr-3">Unité</th>
                      <th className="py-2 pr-3 text-right">Qté</th>
                      <th className="py-2 pr-3 text-right">PU est. (CDF)</th>
                      <th className="py-2 pr-3 text-right">PU ≈ (USD)</th>
                      <th className="py-2 pr-3 text-right">Montant (CDF)</th>
                      <th className="py-2 text-right">Montant ≈ (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l) => {
                      const lineTotal = Math.round(l.qtyOrdered * l.unitCostCdfEst);
                      const puUsd = cdfToUsd(l.unitCostCdfEst, fxCdfPerUsd);
                      const lineUsd = cdfToUsd(lineTotal, fxCdfPerUsd);
                      return (
                        <tr key={l.id} className="border-b border-white/5 text-white/80">
                          <td className="py-2 pr-3">
                            <span className="font-mono text-white/55">{l.itemCode}</span>{" "}
                            <span className="text-white/75">{l.itemLabel}</span>
                          </td>
                          <td className="py-2 pr-3 text-white/55">{l.itemUnit}</td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">
                            {l.qtyOrdered.toLocaleString("fr-FR", { maximumFractionDigits: 3 })}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">
                            {formatPoCdf(l.unitCostCdfEst)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono text-[11px] tabular-nums text-white/50">
                            {puUsd != null ? formatPoUsd(puUsd) : "—"}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatPoCdf(lineTotal)}</td>
                          <td className="py-2 text-right font-mono text-[11px] tabular-nums text-white/50">
                            {lineUsd != null ? formatPoUsd(lineUsd) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-right text-sm font-semibold text-white/90">
                Total estimé :{" "}
                <span className="font-mono tabular-nums text-brand-cream">{formatPoCdf(detail.estimatedTotalCdf)}</span>{" "}
                CDF
                {cdfToUsd(detail.estimatedTotalCdf, fxCdfPerUsd) != null ? (
                  <>
                    {" "}
                    <span className="text-white/50">·</span> ≈{" "}
                    <span className="font-mono tabular-nums text-white/75">
                      {formatPoUsd(cdfToUsd(detail.estimatedTotalCdf, fxCdfPerUsd)!)}
                    </span>{" "}
                    USD
                  </>
                ) : null}
              </p>
              <p className="mt-2 text-right text-[10px] text-white/35">
                {fxCdfPerUsd != null
                  ? `Conversion USD indicative : 1 USD = ${formatPoCdf(fxCdfPerUsd)} CDF (paramètres).`
                  : "Conversion USD : taux indisponible (paramètres)."}
              </p>
              <p className="mt-4 text-[10px] text-white/35">
                Document informatif pour instruction — les montants sont des estimations en CDF avant réception définitive.
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 px-4 py-3 print:hidden">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-4 py-2 text-xs font-semibold text-white/85 hover:bg-white/10"
              >
                <Printer className="h-4 w-4" aria-hidden />
                Imprimer
              </button>
              <button
                type="button"
                onClick={() => setPoPreviewOpen(false)}
                className="rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange px-4 py-2 text-xs font-semibold text-white"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {supplierPayOpen &&
      detail &&
      detail.status === "approved" &&
      !detail.supplierPaymentRecordedAt &&
      canCashBook ? (
        <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="Fermer"
            onClick={() => setSupplierPayOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="po-pay-title"
            className="relative z-[1] w-full max-w-lg rounded-2xl border border-white/15 bg-[#1a1210] shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
              <h2 id="po-pay-title" className="font-display text-base text-brand-cream/95">
                Paiement fournisseur
              </h2>
              <button
                type="button"
                onClick={() => setSupplierPayOpen(false)}
                className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
                aria-label="Fermer"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <form onSubmit={(e) => void submitSupplierPayment(e)} className="space-y-4 px-4 py-4">
              <p className="text-xs text-white/55">
                <span className="font-mono text-white/65">{detail.externalRef || detail.id.slice(0, 8)}</span>
                {" · "}
                {detail.supplierName}
              </p>
              <p className="text-[11px] text-white/40">
                Une seule fois par bon : dépense en <strong className="text-white/55">CDF</strong> pour le total des
                lignes ({formatPoCdf(detail.estimatedTotalCdf)} CDF
                {cdfToUsd(detail.estimatedTotalCdf, fxCdfPerUsd) != null
                  ? ` · ≈ ${formatPoUsd(cdfToUsd(detail.estimatedTotalCdf, fxCdfPerUsd)!)} USD`
                  : ""}
                ). Compte source en CDF (caisse ou banque).
                {fxCdfPerUsd != null
                  ? ` Taux affiché : 1 USD = ${formatPoCdf(fxCdfPerUsd)} CDF.`
                  : ""}
              </p>
              {payFormErr ? (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/90">
                  {payFormErr}
                </p>
              ) : null}
              <div>
                <label htmlFor="po-pay-date" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                  Date du paiement
                </label>
                <input
                  id="po-pay-date"
                  type="date"
                  value={payOccurredAt}
                  onChange={(e) => setPayOccurredAt(e.target.value)}
                  className="w-full max-w-xs rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none"
                />
              </div>
              <div>
                <label htmlFor="po-pay-account" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                  Compte (caisse ou banque)
                </label>
                <select
                  id="po-pay-account"
                  value={paySourceId}
                  onChange={(e) => setPaySourceId(e.target.value)}
                  disabled={payAccountsLoading}
                  required
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none disabled:opacity-50"
                >
                  <option value="">{payAccountsLoading ? "Chargement…" : "— Choisir —"}</option>
                  {payAccountsCdf.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} ({a.kind === "physical" ? "caisse" : "banque"})
                    </option>
                  ))}
                </select>
                {!payAccountsLoading && payAccountsCdf.length === 0 ? (
                  <p className="mt-1 text-[11px] text-amber-200/80">
                    Aucun compte actif en CDF. Créez-en un dans{" "}
                    <Link to="/livre-caisse" className="underline">
                      Livre de caisse
                    </Link>
                    .
                  </p>
                ) : null}
              </div>
              <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase text-white/40">Montant (figé — total du bon)</p>
                <p className="mt-1 font-mono text-sm tabular-nums text-white/90">
                  {formatPoCdf(detail.estimatedTotalCdf)} CDF
                  {cdfToUsd(detail.estimatedTotalCdf, fxCdfPerUsd) != null ? (
                    <span className="block text-[11px] font-normal text-white/50">
                      ≈ {formatPoUsd(cdfToUsd(detail.estimatedTotalCdf, fxCdfPerUsd)!)} USD (indicatif)
                    </span>
                  ) : null}
                </p>
              </div>
              <div>
                <label htmlFor="po-pay-note" className="mb-1 block text-[10px] font-semibold uppercase text-white/40">
                  Note complémentaire (optionnel)
                </label>
                <input
                  id="po-pay-note"
                  type="text"
                  value={payExtraNote}
                  onChange={(e) => setPayExtraNote(e.target.value)}
                  placeholder="ex. virement Ref. …"
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none"
                />
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 pt-4">
                <button
                  type="button"
                  onClick={() => setSupplierPayOpen(false)}
                  className="rounded-xl border border-white/20 px-4 py-2 text-xs font-semibold text-white/80 hover:bg-white/5"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={paySubmitBusy || payAccountsLoading || payAccountsCdf.length === 0}
                  className="rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
                >
                  {paySubmitBusy ? "Enregistrement…" : "Valider le paiement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
