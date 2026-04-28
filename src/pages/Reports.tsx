import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { useCategoryLabels } from "@/contexts/CategoryLabelsContext";
import { apiGetReportsKpis } from "@/lib/api";
import type { BungalowCategory, ReportsKpisPayload } from "@/types";
import { motion } from "framer-motion";
import { Download, Flame, LineChart, PieChart } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const CAT_KEYS = new Set<BungalowCategory>(["Premium", "Deluxe", "Standard"]);

function monthStartIso(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-01`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function downloadCsv(payload: ReportsKpisPayload): void {
  const lines: string[] = [];
  lines.push("section;metric;value");
  lines.push(`period;from;${payload.period.from}`);
  lines.push(`period;to;${payload.period.to}`);
  lines.push(`global;occupancy_pct;${payload.global.occupancyPct}`);
  lines.push(`global;adr_usd;${payload.global.adrUsd ?? ""}`);
  lines.push(`global;revpar_usd;${payload.global.revparUsd ?? ""}`);
  lines.push(`global;room_revenue_usd;${payload.global.roomRevenueUsd}`);
  lines.push(`global;sold_room_nights;${payload.global.soldRoomNights}`);
  lines.push(`global;available_room_nights;${payload.global.availableRoomNights}`);
  for (const c of payload.byCategory) {
    lines.push(`category_${c.category};occupancy_pct;${c.occupancyPct}`);
    lines.push(`category_${c.category};revpar_usd;${c.revparUsd ?? ""}`);
    lines.push(`category_${c.category};room_revenue_usd;${c.roomRevenueUsd}`);
  }
  for (const ch of payload.byChannel) {
    lines.push(`channel_${ch.channel};revenue_usd;${ch.roomRevenueUsd}`);
    lines.push(`channel_${ch.channel};sold_nights;${ch.soldRoomNights}`);
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rapports-christfire-${payload.period.from}_${payload.period.to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function Reports() {
  const { labelFor } = useCategoryLabels();
  const [from, setFrom] = useState(monthStartIso);
  const [to, setTo] = useState(todayIso);
  const [data, setData] = useState<ReportsKpisPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const d = await apiGetReportsKpis(from, to);
    if (d === null) {
      setError(true);
      setData(null);
    } else {
      setData(d);
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const channelChartData = useMemo(
    () => (data ? data.byChannel.map((c) => ({ name: c.channelLabel, revenue: c.roomRevenueUsd })) : []),
    [data],
  );

  const categoryLabel = useCallback(
    (key: string) => (CAT_KEYS.has(key as BungalowCategory) ? labelFor(key as BungalowCategory) : key),
    [labelFor],
  );

  return (
    <div>
      <Breadcrumb items={[{ label: "Finance", to: "/finance" }, { label: "Rapports et pilotage" }]} />

      <header className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <motion.p
            className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-brand-orange/90"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
          >
            HD by ChristFire
          </motion.p>
          <h1 className="font-display text-4xl tracking-wide text-white md:text-5xl">
            Rapports <span className="text-gradient-fire">et pilotage</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/50">
            Taux d’occupation, ADR, RevPAR, dettes clients, performance par canal et par catégorie d’unité. Complète le
            tableau de bord pour les arbitrages tarifaires et commerciaux.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-white/55">
          <Flame className="h-4 w-4 text-brand-orange" />
          KPI hébergement · USD
        </div>
      </header>

      <div className="mb-8 flex flex-wrap items-end gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <div>
          <label htmlFor="rep-from" className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/45">
            Du
          </label>
          <input
            id="rep-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
          />
        </div>
        <div>
          <label htmlFor="rep-to" className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/45">
            Au
          </label>
          <input
            id="rep-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
          />
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-xl border border-brand-orange/40 bg-brand-orange/15 px-4 py-2 text-sm font-medium text-brand-cream hover:bg-brand-orange/25 disabled:opacity-40"
        >
          Actualiser
        </button>
        {data && !loading ? (
          <button
            type="button"
            onClick={() => downloadCsv(data)}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mb-6 rounded-xl border border-brand-orange/30 bg-brand-orange/10 px-4 py-3 text-sm text-brand-cream/95" role="alert">
          Impossible de charger les indicateurs (session, droits « Rapports » ou « Réservations », ou plage de dates
          invalide — max. 366 jours).
        </p>
      ) : null}

      {loading ? <p className="text-center text-sm text-white/45">Chargement des rapports…</p> : null}

      {data && !loading ? (
        <div className="space-y-10">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs text-white/50">
            <p className="font-semibold text-white/65">Méthodologie</p>
            <p className="mt-1">{data.notes.occupancyDefinition}</p>
            <p className="mt-1">{data.notes.revenueDefinition}</p>
          </div>

          <section>
            <h2 className="mb-4 flex items-center gap-2 font-display text-xl text-white">
              <LineChart className="h-5 w-5 text-brand-orange" />
              Synthèse période
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Occupation", value: `${data.global.occupancyPct} %`, sub: "nuitées vendues / disponibles" },
                { label: "ADR", value: data.global.adrUsd != null ? `${data.global.adrUsd} $` : "—", sub: "revenu / nuitée vendue" },
                { label: "RevPAR", value: data.global.revparUsd != null ? `${data.global.revparUsd} $` : "—", sub: "revenu / nuitée disponible" },
                {
                  label: "CA hébergement",
                  value: `${data.global.roomRevenueUsd} $`,
                  sub: `${data.global.soldRoomNights} nuitées vendues · ${data.global.sellableUnits} unités exploitables`,
                },
              ].map((card) => (
                <div
                  key={card.label}
                  className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-transparent p-5"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">{card.label}</p>
                  <p className="mt-2 font-display text-2xl text-white">{card.value}</p>
                  <p className="mt-1 text-[11px] text-white/45">{card.sub}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-8 lg:grid-cols-2">
            <div>
              <h2 className="mb-4 flex items-center gap-2 font-display text-xl text-white">
                <PieChart className="h-5 w-5 text-brand-orange" />
                Par catégorie d’unité
              </h2>
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-white/45">
                      <th className="px-4 py-3">Catégorie</th>
                      <th className="px-4 py-3">Occup.</th>
                      <th className="px-4 py-3">ADR</th>
                      <th className="px-4 py-3">RevPAR</th>
                      <th className="px-4 py-3">CA $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byCategory.map((row) => (
                      <tr key={row.category} className="border-b border-white/5 text-white/85">
                        <td className="px-4 py-3 font-medium">{categoryLabel(row.category)}</td>
                        <td className="px-4 py-3">{row.occupancyPct} %</td>
                        <td className="px-4 py-3">{row.adrUsd != null ? `${row.adrUsd} $` : "—"}</td>
                        <td className="px-4 py-3">{row.revparUsd != null ? `${row.revparUsd} $` : "—"}</td>
                        <td className="px-4 py-3">{row.roomRevenueUsd} $</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h2 className="mb-4 font-display text-xl text-white">Par canal de réservation</h2>
              {channelChartData.length > 0 ? (
                <div className="h-64 rounded-xl border border-white/10 bg-white/[0.02] p-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={channelChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                      <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} />
                      <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          background: "rgba(0,0,0,0.85)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          borderRadius: 8,
                        }}
                        labelStyle={{ color: "rgba(255,255,255,0.85)" }}
                      />
                      <Bar dataKey="revenue" fill="#F9A825" radius={[6, 6, 0, 0]} name="CA $ " />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-white/45">Aucune donnée canal sur cette période.</p>
              )}
              <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
                <table className="w-full min-w-[400px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-white/45">
                      <th className="px-4 py-3">Canal</th>
                      <th className="px-4 py-3">Réserv.</th>
                      <th className="px-4 py-3">Nuitées</th>
                      <th className="px-4 py-3">CA $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byChannel.map((row) => (
                      <tr key={row.channel} className="border-b border-white/5 text-white/85">
                        <td className="px-4 py-3">{row.channelLabel}</td>
                        <td className="px-4 py-3">{row.reservationCount}</td>
                        <td className="px-4 py-3">{row.soldRoomNights}</td>
                        <td className="px-4 py-3">{row.roomRevenueUsd} $</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-4 font-display text-xl text-white">Dettes clients (réservations)</h2>
            <div className="mb-3 flex flex-wrap items-baseline gap-4 text-sm">
              <span className="text-white/60">
                Total créances :{" "}
                <strong className="text-brand-cream">{data.debts.totalOutstandingUsd} $</strong> ·{" "}
                {data.debts.reservationCount} réservation(s)
              </span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-white/45">
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Séjour</th>
                    <th className="px-4 py-3">Unités</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3">Dû</th>
                    <th className="px-4 py-3">Payé</th>
                    <th className="px-4 py-3">Solde</th>
                  </tr>
                </thead>
                <tbody>
                  {data.debts.rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-white/45">
                        Aucune créance ouverte sur les réservations.
                      </td>
                    </tr>
                  ) : (
                    data.debts.rows.map((row) => (
                      <tr key={row.reservationId} className="border-b border-white/5 text-white/85">
                        <td className="px-4 py-3">{row.clientName}</td>
                        <td className="px-4 py-3 text-xs">
                          {row.stayStart} → {row.stayEnd}
                        </td>
                        <td className="px-4 py-3 text-xs text-white/60">{row.bungalowCodes}</td>
                        <td className="px-4 py-3 text-xs">{row.status}</td>
                        <td className="px-4 py-3">{row.totalDueUsd} $</td>
                        <td className="px-4 py-3">{row.amountPaidUsd} $</td>
                        <td className="px-4 py-3 font-medium text-amber-200/90">{row.balanceUsd} $</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="mb-4 font-display text-xl text-white">Prévisionnel & rythme</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Réservé à J+30</p>
                <p className="mt-2 text-2xl font-semibold text-white">{data.forecast.onTheBooksNext30Days.occupancyPct} %</p>
                <p className="mt-1 text-xs text-white/50">
                  {data.forecast.onTheBooksNext30Days.soldRoomNights} nuitées vendues /{" "}
                  {data.forecast.onTheBooksNext30Days.availableRoomNights} disponibles (
                  {data.forecast.onTheBooksNext30Days.from} → {data.forecast.onTheBooksNext30Days.to})
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/45">30 jours glissants précédents</p>
                <p className="mt-2 text-2xl font-semibold text-white">{data.forecast.trailing30Days.occupancyPct} % occupation</p>
                <p className="mt-1 text-xs text-white/50">
                  ADR {data.forecast.trailing30Days.adrUsd != null ? `${data.forecast.trailing30Days.adrUsd} $` : "—"} · RevPAR{" "}
                  {data.forecast.trailing30Days.revparUsd != null ? `${data.forecast.trailing30Days.revparUsd} $` : "—"} · CA{" "}
                  {data.forecast.trailing30Days.roomRevenueUsd} $
                </p>
                <p className="mt-1 text-[11px] text-white/40">
                  {data.forecast.trailing30Days.from} → {data.forecast.trailing30Days.to}
                </p>
              </div>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-white/50">{data.forecast.indicativeCommentFr}</p>
          </section>
        </div>
      ) : null}
    </div>
  );
}
