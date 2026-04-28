import { Breadcrumb } from "@/components/layout/Breadcrumb";
import {
  apiListOperationalWorkflowItems,
  apiPatchOperationalWorkflow,
  type PatchOperationalWorkflowInput,
} from "@/lib/api";
import { LEGAL_COUNTRY_OPTIONS, legalDocumentsForCountry } from "@/lib/legalDocumentsByCountry";
import type { OperationalWorkflow, OperationalWorkflowListItem, ReservationStatus } from "@/types";
import { motion } from "framer-motion";
import {
  ClipboardCheck,
  FileSignature,
  KeyRound,
  Landmark,
  Luggage,
  MapPin,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

function formatShortDate(iso: string): string {
  try {
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return iso;
    return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function statusBadgeClass(s: ReservationStatus): string {
  switch (s) {
    case "Confirmé":
      return "border-sky-400/40 bg-sky-500/15 text-sky-100";
    case "En cours":
      return "border-emerald-400/40 bg-emerald-500/15 text-emerald-100";
    case "Terminé":
      return "border-white/20 bg-white/5 text-white/70";
    default:
      return "border-white/15 bg-white/5 text-white/55";
  }
}

function arrivalProgress(w: OperationalWorkflow, docs: { id: string }[]): {
  done: number;
  total: number;
  legalComplete: boolean;
} {
  const legalComplete = docs.length > 0 && docs.every((d) => w.legalAckDocIds.includes(d.id));
  const steps = [
    Boolean(w.idDocumentVerifiedAt),
    w.depositAmountUsd <= 0 || Boolean(w.depositReceivedAt),
    Boolean(w.arrivalSignatureAt),
    w.arrivalInventoryOk && w.arrivalInventoryNote.trim().length > 0,
    legalComplete,
  ];
  const done = steps.filter(Boolean).length;
  return { done, total: steps.length, legalComplete };
}

export function AccueilSejour() {
  const [searchParams, setSearchParams] = useSearchParams();
  const reservationParam = searchParams.get("reservation") ?? "";

  const [items, setItems] = useState<OperationalWorkflowListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [filter, setFilter] = useState<"tous" | "arrivee" | "sejour" | "depart">("tous");

  const refresh = useCallback(async () => {
    setLoading(true);
    setApiError(false);
    const list = await apiListOperationalWorkflowItems();
    setLoading(false);
    if (list === null) {
      setApiError(true);
      setItems([]);
      return;
    }
    setItems(list);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!reservationParam) return;
    setSelectedId(reservationParam);
  }, [reservationParam]);

  const selected = useMemo(
    () => items.find((i) => i.reservationId === selectedId) ?? null,
    [items, selectedId],
  );

  const docsForCountry = useMemo(
    () => legalDocumentsForCountry(selected?.workflow.legalCountryCode ?? "CD"),
    [selected?.workflow.legalCountryCode],
  );

  const progress = useMemo(() => {
    if (!selected) return null;
    return arrivalProgress(selected.workflow, docsForCountry);
  }, [selected, docsForCountry]);

  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (filter === "tous") return true;
      if (filter === "arrivee")
        return it.status === "Confirmé" && !it.workflow.checkInCompletedAt;
      if (filter === "sejour") return it.status === "En cours";
      if (filter === "depart")
        return (
          (it.status === "En cours" || it.status === "Terminé") &&
          Boolean(it.workflow.checkInCompletedAt) &&
          !it.workflow.checkOutCompletedAt
        );
      return true;
    });
  }, [items, filter]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const applyPatch = useCallback(
    async (reservationId: string, body: PatchOperationalWorkflowInput): Promise<boolean> => {
      setSaving(true);
      const res = await apiPatchOperationalWorkflow(reservationId, body);
      setSaving(false);
      if (!res.ok) {
        showToast("Enregistrement impossible — vérifiez la connexion ou les droits.");
        return false;
      }
      setItems((prev) =>
        prev.map((row) =>
          row.reservationId === reservationId
            ? {
                ...row,
                workflow: res.workflow,
                hasPersistedWorkflow: res.hasPersistedWorkflow,
                status: res.reservation.status,
              }
            : row,
        ),
      );
      return true;
    },
    [showToast],
  );

  const selectReservation = useCallback(
    (id: string) => {
      setSelectedId(id);
      setSearchParams(id ? { reservation: id } : {});
    },
    [setSearchParams],
  );

  const nowStamp = () => new Date().toISOString();

  return (
    <div className="min-h-full bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950 text-white">
      <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
        <Breadcrumb items={[{ label: "Accueil séjour & formalités" }]} />

        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-display text-3xl tracking-wide text-brand-cream md:text-4xl">
              Accueil séjour
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-white/60">
              Workflow opérationnel : arrivée (identité, caution, signature, état des lieux), départ
              (extras, clés) et dossier légal selon le pays — en complément du statut réservation.
            </p>
          </div>
          <Link
            to="/reservations"
            className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-white/85 transition hover:border-brand-orange/40 hover:bg-brand-red/20"
          >
            Voir le planning réservations
          </Link>
        </header>

        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 rounded-xl border border-emerald-400/35 bg-emerald-500/15 px-4 py-2 text-sm text-emerald-100"
            role="status"
          >
            {toast}
          </motion.div>
        )}

        {apiError && (
          <p className="mb-4 text-sm text-red-200/90">
            Impossible de charger les séjours. Réessayez ou vérifiez l’API.
          </p>
        )}

        <div className="mb-4 flex flex-wrap gap-2">
          {(
            [
              ["tous", "Tous"],
              ["arrivee", "Arrivée à finaliser"],
              ["sejour", "En séjour"],
              ["depart", "Départ / check-out"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                filter === key
                  ? "bg-brand-red text-white shadow-glow-sm"
                  : "border border-white/15 bg-white/5 text-white/70 hover:border-brand-orange/35"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
          <aside className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-md">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-cream">
              <Luggage className="h-4 w-4 text-brand-orange" />
              Séjours éligibles
            </h2>
            {loading ? (
              <p className="text-sm text-white/45">Chargement…</p>
            ) : filteredItems.length === 0 ? (
              <p className="text-sm text-white/45">Aucun séjour dans ce filtre.</p>
            ) : (
              <ul className="max-h-[min(70vh,560px)] space-y-2 overflow-auto pr-1">
                {filteredItems.map((it) => {
                  const active = it.reservationId === selectedId;
                  const p = arrivalProgress(it.workflow, legalDocumentsForCountry(it.workflow.legalCountryCode));
                  return (
                    <li key={it.reservationId}>
                      <button
                        type="button"
                        onClick={() => selectReservation(it.reservationId)}
                        className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                          active
                            ? "border-brand-orange/50 bg-brand-red/25 shadow-glow-sm"
                            : "border-white/10 bg-white/[0.03] hover:border-brand-orange/30"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium text-white/90">{it.clientName}</span>
                          <span
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${statusBadgeClass(it.status)}`}
                          >
                            {it.status}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-xs text-white/50">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          {it.bungalowCodes || "—"}
                        </div>
                        <div className="mt-1 text-[11px] text-white/40">
                          {formatShortDate(it.start)} → {formatShortDate(it.end)}
                          {!it.workflow.checkInCompletedAt && (
                            <span className="ml-2 text-brand-cream/80">
                              Accueil {p.done}/{p.total}
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <section className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-md md:p-6">
            {!selected ? (
              <p className="text-sm text-white/50">
                Sélectionnez un séjour à gauche pour renseigner le check-in / check-out opérationnel.
              </p>
            ) : (
              <div className="space-y-8">
                <div className="flex flex-col gap-2 border-b border-white/10 pb-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="text-xl font-semibold text-white">{selected.clientName}</h2>
                    <p className="mt-1 text-sm text-white/55">
                      {selected.bungalowCodes} · {formatShortDate(selected.start)} →{" "}
                      {formatShortDate(selected.end)}
                    </p>
                    <p className="mt-1 text-xs text-white/40">
                      {selected.hasPersistedWorkflow
                        ? `Dernière mise à jour : ${formatDateTime(selected.workflow.updatedAt || null)}`
                        : "Dossier pas encore enregistré — les actions créeront la fiche."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      to={`/clients/${encodeURIComponent(selected.clientId)}`}
                      className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:border-brand-orange/35"
                    >
                      Fiche client
                    </Link>
                    <Link
                      to="/reservations"
                      className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 hover:border-brand-orange/35"
                    >
                      Réservations
                    </Link>
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-cream">
                    <ShieldCheck className="h-4 w-4 text-brand-orange" />
                    Dossier légal & pays
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block text-xs text-white/50">
                      Juridiction documents
                      <select
                        className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-brand-orange/50"
                        value={selected.workflow.legalCountryCode}
                        disabled={saving}
                        onChange={(e) =>
                          void applyPatch(selected.reservationId, { legalCountryCode: e.target.value })
                        }
                      >
                        {LEGAL_COUNTRY_OPTIONS.map((o) => (
                          <option key={o.code} value={o.code}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/55">
                      Cochez chaque document présenté ou signé. Le récapitulatif s’adapte au pays choisi
                      (indicatif métier — à valider avec votre conseil).
                    </div>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {docsForCountry.map((doc) => {
                      const checked = selected.workflow.legalAckDocIds.includes(doc.id);
                      return (
                        <li
                          key={doc.id}
                          className="flex gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2"
                        >
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded border-white/30 bg-black/40"
                            aria-label={`Document : ${doc.title}`}
                            checked={checked}
                            disabled={saving}
                            onChange={() => {
                              const next = checked
                                ? selected.workflow.legalAckDocIds.filter((x) => x !== doc.id)
                                : [...selected.workflow.legalAckDocIds, doc.id];
                              void applyPatch(selected.reservationId, { legalAckDocIds: next });
                            }}
                          />
                          <div>
                            <div className="text-sm font-medium text-white/90">{doc.title}</div>
                            <div className="text-xs text-white/45">{doc.detail}</div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={
                        saving ||
                        !progress?.legalComplete ||
                        Boolean(selected.workflow.legalDocumentsAckAt)
                      }
                      onClick={() => {
                        void (async () => {
                          const ok = await applyPatch(selected.reservationId, {
                            legalDocumentsAckAt: nowStamp(),
                          });
                          if (ok) showToast("Dossier légal marqué comme complété.");
                        })();
                      }}
                      className="rounded-xl border border-brand-orange/40 bg-brand-red/30 px-4 py-2 text-sm font-medium text-brand-cream transition hover:bg-brand-red/45 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Valider le dossier légal
                    </button>
                    {selected.workflow.legalDocumentsAckAt && (
                      <span className="text-xs text-emerald-200/90">
                        Validé le {formatDateTime(selected.workflow.legalDocumentsAckAt)}
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-cream">
                    <UserCheck className="h-4 w-4 text-brand-orange" />
                    Arrivée (check-in opérationnel)
                  </h3>
                  {progress && (
                    <p className="mb-3 text-xs text-white/45">
                      Avancement accueil : {progress.done}/{progress.total} blocs cochés côté réception.
                    </p>
                  )}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-white/90">
                        <ClipboardCheck className="h-4 w-4 text-sky-300" />
                        Pièce d’identité
                      </div>
                      <p className="mt-1 text-xs text-white/45">
                        Vérification et archivage (copie / scan selon politique).
                      </p>
                      <p className="mt-2 text-xs text-white/55">
                        {selected.workflow.idDocumentVerifiedAt
                          ? `Vérifiée le ${formatDateTime(selected.workflow.idDocumentVerifiedAt)}`
                          : "Non enregistrée"}
                      </p>
                      <button
                        type="button"
                        disabled={saving || Boolean(selected.workflow.idDocumentVerifiedAt)}
                        onClick={() =>
                          void applyPatch(selected.reservationId, { idDocumentVerifiedAt: nowStamp() })
                        }
                        className="mt-3 w-full rounded-lg border border-sky-400/35 bg-sky-500/15 px-3 py-2 text-xs font-medium text-sky-100 hover:bg-sky-500/25 disabled:opacity-40"
                      >
                        Marquer ID vérifiée
                      </button>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-white/90">
                        <Landmark className="h-4 w-4 text-amber-300" />
                        Caution / dépôt
                      </div>
                      <label className="mt-2 block text-xs text-white/50">
                        Montant (USD, entier)
                        <input
                          type="number"
                          min={0}
                          className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white"
                          value={selected.workflow.depositAmountUsd}
                          disabled={saving}
                          onChange={(e) => {
                            const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                            setItems((prev) =>
                              prev.map((row) =>
                                row.reservationId === selected.reservationId
                                  ? {
                                      ...row,
                                      workflow: { ...row.workflow, depositAmountUsd: n },
                                    }
                                  : row,
                              ),
                            );
                          }}
                                                   onBlur={(e) => {
                            const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                            void applyPatch(selected.reservationId, { depositAmountUsd: n });
                          }}
                        />
                      </label>
                      <label className="mt-2 block text-xs text-white/50">
                        Mode (espèces, carte, préautorisation…)
                        <input
                          className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white"
                          value={selected.workflow.depositMethod}
                          disabled={saving}
                          onChange={(e) => {
                            const v = e.target.value;
                            setItems((prev) =>
                              prev.map((row) =>
                                row.reservationId === selected.reservationId
                                  ? { ...row, workflow: { ...row.workflow, depositMethod: v } }
                                  : row,
                              ),
                            );
                          }}
                          onBlur={(e) =>
                            void applyPatch(selected.reservationId, { depositMethod: e.target.value })
                          }
                        />
                      </label>
                      <p className="mt-2 text-xs text-white/55">
                        {selected.workflow.depositReceivedAt
                          ? `Encaissée / bloquée le ${formatDateTime(selected.workflow.depositReceivedAt)}`
                          : selected.workflow.depositAmountUsd > 0
                            ? "En attente d’enregistrement de réception"
                            : "Aucune caution déclarée"}
                      </p>
                      <button
                        type="button"
                        disabled={
                          saving ||
                          selected.workflow.depositAmountUsd <= 0 ||
                          Boolean(selected.workflow.depositReceivedAt)
                        }
                        onClick={() =>
                          void applyPatch(selected.reservationId, { depositReceivedAt: nowStamp() })
                        }
                        className="mt-3 w-full rounded-lg border border-amber-400/35 bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-100 hover:bg-amber-500/25 disabled:opacity-40"
                      >
                        Enregistrer réception caution
                      </button>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-white/90">
                        <FileSignature className="h-4 w-4 text-rose-300" />
                        Signature arrivée
                      </div>
                      <p className="mt-1 text-xs text-white/45">
                        Bon d’accueil, conditions, état des lieux d’entrée — selon vos modèles.
                      </p>
                      <p className="mt-2 text-xs text-white/55">
                        {selected.workflow.arrivalSignatureAt
                          ? `Signé le ${formatDateTime(selected.workflow.arrivalSignatureAt)}`
                          : "Non enregistrée"}
                      </p>
                      <button
                        type="button"
                        disabled={saving || Boolean(selected.workflow.arrivalSignatureAt)}
                        onClick={() =>
                          void applyPatch(selected.reservationId, { arrivalSignatureAt: nowStamp() })
                        }
                        className="mt-3 w-full rounded-lg border border-rose-400/35 bg-rose-500/15 px-3 py-2 text-xs font-medium text-rose-100 hover:bg-rose-500/25 disabled:opacity-40"
                      >
                        Horodatage signature
                      </button>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/20 p-4 md:col-span-2">
                      <div className="text-sm font-medium text-white/90">État des lieux d’entrée</div>
                      <p className="mt-1 text-xs text-white/45">
                        Observations, anomalies, compteurs — complétez avant clôture check-in.
                      </p>
                      <textarea
                        className="mt-2 min-h-[88px] w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white"
                        aria-label="Notes état des lieux d’entrée"
                        placeholder="Observations, photos, anomalies…"
                        value={selected.workflow.arrivalInventoryNote}
                        disabled={saving}
                        onChange={(e) => {
                          const v = e.target.value;
                          setItems((prev) =>
                            prev.map((row) =>
                              row.reservationId === selected.reservationId
                                ? { ...row, workflow: { ...row.workflow, arrivalInventoryNote: v } }
                                : row,
                            ),
                          );
                        }}
                        onBlur={(e) =>
                          void applyPatch(selected.reservationId, { arrivalInventoryNote: e.target.value })
                        }
                      />
                      <label className="mt-2 flex items-center gap-2 text-xs text-white/70">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-white/30 bg-black/40"
                          aria-label="État des lieux d’entrée validé avec le client"
                          checked={selected.workflow.arrivalInventoryOk}
                          disabled={saving}
                          onChange={(e) =>
                            void applyPatch(selected.reservationId, {
                              arrivalInventoryOk: e.target.checked,
                            })
                          }
                        />
                        État des lieux d’entrée validé avec le client
                      </label>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={saving || Boolean(selected.workflow.checkInCompletedAt)}
                      onClick={() => {
                        void (async () => {
                          const ok = await applyPatch(selected.reservationId, {
                            checkInCompletedAt: nowStamp(),
                          });
                          if (ok) showToast("Check-in opérationnel clôturé (horodatage enregistré).");
                        })();
                      }}
                      className="rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-50 hover:bg-emerald-500/30 disabled:opacity-40"
                    >
                      Clôturer check-in opérationnel
                    </button>
                    {selected.workflow.checkInCompletedAt && (
                      <span className="text-xs text-emerald-200/90">
                        Fait le {formatDateTime(selected.workflow.checkInCompletedAt)}
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-cream">
                    <KeyRound className="h-4 w-4 text-brand-orange" />
                    Départ (check-out opérationnel)
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4 md:col-span-2">
                      <div className="text-sm font-medium text-white/90">Extras & consommations</div>
                      <p className="mt-1 text-xs text-white/45">
                        Bar, blanchisserie, dommages, dépassements — note libre + montant si facturé.
                      </p>
                      <textarea
                        className="mt-2 min-h-[72px] w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white"
                        aria-label="Notes extras et consommations au départ"
                        placeholder="Détail des extras, consommations, dommages…"
                        value={selected.workflow.departureExtrasNote}
                        disabled={saving}
                        onChange={(e) => {
                          const v = e.target.value;
                          setItems((prev) =>
                            prev.map((row) =>
                              row.reservationId === selected.reservationId
                                ? { ...row, workflow: { ...row.workflow, departureExtrasNote: v } }
                                : row,
                            ),
                          );
                        }}
                        onBlur={(e) =>
                          void applyPatch(selected.reservationId, { departureExtrasNote: e.target.value })
                        }
                      />
                      <label className="mt-2 block text-xs text-white/50">
                        Montant extras (USD)
                        <input
                          type="number"
                          min={0}
                          className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white"
                          value={selected.workflow.departureExtrasAmountUsd}
                          disabled={saving}
                          onChange={(e) => {
                            const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                            setItems((prev) =>
                              prev.map((row) =>
                                row.reservationId === selected.reservationId
                                  ? {
                                      ...row,
                                      workflow: { ...row.workflow, departureExtrasAmountUsd: n },
                                    }
                                  : row,
                              ),
                            );
                          }}
                          onBlur={(e) => {
                            const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                            void applyPatch(selected.reservationId, { departureExtrasAmountUsd: n });
                          }}
                        />
                      </label>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-white/90">
                        <KeyRound className="h-4 w-4 text-violet-300" />
                        Remise des clés / badges
                      </div>
                      <label className="mt-2 block text-xs text-white/50">
                        Note (emplacement boîte, double…)
                        <input
                          className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white"
                          value={selected.workflow.keysNote}
                          disabled={saving}
                          onChange={(e) => {
                            const v = e.target.value;
                            setItems((prev) =>
                              prev.map((row) =>
                                row.reservationId === selected.reservationId
                                  ? { ...row, workflow: { ...row.workflow, keysNote: v } }
                                  : row,
                              ),
                            );
                          }}
                          onBlur={(e) =>
                            void applyPatch(selected.reservationId, { keysNote: e.target.value })
                          }
                        />
                      </label>
                      <label className="mt-3 flex items-center gap-2 text-xs text-white/70">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-white/30 bg-black/40"
                          aria-label="Clés ou badges récupérés"
                          checked={selected.workflow.keysReturned}
                          disabled={saving}
                          onChange={(e) =>
                            void applyPatch(selected.reservationId, { keysReturned: e.target.checked })
                          }
                        />
                        Clés / badges récupérés
                      </label>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={saving || Boolean(selected.workflow.checkOutCompletedAt)}
                      onClick={() => {
                        void (async () => {
                          const ok = await applyPatch(selected.reservationId, {
                            checkOutCompletedAt: nowStamp(),
                          });
                          if (ok) showToast("Check-out opérationnel clôturé.");
                        })();
                      }}
                      className="rounded-xl border border-violet-400/40 bg-violet-500/20 px-4 py-2 text-sm font-medium text-violet-50 hover:bg-violet-500/30 disabled:opacity-40"
                    >
                      Clôturer check-out opérationnel
                    </button>
                    {selected.workflow.checkOutCompletedAt && (
                      <span className="text-xs text-violet-200/90">
                        Fait le {formatDateTime(selected.workflow.checkOutCompletedAt)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
