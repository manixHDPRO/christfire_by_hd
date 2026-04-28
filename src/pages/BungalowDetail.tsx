import { useAuth } from "@/auth/AuthContext";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { CategoryBadge } from "@/components/ui/CategoryBadge";
import { apiGetBungalow, apiListMaintenanceTickets, apiListReservations } from "@/lib/api";
import { reservationBungalowIds } from "@/lib/reservationBungalows";
import { userHasPermission } from "@/lib/permissions";
import type { Bungalow, MaintenanceTicket, Reservation } from "@/types";
import { motion } from "framer-motion";
import { ArrowLeft, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

const MAINT_PRI: Record<string, string> = {
  basse: "Basse",
  normale: "Normale",
  haute: "Haute",
  urgente: "Urgente",
};
const MAINT_ST: Record<string, string> = {
  ouvert: "Ouvert",
  en_cours: "En cours",
  resolu: "Résolu",
  annule: "Annulé",
};

export function BungalowDetail() {
  const { user } = useAuth();
  const { id } = useParams();
  const bungalowsListPath = userHasPermission(user, "lodging.bungalows") ? "/bungalows" : "/menage";
  const bungalowsListLabel = userHasPermission(user, "lodging.bungalows") ? "Bungalows" : "Ménage";
  const [b, setB] = useState<Bungalow | null | undefined>(undefined);
  const [hist, setHist] = useState<Reservation[]>([]);
  const [maintTickets, setMaintTickets] = useState<MaintenanceTicket[]>([]);

  useEffect(() => {
    if (!id) {
      setB(null);
      setHist([]);
      setMaintTickets([]);
      return;
    }
    let cancelled = false;
    setB(undefined);
    setHist([]);
    setMaintTickets([]);
    void (async () => {
      const [row, resList, tickets] = await Promise.all([
        apiGetBungalow(id),
        apiListReservations(),
        apiListMaintenanceTickets({ bungalowId: id }),
      ]);
      if (cancelled) return;
      setB(row);
      if (resList === null) {
        setHist([]);
      } else {
        setHist(resList.filter((r) => reservationBungalowIds(r).includes(id)));
      }
      setMaintTickets(tickets ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (b === undefined) {
    return (
      <div className="text-center">
        <p className="text-white/50">Chargement…</p>
      </div>
    );
  }

  if (!b) {
    return (
      <div className="text-center">
        <p className="text-white/50">Bungalow introuvable.</p>
        <Link to={bungalowsListPath} className="mt-4 inline-block text-brand-orange hover:underline">
          Retour à la liste
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Breadcrumb items={[{ label: bungalowsListLabel, to: bungalowsListPath }, { label: b.code }]} />
      <Link
        to={bungalowsListPath}
        className="mb-6 inline-flex items-center gap-2 text-sm text-white/50 transition-colors hover:text-brand-cream"
      >
        <ArrowLeft className="h-4 w-4" />
        {userHasPermission(user, "lodging.bungalows") ? "Liste des bungalows" : "Retour au ménage"}
      </Link>

      <div className="grid gap-8 lg:grid-cols-2">
        <motion.div
          className="overflow-hidden rounded-2xl border border-white/10 bg-black/20"
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <div className="relative aspect-[4/3]">
            <img src={b.image} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
            <div className="absolute bottom-4 left-4 flex flex-wrap gap-2">
              <CategoryBadge category={b.category} />
              <span className="rounded-md border border-white/20 bg-black/40 px-2 py-0.5 text-xs text-white/80">{b.status}</span>
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}>
          <h1 className="font-display text-4xl tracking-wide text-white">{b.label}</h1>
          <p className="mt-1 text-lg text-brand-orange/90">{b.code}</p>
          <p className="mt-4 text-sm leading-relaxed text-white/55">{b.description}</p>
          <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
            <div className="glass-panel rounded-xl p-4">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/35">Pièces</dt>
              <dd className="mt-1 text-white">{b.rooms}</dd>
            </div>
            <div className="glass-panel rounded-xl p-4">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/35">Capacité</dt>
              <dd className="mt-1 text-white">{b.capacity} personnes</dd>
            </div>
            {b.createdAt ? (
              <div className="glass-panel rounded-xl p-4">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/35">Créé le</dt>
                <dd className="mt-1 text-white/80">
                  {new Date(b.createdAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
                </dd>
              </div>
            ) : null}
            {b.updatedAt && (!b.createdAt || b.updatedAt !== b.createdAt) ? (
              <div className="glass-panel rounded-xl p-4">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-white/35">Dernière modification</dt>
                <dd className="mt-1 text-white/80">
                  {new Date(b.updatedAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="mt-6">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">Équipements</h2>
            <ul className="flex flex-wrap gap-2">
              {b.amenities.map((a) => (
                <li key={a} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/75">
                  {a}
                </li>
              ))}
            </ul>
          </div>
        </motion.div>
      </div>

      <section className="mt-12">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-2xl text-brand-cream/90">
            <Wrench className="h-7 w-7 text-brand-orange/90" aria-hidden />
            Maintenance technique
          </h2>
          <Link
            to={`/maintenance?bungalowId=${encodeURIComponent(b.id)}`}
            className="text-sm text-brand-orange/90 hover:underline"
          >
            Voir tous les tickets de ce bungalow
          </Link>
        </div>
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 bg-white/[0.03] text-[10px] font-semibold uppercase tracking-wider text-white/40">
              <tr>
                <th className="px-4 py-3">Ticket</th>
                <th className="px-4 py-3">Priorité</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3 text-right">Mise à jour</th>
              </tr>
            </thead>
            <tbody>
              {maintTickets.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-white/40">
                    Aucun ticket de maintenance pour ce bungalow.{" "}
                    <Link to={`/maintenance?bungalowId=${encodeURIComponent(b.id)}`} className="text-brand-orange/90 hover:underline">
                      Créer un ticket
                    </Link>
                    .
                  </td>
                </tr>
              ) : (
                maintTickets.slice(0, 12).map((t) => (
                  <tr key={t.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-white/85">
                      <Link
                        to={`/maintenance?bungalowId=${encodeURIComponent(b.id)}`}
                        className="hover:text-brand-orange/90 hover:underline"
                      >
                        {t.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-white/55">{MAINT_PRI[t.priority] ?? t.priority}</td>
                    <td className="px-4 py-3 text-white/55">{MAINT_ST[t.status] ?? t.status}</td>
                    <td className="px-4 py-3 text-right text-white/45">{t.updatedAt.replace("T", " ").slice(0, 16)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {maintTickets.length > 12 && (
          <p className="mt-2 text-center text-xs text-white/40">
            Les 12 tickets les plus récents — lien ci-dessus pour la liste complète.
          </p>
        )}
      </section>

      <section className="mt-12">
        <h2 className="mb-4 font-display text-2xl text-brand-cream/90">Réservations liées</h2>
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 bg-white/[0.03] text-[10px] font-semibold uppercase tracking-wider text-white/40">
              <tr>
                <th className="px-4 py-3">Période</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3 text-right">Montant</th>
              </tr>
            </thead>
            <tbody>
              {hist.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-white/40">
                    Aucune réservation liée.
                  </td>
                </tr>
              ) : (
                hist.map((r) => (
                  <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-white/80">
                      {r.start} → {r.end}
                    </td>
                    <td className="px-4 py-3 text-white/55">{r.status}</td>
                    <td className="px-4 py-3 text-right text-brand-cream/90">{r.amount} $</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
