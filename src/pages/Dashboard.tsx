import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { apiUrl } from "@/lib/api";
import { reservationBungalowIds, normalizeReservationFromApi } from "@/lib/reservationBungalows";
import { reservationPaymentStatus, reservationsOpenForBilling } from "@/lib/reservationBilling";
import { reservationGrandTotal } from "@/lib/reservationPayment";
import type { Bungalow, Client, Reservation } from "@/types";
import { motion } from "framer-motion";
import { AlertTriangle, CalendarCheck, Flame, TrendingUp, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const COLORS = { Premium: "#911915", Deluxe: "#F9A825", Standard: "#FFF7D6" };

export function Dashboard() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [bungalows, setBungalows] = useState<Bungalow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);
  const [dashboardPartial, setDashboardPartial] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setApiError(false);
    setDashboardPartial(false);
    void (async () => {
      const parseJson = async <T,>(r: Response): Promise<T | null> => {
        try {
          return (await r.json()) as T;
        } catch {
          return null;
        }
      };

      const [resRes, buRes, clRes] = await Promise.all([
        fetch(apiUrl("/api/reservations"), { credentials: "include" }),
        fetch(apiUrl("/api/bungalows"), { credentials: "include" }),
        fetch(apiUrl("/api/clients"), { credentials: "include" }),
      ]);
      if (cancelled) return;
      setLoading(false);

      if (resRes.status === 401 || buRes.status === 401 || clRes.status === 401) {
        setApiError(true);
        setReservations([]);
        setBungalows([]);
        setClients([]);
        return;
      }

      let partial = false;
      let reservationsRaw: Reservation[] = [];
      if (resRes.status === 403) {
        partial = true;
      } else if (!resRes.ok) {
        setApiError(true);
        setReservations([]);
        setBungalows([]);
        setClients([]);
        return;
      } else {
        const d = await parseJson<{ reservations?: Reservation[] }>(resRes);
        reservationsRaw = d?.reservations ?? [];
      }

      let bungalowsRaw: Bungalow[] = [];
      if (buRes.status === 403) {
        partial = true;
      } else if (!buRes.ok) {
        setApiError(true);
        setReservations([]);
        setBungalows([]);
        setClients([]);
        return;
      } else {
        const d = await parseJson<{ bungalows?: Bungalow[] }>(buRes);
        bungalowsRaw = d?.bungalows ?? [];
      }

      let clientsRaw: Client[] = [];
      if (clRes.status === 403) {
        partial = true;
      } else if (!clRes.ok) {
        setApiError(true);
        setReservations([]);
        setBungalows([]);
        setClients([]);
        return;
      } else {
        clientsRaw = (await parseJson<{ clients?: Client[] }>(clRes))?.clients ?? [];
      }

      setDashboardPartial(partial);
      const norm = reservationsRaw.map((r) =>
        normalizeReservationFromApi({
          ...r,
          amountPaid: r.amountPaid ?? 0,
          latePenaltyUsd: r.latePenaltyUsd ?? 0,
        }),
      );
      setReservations(norm);
      setBungalows(bungalowsRaw);
      setClients(clientsRaw);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const occByCat = useMemo(
    () =>
      ["Premium", "Deluxe", "Standard"].map((cat) => {
        const total = bungalows.filter((b) => b.category === cat).length;
        const booked = new Set(
          reservations
            .filter((r) => r.status !== "Terminé" && r.status !== "No-show")
            .flatMap((r) => reservationBungalowIds(r)),
        );
        const inCat = bungalows.filter((b) => b.category === cat);
        const occ = inCat.filter((b) => booked.has(b.id)).length;
        return { name: cat, taux: total ? Math.round((occ / total) * 100) : 0, res: occ, total };
      }),
    [bungalows, reservations],
  );

  const revenueWeek = useMemo(
    () =>
      reservations
        .filter((r) => r.status === "En cours" || r.status === "Confirmé")
        .reduce((s, r) => s + reservationGrandTotal(r.amount, r.latePenaltyUsd ?? 0), 0),
    [reservations],
  );

  const bookedIds = useMemo(
    () =>
      new Set(
        reservations
          .filter((r) => r.status !== "Terminé" && r.status !== "No-show")
          .flatMap((r) => reservationBungalowIds(r)),
      ),
    [reservations],
  );

  const globalOccPct = useMemo(
    () => (bungalows.length ? Math.round((bookedIds.size / bungalows.length) * 100) : 0),
    [bookedIds.size, bungalows.length],
  );

  const pieData = useMemo(() => occByCat.map((o) => ({ name: o.name, value: o.res || 0.1 })), [occByCat]);

  const activeReservationsCount = useMemo(
    () => reservations.filter((r) => r.status !== "Terminé" && r.status !== "No-show").length,
    [reservations],
  );

  const openBillingCount = useMemo(() => reservationsOpenForBilling(reservations), [reservations]);

  const alerts = useMemo(() => {
    const out: { text: string; type: "info" | "warn" }[] = [];
    const unpaid = reservations.filter(
      (r) =>
        reservationPaymentStatus(r) !== "Payé" &&
        reservationGrandTotal(r.amount, r.latePenaltyUsd ?? 0) > 0,
    );
    for (const r of unpaid.slice(0, 3)) {
      out.push({
        type: "warn",
        text: `Encaissement : réservation ${r.start} → ${r.end} (${reservationPaymentStatus(r).toLowerCase()}).`,
      });
    }
    for (const b of bungalows.filter((x) => x.status === "Maintenance")) {
      out.push({ type: "warn", text: `${b.code} en maintenance.` });
      break;
    }
    if (out.length === 0) {
      out.push({
        type: "info",
        text: "Aucune alerte encaissement ou maintenance à signaler.",
      });
    }
    return out;
  }, [reservations, bungalows]);

  return (
    <div>
      <Breadcrumb items={[{ label: "Tableau de bord" }]} />

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
            Tableau <span className="text-gradient-fire">de bord</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm text-white/50">
            Synthèse d’occupation et encaissements à partir des réservations en base SQLite.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-white/55">
          <Flame className="h-4 w-4 text-brand-orange" />
          CHRIST-FIRE SARLU · exploitation bungalows
        </div>
      </header>

      {apiError ? (
        <p
          className="mb-6 rounded-xl border border-brand-orange/30 bg-brand-orange/10 px-4 py-3 text-sm text-brand-cream/95"
          role="alert"
        >
          Impossible de charger les données du tableau de bord. Vérifiez la session et que le serveur API tourne.
        </p>
      ) : null}

      {!apiError && dashboardPartial ? (
        <p className="mb-6 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-3 text-xs text-white/65">
          Certains indicateurs sont masqués : votre rôle n’inclut pas tous les droits « Hébergement » (réservations,
          bungalows, etc.). Les sections correspondantes restent disponibles si elles vous sont ouvertes.
        </p>
      ) : null}

      {loading ? (
        <p className="mb-8 text-center text-sm text-white/45">Chargement du tableau de bord…</p>
      ) : null}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Réservations actives",
            value: activeReservationsCount,
            sub: "hors terminé et no-show",
            icon: CalendarCheck,
            accent: "from-brand-red/30 to-transparent",
          },
          {
            label: "Clients en base",
            value: clients.length,
            sub: "fiches complètes",
            icon: TrendingUp,
            accent: "from-brand-orange/25 to-transparent",
          },
          {
            label: "Encours facturation",
            value: openBillingCount,
            sub: "réservations non soldées (total dû)",
            icon: Wallet,
            accent: "from-brand-red-orange/20 to-transparent",
          },
          {
            label: "Taux occupation (global)",
            value: `${globalOccPct}%`,
            sub: "bungalows avec séjour actif ou à venir",
            icon: AlertTriangle,
            accent: "from-brand-cream/15 to-transparent",
          },
        ].map((c, i) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className="glass-panel group relative overflow-hidden rounded-2xl p-5 shadow-lg"
          >
            <div
              className={`pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-gradient-to-br ${c.accent} opacity-60 blur-2xl transition-opacity group-hover:opacity-90`}
            />
            <c.icon className="mb-3 h-5 w-5 text-brand-orange/90" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">{c.label}</p>
            <p className="mt-1 font-display text-3xl text-white">{c.value}</p>
            <p className="text-xs text-white/35">{c.sub}</p>
          </motion.div>
        ))}
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-3">
        <motion.div
          className="glass-panel rounded-2xl p-5 lg:col-span-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
        >
          <h2 className="mb-4 font-display text-xl tracking-wide text-brand-cream/90">Occupation par catégorie</h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={occByCat} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="name" tick={{ fill: "rgba(255,247,214,0.5)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip
                  contentStyle={{
                    background: "rgba(15,10,8,0.95)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => [`${v} %`, "Taux"]}
                />
                <Bar dataKey="taux" radius={[8, 8, 0, 0]} maxBarSize={48}>
                  {occByCat.map((e) => (
                    <Cell key={e.name} fill={COLORS[e.name as keyof typeof COLORS]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div
          className="glass-panel rounded-2xl p-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <h2 className="mb-2 font-display text-xl tracking-wide text-brand-cream/90">Répartition séjours</h2>
          <p className="mb-4 text-xs text-white/40">Réservations actives par catégorie de bungalow</p>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={3}>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={[COLORS.Premium, COLORS.Deluxe, COLORS.Standard][i]} stroke="rgba(0,0,0,0.2)" />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "rgba(15,10,8,0.95)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 space-y-1 text-xs text-white/45">
            {occByCat.map((o) => (
              <li key={o.name} className="flex justify-between">
                <span>{o.name}</span>
                <span className="text-white/70">
                  {o.res}/{o.total} occupés
                </span>
              </li>
            ))}
          </ul>
        </motion.div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <motion.div
          className="glass-panel rounded-2xl p-5"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h2 className="mb-4 font-display text-xl tracking-wide text-brand-cream/90">Revenus (séjours en cours / confirmés)</h2>
          <p className="font-display text-4xl text-gradient-fire">{revenueWeek.toLocaleString("fr-FR")} $</p>
          <p className="mt-2 text-xs text-white/40">
            Total dû (séjour + pénalité éventuelle) pour les séjours confirmés ou en cours — taxes et extras à intégrer en atelier.
          </p>
        </motion.div>

        <motion.div
          className="glass-panel rounded-2xl p-5"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <h2 className="mb-4 font-display text-xl tracking-wide text-brand-cream/90">Alertes</h2>
          <ul className="space-y-3">
            {alerts.map((a, i) => (
              <li
                key={i}
                className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 text-sm ${
                  a.type === "warn"
                    ? "border-brand-orange/25 bg-brand-orange/5 text-brand-cream/90"
                    : "border-white/10 bg-white/[0.03] text-white/75"
                }`}
              >
                <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${a.type === "warn" ? "text-brand-orange" : "text-white/40"}`} />
                {a.text}
              </li>
            ))}
          </ul>
        </motion.div>
      </div>
    </div>
  );
}
