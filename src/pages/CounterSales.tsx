import { useAuth } from "@/auth/AuthContext";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import {
  apiCreateCounterSale,
  apiGetTreasuryCashDayStatus,
  apiListClients,
  apiListCounterSalePoints,
  apiListCounterSales,
  type CounterSalePointOfSale,
} from "@/lib/api";
import { userHasPermission } from "@/lib/permissions";
import type { Client, CounterSale, ReservationPaymentMethod } from "@/types";
import { AnimatePresence, motion } from "framer-motion";
import { ShoppingBag } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const METHODS: ReservationPaymentMethod[] = ["Espèces", "Carte", "Virement", "Autre"];

const QUICK_AMOUNTS = [1000, 2000, 5000, 10_000, 20_000] as const;

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function saleDateKey(createdAt: string): string {
  return createdAt.slice(0, 10);
}

function formErrorMessage(code: string): string {
  switch (code) {
    case "unknown_client":
      return "Client sélectionné introuvable.";
    case "validation_error":
      return "Montant invalide (CDF entier, minimum 1) ou champs trop longs.";
    case "unauthorized":
      return "Session expirée. Reconnectez-vous.";
    case "network_error":
      return "Réseau indisponible.";
    case "forbidden_point_of_sale":
      return "Cette caisse ne vous est pas assignée.";
    case "no_point_of_sale_assignment":
      return "Aucune caisse ne vous est assignée. Contactez l’administrateur.";
    case "cash_day_not_opened":
      return "La journée caisse n’est pas ouverte par la trésorerie : les ventes sont bloquées.";
    default:
      return "L’enregistrement a échoué. Réessayez.";
  }
}

export function CounterSales() {
  const { user } = useAuth();
  const [sales, setSales] = useState<CounterSale[]>([]);
  const [pointsOfSale, setPointsOfSale] = useState<CounterSalePointOfSale[]>([]);
  const [pointOfSaleId, setPointOfSaleId] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const [amountStr, setAmountStr] = useState("");
  const [method, setMethod] = useState<ReservationPaymentMethod>("Espèces");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [clientId, setClientId] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [cashDayToday, setCashDayToday] = useState<Awaited<ReturnType<typeof apiGetTreasuryCashDayStatus>>>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const [s, cl, pos, cd] = await Promise.all([
      apiListCounterSales({
        from: filterFrom.trim() || undefined,
        to: filterTo.trim() || undefined,
      }),
      apiListClients(),
      apiListCounterSalePoints(),
      apiGetTreasuryCashDayStatus(),
    ]);
    setCashDayToday(cd);
    setLoading(false);
    if (s === null) {
      setApiError(true);
      setSales([]);
    } else {
      setApiError(false);
      setSales(s);
    }
    if (cl !== null) setClients(cl);
    if (pos !== null && pos.length > 0) {
      setPointsOfSale(pos);
      setPointOfSaleId((cur) => {
        if (cur && pos.some((p) => p.id === cur)) return cur;
        const main = pos.find((p) => p.isMain);
        return main?.id ?? pos[0].id;
      });
    }
  }, [filterFrom, filterTo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const todayKey = useMemo(() => localDateKey(new Date()), []);

  const todayStats = useMemo(() => {
    let total = 0;
    let n = 0;
    for (const s of sales) {
      if (saleDateKey(s.createdAt) === todayKey) {
        total += s.amountCdf;
        n += 1;
      }
    }
    return { total, n };
  }, [sales, todayKey]);

  const clientsSorted = useMemo(
    () => [...clients].sort((a, b) => a.name.localeCompare(b.name, "fr")),
    [clients],
  );

  const encaissementBlocked =
    !!user &&
    !userHasPermission(user, "finance.treasury") &&
    cashDayToday !== null &&
    !cashDayToday.opened;

  const applyFilter = useCallback(() => {
    void reload();
  }, [reload]);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFormErr(null);
      const amountCdf = Math.round(Number(amountStr.replace(/\s/g, "").replace(",", ".")));
      if (!Number.isFinite(amountCdf) || amountCdf < 1) {
        setFormErr("Indiquez un montant en CDF (nombre entier ≥ 1).");
        return;
      }
      setSubmitBusy(true);
      try {
        const res = await apiCreateCounterSale({
          amountCdf,
          method,
          label: label.trim(),
          note: note.trim(),
          clientId: clientId.trim() || undefined,
          pointOfSaleId: pointOfSaleId.trim() || undefined,
        });
        if (!res.ok) {
          setFormErr(formErrorMessage(res.code));
          return;
        }
        setAmountStr("");
        setLabel("");
        setNote("");
        setClientId("");
        setMethod("Espèces");
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 2500);
        await reload();
      } finally {
        setSubmitBusy(false);
      }
    },
    [amountStr, clientId, label, method, note, pointOfSaleId, reload],
  );

  return (
    <div>
      <Breadcrumb items={[{ label: "Finance", to: "/finance" }, { label: "Vente comptoir" }]} />
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-brand-orange/30 bg-brand-orange/10 text-brand-cream">
            <ShoppingBag className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-4xl tracking-wide text-white">Vente comptoir</h1>
            <p className="mt-1 max-w-3xl text-sm text-white/45">
              Encaissements buvette, boutique ou services ponctuels en <strong className="text-white/60">CDF</strong>, sans
              réservation de bungalow. Optionnel : lier la vente à une fiche client pour le suivi.
            </p>
          </div>
        </div>
      </header>

      {encaissementBlocked ? (
        <div
          className="mb-6 rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-50/95"
          role="status"
        >
          <p className="font-semibold text-amber-100/95">Encaissements suspendus</p>
          <p className="mt-1 text-amber-100/80">
            La trésorerie n’a pas encore ouvert la journée caisse ({cashDayToday?.businessDate ?? "—"}). Aucune vente
            comptoir ne peut être enregistrée.
          </p>
        </div>
      ) : null}

      {!apiError ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="glass-panel rounded-2xl border border-white/10 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35">Aujourd’hui (liste chargée)</p>
            <p className="mt-1 font-display text-2xl text-brand-cream/90">
              {todayStats.total.toLocaleString("fr-CD")} <span className="text-lg text-white/45">FC</span>
            </p>
            <p className="mt-1 text-xs text-white/40">{todayStats.n} vente{todayStats.n !== 1 ? "s" : ""}</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,380px)_1fr]">
        <motion.div
          className="h-fit rounded-2xl border border-white/10 glass-panel p-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h2 className="font-display text-lg tracking-wide text-brand-cream/95">Nouvelle vente</h2>
          <p className="mt-1 text-xs text-white/40">Montant en francs congolais, sans décimales.</p>
          <form onSubmit={submit} className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Montant (CDF)
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                disabled={apiError || encaissementBlocked}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 font-mono text-lg text-white outline-none ring-brand-orange/40 focus:ring-2 disabled:opacity-40"
                placeholder="ex. 3500"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {QUICK_AMOUNTS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    disabled={apiError || encaissementBlocked}
                    onClick={() => setAmountStr(String(a))}
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/60 transition-colors hover:border-brand-orange/30 hover:text-brand-cream disabled:opacity-40"
                  >
                    +{a.toLocaleString("fr-CD")}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Point de vente (terrasse)
              </label>
              <select
                value={pointOfSaleId}
                onChange={(e) => setPointOfSaleId(e.target.value)}
                disabled={apiError || encaissementBlocked || pointsOfSale.length === 0}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
              >
                {pointsOfSale.length === 0 ? (
                  <option value="">Chargement…</option>
                ) : (
                  pointsOfSale.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Moyen de paiement
              </label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as ReservationPaymentMethod)}
                disabled={apiError || encaissementBlocked}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Libellé (optionnel)
              </label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={apiError || encaissementBlocked}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
                placeholder="ex. Boissons, Snack, Artisanat"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Fiche client (optionnel)
              </label>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                disabled={apiError || encaissementBlocked}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
              >
                <option value="">— Aucun —</option>
                {clientsSorted.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Note interne
              </label>
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={apiError || encaissementBlocked}
                className="w-full resize-none rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
                placeholder="Détail, ticket, remise…"
              />
            </div>
            {formErr ? (
              <p className="rounded-lg border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
                {formErr}
              </p>
            ) : null}
            <AnimatePresence>
              {savedFlash ? (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-xs text-emerald-300/90"
                >
                  Vente enregistrée.
                </motion.p>
              ) : null}
            </AnimatePresence>
            <button
              type="submit"
              disabled={apiError || encaissementBlocked || submitBusy}
              className="w-full rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange py-3 text-sm font-semibold text-white shadow-glow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitBusy ? "Enregistrement…" : "Enregistrer la vente"}
            </button>
          </form>
        </motion.div>

        <div className="min-w-0">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40">Du</label>
              <input
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                className="rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/40">Au</label>
              <input
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                className="rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
              />
            </div>
            <button
              type="button"
              onClick={() => void applyFilter()}
              className="rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/75 hover:bg-white/10 disabled:opacity-40"
            >
              Filtrer
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterFrom("");
                setFilterTo("");
              }}
              className="rounded-xl border border-white/10 px-4 py-2 text-xs text-white/45 hover:text-white/70 disabled:opacity-40"
            >
              Réinitialiser période
            </button>
          </div>

          {apiError ? (
            <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90">
              Impossible de charger les ventes. Vérifiez le serveur et votre session.
              <button type="button" onClick={() => void reload()} className="ml-2 underline">
                Réessayer
              </button>
            </p>
          ) : null}

          <div className="overflow-hidden rounded-2xl border border-white/10 glass-panel">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                <tr>
                  <th className="px-4 py-3">Date / heure</th>
                  <th className="px-4 py-3">Montant</th>
                  <th className="px-4 py-3">Paiement</th>
                  <th className="px-4 py-3">Libellé</th>
                  <th className="px-4 py-3">Caisse / terrasse</th>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Caissier</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-white/45">
                      Chargement…
                    </td>
                  </tr>
                ) : sales.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-white/45">
                      Aucune vente pour cette période.
                    </td>
                  </tr>
                ) : (
                  sales.map((s) => (
                    <tr key={s.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 whitespace-nowrap text-white/55">
                        {s.createdAt.includes("T") ? s.createdAt.replace("T", " ").slice(0, 19) : s.createdAt}
                      </td>
                      <td className="px-4 py-3 font-mono font-medium text-brand-cream/90">
                        {s.amountCdf.toLocaleString("fr-CD")} FC
                      </td>
                      <td className="px-4 py-3 text-white/60">{s.method}</td>
                      <td className="px-4 py-3 text-white/55">
                        {s.label || "—"}
                        {s.note ? (
                          <span className="mt-0.5 block text-[11px] text-white/35">{s.note}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-white/50">{s.pointOfSaleLabel ?? "—"}</td>
                      <td className="px-4 py-3 text-white/55">
                        {s.clientId ? (
                          <Link to={`/clients/${s.clientId}`} className="text-brand-orange/90 hover:underline">
                            {s.clientName ?? s.clientId}
                          </Link>
                        ) : (
                          <span className="text-white/30">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-white/45">{s.createdByName ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-white/30">Jusqu’à 500 lignes les plus récentes selon le filtre.</p>
        </div>
      </div>
    </div>
  );
}
