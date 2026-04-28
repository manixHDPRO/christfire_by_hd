import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { CategoryBadge } from "@/components/ui/CategoryBadge";
import { apiListBungalows, apiUpdateBungalow } from "@/lib/api";
import type { Bungalow, BungalowCategory, HousekeepingStatus } from "@/types";
import { motion } from "framer-motion";
import { Filter, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const HK_ALL = "Tous" as const;
const HK_STATUSES: HousekeepingStatus[] = ["Propre", "À nettoyer", "En cours", "Contrôlé"];
const HK_FILTERS: (HousekeepingStatus | typeof HK_ALL)[] = [HK_ALL, ...HK_STATUSES];

const cats: (BungalowCategory | "Tous")[] = ["Tous", "Premium", "Deluxe", "Standard"];

function hkBadgeClass(s: HousekeepingStatus): string {
  switch (s) {
    case "Propre":
      return "border-emerald-400/35 bg-emerald-500/15 text-emerald-100";
    case "À nettoyer":
      return "border-amber-400/40 bg-amber-500/20 text-amber-100";
    case "En cours":
      return "border-sky-400/35 bg-sky-500/15 text-sky-100";
    case "Contrôlé":
      return "border-violet-400/35 bg-violet-500/15 text-violet-100";
  }
}

function opsBadgeClass(status: Bungalow["status"]): string {
  switch (status) {
    case "Disponible":
      return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
    case "Réservé":
      return "border-violet-400/35 bg-violet-500/15 text-violet-100";
    case "Occupé":
      return "border-sky-400/35 bg-sky-500/15 text-sky-100";
    case "Maintenance":
      return "border-brand-orange/35 bg-brand-orange/10 text-brand-cream";
    case "Hors service":
      return "border-white/20 bg-white/5 text-white/55";
    default:
      return "border-white/20 bg-white/5 text-white/55";
  }
}

export function Housekeeping() {
  const [rows, setRows] = useState<Bungalow[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const b = await apiListBungalows();
    if (b === null) {
      setApiError(true);
      setRows([]);
    } else {
      setApiError(false);
      setRows(b);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const [hkFilter, setHkFilter] = useState<(typeof HK_FILTERS)[number]>(HK_ALL);
  const [cat, setCat] = useState<(typeof cats)[number]>("Tous");
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const c: Record<HousekeepingStatus, number> = {
      Propre: 0,
      "À nettoyer": 0,
      "En cours": 0,
      Contrôlé: 0,
    };
    for (const b of rows) {
      const s = b.housekeepingStatus ?? "Propre";
      if (s in c) c[s] += 1;
    }
    return c;
  }, [rows]);

  const list = useMemo(() => {
    return rows.filter((b) => {
      const hk = b.housekeepingStatus ?? "Propre";
      const okHk = hkFilter === HK_ALL || hk === hkFilter;
      const okCat = cat === "Tous" || b.category === cat;
      const s = q.trim().toLowerCase();
      const okQ =
        !s ||
        b.code.toLowerCase().includes(s) ||
        b.label.toLowerCase().includes(s) ||
        b.description.toLowerCase().includes(s);
      return okHk && okCat && okQ;
    });
  }, [cat, hkFilter, q, rows]);

  const applyHousekeeping = useCallback(async (b: Bungalow, status: HousekeepingStatus) => {
    setSavingId(b.id);
    setToast(null);
    const res = await apiUpdateBungalow(b.id, { housekeepingStatus: status });
    setSavingId(null);
    if (res.ok) {
      setRows((prev) => prev.map((x) => (x.id === b.id ? res.bungalow : x)));
      setToast(`${b.code} : ${status}`);
    } else {
      setToast("Échec de la mise à jour — réessayez.");
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <div>
      <Breadcrumb items={[{ label: "Ménage & chambres" }]} />
      <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-3 font-display text-4xl tracking-wide text-white">
            <Sparkles className="h-9 w-9 shrink-0 text-brand-cream/90" aria-hidden />
            Ménage
          </h1>
          <p className="mt-2 text-sm text-white/45">
            État des chambres (nettoyage, contrôle). Passage en « À nettoyer » automatique quand un séjour est clôturé (
            <span className="text-white/55">Terminé</span>).
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Code, nom…"
              disabled={loading || apiError}
              className="w-full rounded-xl border border-white/10 bg-black/30 py-2.5 pl-10 pr-4 text-sm text-white outline-none ring-brand-orange/40 placeholder:text-white/30 focus:border-brand-orange/35 focus:ring-2 sm:w-56 disabled:opacity-40"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/25 p-1">
            <Filter className="ml-2 h-4 w-4 shrink-0 text-white/35" />
            {HK_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setHkFilter(f)}
                disabled={loading || apiError}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                  hkFilter === f ? "bg-brand-red/50 text-white" : "text-white/45 hover:text-white/75"
                } disabled:opacity-40`}
              >
                {f === HK_ALL ? f : `${f} (${counts[f]})`}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 p-1">
            {cats.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                disabled={loading || apiError}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                  cat === c ? "bg-brand-red/50 text-white" : "text-white/45 hover:text-white/75"
                } disabled:opacity-40`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </header>

      {toast && (
        <p
          className="mb-4 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80"
          role="status"
        >
          {toast}
        </p>
      )}

      {apiError && (
        <p className="mb-6 rounded-xl border border-brand-orange/30 bg-brand-orange/10 px-4 py-3 text-sm text-brand-cream/95" role="alert">
          Impossible de charger les bungalows. Vérifiez l’API et la session.
        </p>
      )}

      {loading ? (
        <p className="py-16 text-center text-white/45">Chargement…</p>
      ) : (
        <>
          <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((b, i) => {
              const hk = b.housekeepingStatus ?? "Propre";
              return (
                <motion.li
                  key={b.id}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className={`glass-panel flex h-full flex-col overflow-hidden rounded-2xl ${
                    b.category === "Premium"
                      ? "ring-1 ring-brand-red/25"
                      : b.category === "Deluxe"
                        ? "ring-1 ring-brand-orange/20"
                        : "ring-1 ring-white/10"
                  }`}
                >
                  <div className="relative aspect-[16/10] overflow-hidden">
                    <img src={b.image} alt="" className="h-full w-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />
                    <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                      <CategoryBadge category={b.category} />
                      <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase ${opsBadgeClass(b.status)}`}>
                        {b.status}
                      </span>
                      <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase ${hkBadgeClass(hk)}`}>
                        {hk}
                      </span>
                    </div>
                    <p className="absolute bottom-3 left-3 font-display text-2xl tracking-wide text-white">{b.code}</p>
                  </div>
                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <div>
                      <h2 className="text-lg font-semibold text-white/95">{b.label}</h2>
                      <p className="mt-1 line-clamp-2 text-sm text-white/45">{b.description}</p>
                    </div>
                    <label className="text-[11px] font-medium uppercase tracking-wide text-white/35">
                      État ménage
                      <select
                        value={hk}
                        disabled={savingId === b.id}
                        onChange={(e) => void applyHousekeeping(b, e.target.value as HousekeepingStatus)}
                        className="mt-1.5 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2.5 text-sm text-white outline-none focus:border-brand-orange/40 focus:ring-2 focus:ring-brand-orange/30 disabled:opacity-50"
                      >
                        {HK_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Link
                      to={`/bungalows/${b.id}`}
                      className="text-center text-xs font-medium text-brand-cream/80 underline-offset-2 hover:text-white hover:underline"
                    >
                      Fiche bungalow
                    </Link>
                  </div>
                </motion.li>
              );
            })}
          </ul>
          {list.length === 0 && (
            <p className="py-16 text-center text-white/40">Aucun logement ne correspond aux filtres.</p>
          )}
        </>
      )}
    </div>
  );
}
