import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { visitorEntryAdultUsdSeed, visitorEntryMinorUsdSeed } from "@/data/mock";
import {
  apiDeleteClient,
  apiGetClient,
  apiGetVisitorEntryPaymentsForClient,
  apiGetVisitorEntryPrice,
  apiListBungalows,
  apiListClientProfileTypes,
  apiListReservations,
  apiUpdateClient,
  type UpdateClientInput,
} from "@/lib/api";
import { reservationToBillingRow } from "@/lib/reservationBilling";
import {
  normalizeReservationFromApi,
  reservationBungalowIds,
  reservationIsGroup,
} from "@/lib/reservationBungalows";
import { visitorFamilyGroupEntryUsd } from "@/lib/visitorEntryPricing";
import { visitorVisitShortLabel } from "@/lib/visitorVisitDisplay";
import { visitorEntryFeeOpenInvoice, visitorLedgerRowsToInvoices } from "@/lib/visitorBilling";
import { reservationGrandTotal } from "@/lib/reservationPayment";
import {
  clientProfileHint,
  clientProfileLabel,
  displayClientEmail,
  isProfileEmailOptional,
  isSentinelClientEmail,
  profileAppliesEntryFee,
  profileBadgeClass,
  suggestedEntryFeeUsdString,
} from "@/lib/clientProfile";
import type {
  Bungalow,
  Client,
  ClientProfileType,
  Invoice,
  PaymentStatus,
  Reservation,
  VisitorEntryPaymentLedgerRow,
  VisitorVisitKind,
} from "@/types";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CalendarPlus,
  Mail,
  Pencil,
  Phone,
  StickyNote,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

function clientActionErrorMessage(code: string): string {
  switch (code) {
    case "email_taken":
      return "Cet e-mail est déjà utilisé par un autre client.";
    case "has_reservations":
      return "Impossible de supprimer : ce client a des réservations en base. Traitez ou supprimez les séjours associés d’abord.";
    case "has_visitor_ledger":
      return "Impossible de supprimer : des encaissements droit d’entrée visiteur sont enregistrés pour ce client.";
    case "not_found":
      return "Client introuvable.";
    case "validation_error":
      return "Vérifiez les champs (nom, e-mail, droit d’entrée $ pour les profils visiteurs…).";
    case "unauthorized":
      return "Session expirée. Reconnectez-vous.";
    case "network_error":
      return "Réseau indisponible.";
    default:
      return "L’opération a échoué. Réessayez.";
  }
}

const payStyles: Record<PaymentStatus, string> = {
  "En attente": "border-amber-400/30 bg-amber-500/10 text-amber-100",
  Partiel: "border-brand-orange/35 bg-brand-orange/10 text-brand-cream",
  Payé: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
  Remboursé: "border-white/20 bg-white/5 text-white/60",
};

export function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const baseId = useId();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [edName, setEdName] = useState("");
  const [edEmail, setEdEmail] = useState("");
  const [edPhone, setEdPhone] = useState("");
  const [edNotes, setEdNotes] = useState("");
  const [edProfile, setEdProfile] = useState("hebergement");
  const [edEntryFeeUsd, setEdEntryFeeUsd] = useState("");
  const [edVisitKind, setEdVisitKind] = useState<"" | VisitorVisitKind>("");
  const [edAdults, setEdAdults] = useState("");
  const [edMinors, setEdMinors] = useState("");
  const [visitorAdultUsd, setVisitorAdultUsd] = useState(visitorEntryAdultUsdSeed);
  const [visitorMinorUsd, setVisitorMinorUsd] = useState(visitorEntryMinorUsdSeed);
  const [profileTypes, setProfileTypes] = useState<ClientProfileType[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [apiReservations, setApiReservations] = useState<Reservation[]>([]);
  const [apiBungalows, setApiBungalows] = useState<Bungalow[]>([]);
  const [staysLoading, setStaysLoading] = useState(false);
  const [visitorLedgerPayments, setVisitorLedgerPayments] = useState<VisitorEntryPaymentLedgerRow[]>([]);

  useEffect(() => {
    if (!id) {
      setClient(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setClient(null);
    void apiGetClient(id).then((c) => {
      if (cancelled) return;
      setClient(
        c
          ? {
              ...c,
              entryFeeUsd: c.entryFeeUsd ?? 0,
              entryFeePaidUsd: c.entryFeePaidUsd ?? 0,
            }
          : null,
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [rows, ve] = await Promise.all([apiListClientProfileTypes(), apiGetVisitorEntryPrice()]);
      if (cancelled) return;
      if (ve) {
        setVisitorAdultUsd(ve.adultPriceUsd);
        setVisitorMinorUsd(ve.minorPriceUsd);
      }
      if (rows !== null && rows.length > 0) setProfileTypes(rows);
      else setProfileTypes([]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!editOpen) return;
    if (!profileAppliesEntryFee(edProfile, profileTypes)) return;
    if (edVisitKind !== "group" && edVisitKind !== "family") return;
    const ad = edAdults.trim() === "" ? 0 : Number.parseInt(edAdults.trim(), 10);
    const mi = edMinors.trim() === "" ? 0 : Number.parseInt(edMinors.trim(), 10);
    if (!Number.isFinite(ad) || !Number.isFinite(mi) || ad < 0 || mi < 0 || ad + mi < 1) return;
    setEdEntryFeeUsd(String(visitorFamilyGroupEntryUsd(ad, mi, visitorAdultUsd, visitorMinorUsd)));
  }, [editOpen, edProfile, edVisitKind, edAdults, edMinors, profileTypes, visitorAdultUsd, visitorMinorUsd]);

  useEffect(() => {
    if (!id) {
      setApiReservations([]);
      setApiBungalows([]);
      setStaysLoading(false);
      return;
    }
    let cancelled = false;
    setStaysLoading(true);
    void (async () => {
      const [res, bu] = await Promise.all([apiListReservations(), apiListBungalows()]);
      if (cancelled) return;
      setStaysLoading(false);
      if (res === null || bu === null) {
        setApiReservations([]);
        setApiBungalows([]);
        return;
      }
      setApiReservations(
        res.map((r) =>
          normalizeReservationFromApi({
            ...r,
            amountPaid: r.amountPaid ?? 0,
            latePenaltyUsd: r.latePenaltyUsd ?? 0,
          }),
        ),
      );
      setApiBungalows(bu);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!id || !client) {
      setVisitorLedgerPayments([]);
      return;
    }
    let cancelled = false;
    void apiGetVisitorEntryPaymentsForClient(id).then((rows) => {
      if (cancelled) return;
      setVisitorLedgerPayments(rows ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [id, client?.id, client?.entryFeePaidUsd, client?.entryFeeUsd, client?.updatedAt]);

  const openEdit = useCallback(() => {
    if (!client) return;
    setEditErr(null);
    setEdName(client.name);
    setEdEmail(isSentinelClientEmail(client.email) ? "" : client.email);
    setEdPhone(client.phone);
    setEdNotes(client.notes);
    const code = client.clientProfile ?? "hebergement";
    setEdProfile(code);
    if (profileAppliesEntryFee(code, profileTypes)) {
      const stored = client.entryFeeUsd ?? 0;
      setEdEntryFeeUsd(stored >= 1 ? String(stored) : suggestedEntryFeeUsdString(code, profileTypes, visitorAdultUsd));
      const k = client.visitorVisitKind;
      if (k === "individual" || k === "group" || k === "family") {
        setEdVisitKind(k);
        if (k === "group" || k === "family") {
          setEdAdults(String(client.visitorAdultsCount ?? ""));
          setEdMinors(String(client.visitorMinorsCount ?? ""));
        } else {
          setEdAdults("");
          setEdMinors("");
        }
      } else {
        const p = client.visitorPartyCount;
        if (p != null && p >= 1) {
          setEdVisitKind("group");
          setEdAdults(String(p));
          setEdMinors("0");
        } else {
          setEdVisitKind("");
          setEdAdults("");
          setEdMinors("");
        }
      }
    } else {
      setEdEntryFeeUsd("");
      setEdVisitKind("");
      setEdAdults("");
      setEdMinors("");
    }
    setEditOpen(true);
  }, [client, profileTypes, visitorAdultUsd]);

  const submitEdit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!client) return;
      setEditErr(null);
      const emailTrim = edEmail.trim();
      if (!isProfileEmailOptional(edProfile, profileTypes) && !emailTrim) {
        setEditErr("L’e-mail est requis pour ce profil.");
        return;
      }
      const feeParsed = edEntryFeeUsd.trim() === "" ? 0 : Number(edEntryFeeUsd);
      if (profileAppliesEntryFee(edProfile, profileTypes)) {
        if (!Number.isFinite(feeParsed) || feeParsed < 1) {
          setEditErr("Indiquez le droit d’entrée en dollars US (entier ≥ 1) pour ce profil.");
          return;
        }
        if (!edVisitKind) {
          setEditErr("Choisissez Individuel, En groupe ou En famille.");
          return;
        }
        if (edVisitKind === "group" || edVisitKind === "family") {
          const ad = edAdults.trim() === "" ? NaN : Number.parseInt(edAdults.trim(), 10);
          const mi = edMinors.trim() === "" ? NaN : Number.parseInt(edMinors.trim(), 10);
          if (!Number.isFinite(ad) || !Number.isFinite(mi) || ad < 0 || mi < 0 || ad + mi < 1) {
            setEditErr("Indiquez le nombre d’adultes et de mineurs (au moins une personne au total).");
            return;
          }
        }
      }
      setEditBusy(true);
      try {
        const payload: UpdateClientInput = {
          name: edName.trim(),
          phone: edPhone,
          notes: edNotes,
          clientProfile: edProfile,
        };
        if (!isProfileEmailOptional(edProfile, profileTypes)) {
          payload.email = emailTrim;
        } else if (emailTrim) {
          payload.email = emailTrim;
        }
        if (profileAppliesEntryFee(edProfile, profileTypes)) {
          payload.entryFeeUsd = feeParsed;
          const vk = edVisitKind;
          if (vk) payload.visitorVisitKind = vk;
          if (vk === "group" || vk === "family") {
            payload.visitorAdultsCount = Number.parseInt(edAdults.trim(), 10);
            payload.visitorMinorsCount = Number.parseInt(edMinors.trim(), 10);
          }
        }
        const res = await apiUpdateClient(client.id, payload);
        if (!res.ok) {
          setEditErr(clientActionErrorMessage(res.code));
          return;
        }
        setClient(res.client);
        setEditOpen(false);
      } finally {
        setEditBusy(false);
      }
    },
    [client, edAdults, edEmail, edEntryFeeUsd, edMinors, edName, edNotes, edPhone, edProfile, edVisitKind, profileTypes],
  );

  const confirmDelete = useCallback(async () => {
    if (!client) return;
    setDeleteErr(null);
    setDeleteBusy(true);
    try {
      const res = await apiDeleteClient(client.id);
      if (!res.ok) {
        setDeleteErr(clientActionErrorMessage(res.code));
        return;
      }
      setDeleteOpen(false);
      navigate("/clients");
    } finally {
      setDeleteBusy(false);
    }
  }, [client, navigate]);

  if (!id) {
    return (
      <div className="text-center">
        <p className="text-white/50">Client introuvable.</p>
        <Link to="/clients" className="mt-4 inline-block text-brand-orange hover:underline">
          Retour à la liste
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="py-16 text-center">
        <p className="text-white/45">Chargement de la fiche…</p>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="text-center">
        <p className="text-white/50">Client introuvable.</p>
        <Link to="/clients" className="mt-4 inline-block text-brand-orange hover:underline">
          Retour à la liste
        </Link>
      </div>
    );
  }

  const clientProfileCode = client.clientProfile ?? "hebergement";
  const clientReservations = apiReservations.filter((r) => r.clientId === client.id);
  const visitorFromLedger = visitorLedgerRowsToInvoices(visitorLedgerPayments);
  const visitorOpenRow = profileAppliesEntryFee(clientProfileCode, profileTypes)
    ? visitorEntryFeeOpenInvoice(client)
    : null;
  const stayInvoiceRows = clientReservations.map(reservationToBillingRow);
  const clientInvoices: Invoice[] = [...visitorFromLedger, ...(visitorOpenRow ? [visitorOpenRow] : []), ...stayInvoiceRows].sort(
    (a, b) => b.issuedAt.localeCompare(a.issuedAt) || a.id.localeCompare(b.id),
  );
  const bungalowSource = apiBungalows;
  const clientProfileTitle = clientProfileLabel(clientProfileCode, profileTypes);
  const clientProfileHintText = clientProfileHint(clientProfileCode, profileTypes);

  return (
    <div>
      <Breadcrumb items={[{ label: "Clients", to: "/clients" }, { label: client.name }]} />
      <Link
        to="/clients"
        className="mb-6 inline-flex items-center gap-2 text-sm text-white/50 transition-colors hover:text-brand-cream"
      >
        <ArrowLeft className="h-4 w-4" />
        Liste des clients
      </Link>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-10">
        <motion.div
          className="min-w-0 overflow-hidden rounded-2xl border border-white/10 glass-panel p-6 sm:p-8"
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4 sm:gap-5">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-brand-cream/90 sm:h-[4.5rem] sm:w-[4.5rem]">
                <User className="h-8 w-8 sm:h-9 sm:w-9" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 gap-y-2">
                  <h1 className="font-display text-3xl tracking-wide text-white sm:text-4xl lg:text-5xl">{client.name}</h1>
                  <span
                    className={`inline-flex shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${profileBadgeClass(clientProfileCode)}`}
                  >
                    {clientProfileTitle}
                  </span>
                </div>
                <p className="mt-1.5 text-xs font-mono text-white/35 sm:text-sm">ID {client.id}</p>
                {client.createdAt || client.updatedAt ? (
                  <p className="mt-2 text-[11px] text-white/38">
                    {client.createdAt ? (
                      <>
                        Créé le{" "}
                        {new Date(client.createdAt).toLocaleString("fr-FR", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </>
                    ) : null}
                    {client.createdAt && client.updatedAt && client.updatedAt !== client.createdAt ? (
                      <span className="text-white/25"> · </span>
                    ) : null}
                    {client.updatedAt && (!client.createdAt || client.updatedAt !== client.createdAt) ? (
                      <>
                        Dernière modification{" "}
                        {new Date(client.updatedAt).toLocaleString("fr-FR", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </>
                    ) : null}
                  </p>
                ) : null}
                <p className="mt-2 max-w-xl text-xs leading-relaxed text-white/40">{clientProfileHintText}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={openEdit}
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-brand-cream/90 transition-colors hover:border-brand-orange/35 hover:bg-white/10"
              >
                <Pencil className="h-4 w-4" aria-hidden />
                Modifier
              </button>
              <button
                type="button"
                onClick={() => {
                  setDeleteErr(null);
                  setDeleteOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-brand-red/30 bg-brand-red/10 px-4 py-2.5 text-sm font-medium text-brand-cream/90 transition-colors hover:bg-brand-red/20"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Supprimer
              </button>
              <Link
                to={`/reservations?nouveau=1&clientId=${encodeURIComponent(client.id)}`}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-orange/40 bg-brand-orange/15 px-4 py-2.5 text-sm font-medium text-brand-cream/95 transition-colors hover:bg-brand-orange/25"
              >
                <CalendarPlus className="h-4 w-4" aria-hidden />
                Nouvelle réservation
              </Link>
            </div>
          </div>

          <div className="mt-8 space-y-5 text-base sm:text-[1.05rem]">
            <div className="flex items-start gap-3 sm:gap-4">
              <Mail className="mt-1 h-5 w-5 shrink-0 text-white/35" aria-hidden />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35 sm:text-[11px]">E-mail</p>
                <p className="mt-1">
                  {isSentinelClientEmail(client.email) ? (
                    <span className="text-white/40">{displayClientEmail(client.email)}</span>
                  ) : (
                    <a href={`mailto:${client.email}`} className="text-brand-cream/90 underline-offset-2 hover:underline">
                      {client.email}
                    </a>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 sm:gap-4">
              <Phone className="mt-1 h-5 w-5 shrink-0 text-white/35" aria-hidden />
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35 sm:text-[11px]">Téléphone</p>
                <p className="mt-1">
                  {client.phone.trim() ? (
                    <a
                      href={`tel:${client.phone.replace(/\s/g, "")}`}
                      className="text-white/80 underline-offset-2 hover:text-brand-cream hover:underline"
                    >
                      {client.phone}
                    </a>
                  ) : (
                    <span className="text-white/35">—</span>
                  )}
                </p>
              </div>
            </div>
            {profileAppliesEntryFee(clientProfileCode, profileTypes) ? (
              <div className="flex items-start gap-3 sm:gap-4">
                <Banknote className="mt-1 h-5 w-5 shrink-0 text-white/35" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35 sm:text-[11px]">
                    Droit d’entrée
                  </p>
                  <p className="mt-1 font-medium tabular-nums text-brand-cream/90">
                    {(client.entryFeeUsd ?? 0).toLocaleString("fr-FR")} $ (dû)
                  </p>
                  {visitorVisitShortLabel(client) ? (
                    <p className="mt-0.5 text-xs text-white/45">{visitorVisitShortLabel(client)}</p>
                  ) : null}
                  <p className="mt-0.5 text-xs tabular-nums text-white/50">
                    Encaissé : {(client.entryFeePaidUsd ?? 0).toLocaleString("fr-FR")} $ · reste :{" "}
                    {Math.max(0, Math.floor(client.entryFeeUsd ?? 0) - Math.floor(client.entryFeePaidUsd ?? 0)).toLocaleString("fr-FR")}{" "}
                    $
                  </p>
                  {visitorEntryFeeOpenInvoice(client) ? (
                    <Link
                      to={`/caisse-reception?client=${encodeURIComponent(client.id)}`}
                      className="mt-2 inline-block text-xs font-medium text-sky-300/90 underline-offset-2 hover:underline"
                    >
                      Encaisser le droit d’entrée
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-8 rounded-xl border border-white/10 bg-black/20 p-4 sm:p-5">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-white/40 sm:text-[11px]">
              <StickyNote className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              Notes internes
            </div>
            {client.notes.trim() ? (
              <p className="text-sm leading-relaxed text-white/65 sm:text-base sm:leading-relaxed">{client.notes}</p>
            ) : (
              <p className="text-sm text-white/35 sm:text-base">Aucune note pour ce client.</p>
            )}
          </div>
        </motion.div>

        <motion.div
          className="flex w-fit max-w-full shrink-0 flex-col gap-2 sm:flex-row sm:gap-2 lg:flex-col lg:justify-self-end"
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <div className="glass-panel w-[6.75rem] rounded-lg border border-white/10 px-2.5 py-2 sm:w-[7rem]">
            <p className="text-[9px] font-semibold uppercase leading-tight tracking-wider text-white/35">Réservations</p>
            <p className="mt-0.5 font-display text-lg tabular-nums leading-none text-brand-cream/90">
              {staysLoading ? "…" : clientReservations.length}
            </p>
          </div>
          <div className="glass-panel w-[6.75rem] rounded-lg border border-white/10 px-2.5 py-2 sm:w-[7rem]">
            <p className="text-[9px] font-semibold uppercase leading-tight tracking-wider text-white/35">Factures</p>
            <p className="mt-0.5 font-display text-lg tabular-nums leading-none text-brand-cream/90">
              {staysLoading ? "…" : clientInvoices.length}
            </p>
          </div>
        </motion.div>
      </div>

      <section className="mt-12">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-display text-2xl text-brand-cream/90">Séjours</h2>
          <Link
            to={`/reservations?nouveau=1&clientId=${encodeURIComponent(client.id)}`}
            className="inline-flex w-fit items-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-medium text-brand-cream/90 transition-colors hover:border-brand-orange/35 hover:bg-white/10"
          >
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
            Ajouter un séjour
          </Link>
        </div>
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 bg-white/[0.03] text-[10px] font-semibold uppercase tracking-wider text-white/40">
              <tr>
                <th className="px-4 py-3">Période</th>
                <th className="px-4 py-3">Bungalow</th>
                <th className="px-4 py-3 text-center">Pers.</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3 text-right">Montant</th>
              </tr>
            </thead>
            <tbody>
              {staysLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-white/40">
                    Chargement des séjours…
                  </td>
                </tr>
              ) : clientReservations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-white/40">
                    Aucune réservation pour ce client.
                  </td>
                </tr>
              ) : (
                clientReservations.map((r) => {
                  const ids = reservationBungalowIds(r);
                  const total = reservationGrandTotal(r.amount, r.latePenaltyUsd ?? 0);
                  return (
                    <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 text-white/80">
                        {r.start} → {r.end}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          {ids.map((bid) => {
                            const bb = bungalowSource.find((x) => x.id === bid);
                            return bb ? (
                              <Link
                                key={bid}
                                to={`/bungalows/${bb.id}`}
                                className="text-brand-orange/90 underline-offset-2 hover:underline"
                              >
                                {bb.code} — {bb.label}
                              </Link>
                            ) : (
                              <span key={bid} className="text-white/45">
                                {bid}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums text-white/70">
                        {reservationIsGroup(r)
                          ? Math.max(2, Math.min(99, Math.floor(Number(r.guestCount ?? 2))))
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-white/55">{r.status}</td>
                      <td className="px-4 py-3 text-right text-brand-cream/90">{total.toLocaleString("fr-FR")} $</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <AnimatePresence>
        {editOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
            role="presentation"
            onClick={() => {
              if (!editBusy) setEditOpen(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`${baseId}-edit-client-title`}
              className="glass-panel max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <h2 id={`${baseId}-edit-client-title`} className="font-display text-lg tracking-wide text-brand-cream/95">
                  Modifier le client
                </h2>
                <button
                  type="button"
                  disabled={editBusy}
                  onClick={() => setEditOpen(false)}
                  className="rounded-lg p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {editErr ? (
                <p className="mb-3 rounded-lg border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
                  {editErr}
                </p>
              ) : null}
              <form onSubmit={submitEdit} className="space-y-3">
                <div>
                  <label htmlFor={`${baseId}-ed-cl-profile`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                    Profil
                  </label>
                  <select
                    id={`${baseId}-ed-cl-profile`}
                    value={edProfile}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEdProfile(v);
                      if (profileAppliesEntryFee(v, profileTypes)) {
                        setEdEntryFeeUsd(suggestedEntryFeeUsdString(v, profileTypes, visitorAdultUsd) || "1");
                        setEdVisitKind("");
                        setEdAdults("");
                        setEdMinors("");
                      } else {
                        setEdEntryFeeUsd("");
                        setEdVisitKind("");
                        setEdAdults("");
                        setEdMinors("");
                      }
                    }}
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                  >
                    {profileTypes.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-white/35">{clientProfileHint(edProfile, profileTypes)}</p>
                </div>
                {profileAppliesEntryFee(edProfile, profileTypes) ? (
                  <div className="space-y-3 rounded-xl border border-white/10 bg-black/15 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-white/45">Composition du passage</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {(
                        [
                          ["individual", "Individuel"],
                          ["group", "En groupe"],
                          ["family", "En famille"],
                        ] as const
                      ).map(([code, label]) => (
                        <button
                          key={code}
                          type="button"
                          onClick={() => {
                            setEdVisitKind(code);
                            if (code === "individual") {
                              setEdAdults("");
                              setEdMinors("");
                              setEdEntryFeeUsd(String(Math.max(1, visitorAdultUsd)));
                            }
                          }}
                          className={`rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors ${
                            edVisitKind === code
                              ? "border-sky-400/50 bg-sky-500/15 text-sky-100"
                              : "border-white/15 bg-black/25 text-white/65 hover:border-white/25 hover:bg-white/[0.06]"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {(edVisitKind === "group" || edVisitKind === "family") && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor={`${baseId}-ed-adults`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                            Adultes
                          </label>
                          <input
                            id={`${baseId}-ed-adults`}
                            type="number"
                            min={0}
                            max={999}
                            step={1}
                            value={edAdults}
                            onChange={(e) => setEdAdults(e.target.value)}
                            className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                          />
                        </div>
                        <div>
                          <label htmlFor={`${baseId}-ed-minors`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                            Mineurs
                          </label>
                          <input
                            id={`${baseId}-ed-minors`}
                            type="number"
                            min={0}
                            max={999}
                            step={1}
                            value={edMinors}
                            onChange={(e) => setEdMinors(e.target.value)}
                            className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                          />
                        </div>
                      </div>
                    )}
                    <div>
                      <label htmlFor={`${baseId}-ed-cl-entry`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                        Droit d’entrée ($)
                      </label>
                      <input
                        id={`${baseId}-ed-cl-entry`}
                        type="number"
                        min={1}
                        step={1}
                        required
                        value={edEntryFeeUsd}
                        onChange={(e) => setEdEntryFeeUsd(e.target.value)}
                        className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                        placeholder="Total dû pour la fiche"
                      />
                      <p className="mt-1 text-[10px] leading-relaxed text-white/35">
                        Montant total à encaisser pour cette fiche (individu, groupe ou famille).
                      </p>
                    </div>
                  </div>
                ) : null}
                <div>
                  <label htmlFor={`${baseId}-ed-cl-name`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                    {profileAppliesEntryFee(edProfile, profileTypes)
                      ? edVisitKind === "individual"
                        ? "Nom"
                        : edVisitKind === "group" || edVisitKind === "family"
                          ? "Nom du responsable"
                          : "Nom complet"
                      : "Nom complet"}
                  </label>
                  <input
                    id={`${baseId}-ed-cl-name`}
                    required
                    value={edName}
                    onChange={(e) => setEdName(e.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                  />
                </div>
                <div>
                  <label htmlFor={`${baseId}-ed-cl-email`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                    E-mail{isProfileEmailOptional(edProfile, profileTypes) ? " (facultatif)" : ""}
                    {profileAppliesEntryFee(edProfile, profileTypes) && (edVisitKind === "group" || edVisitKind === "family")
                      ? " — responsable"
                      : ""}
                  </label>
                  <input
                    id={`${baseId}-ed-cl-email`}
                    type="email"
                    required={!isProfileEmailOptional(edProfile, profileTypes)}
                    value={edEmail}
                    onChange={(e) => setEdEmail(e.target.value)}
                    placeholder={
                      isProfileEmailOptional(edProfile, profileTypes) ? "Laisser vide si inconnu" : ""
                    }
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                  />
                </div>
                <div>
                  <label htmlFor={`${baseId}-ed-cl-phone`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                    Téléphone
                    {profileAppliesEntryFee(edProfile, profileTypes) && (edVisitKind === "group" || edVisitKind === "family")
                      ? " — responsable"
                      : ""}
                  </label>
                  <input
                    id={`${baseId}-ed-cl-phone`}
                    value={edPhone}
                    onChange={(e) => setEdPhone(e.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                  />
                </div>
                <div>
                  <label htmlFor={`${baseId}-ed-cl-notes`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                    Notes internes
                  </label>
                  <textarea
                    id={`${baseId}-ed-cl-notes`}
                    rows={3}
                    value={edNotes}
                    onChange={(e) => setEdNotes(e.target.value)}
                    className="w-full resize-none rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={editBusy}
                    onClick={() => setEditOpen(false)}
                    className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 disabled:opacity-40"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={editBusy}
                    className="rounded-lg border border-brand-orange/40 bg-brand-orange/20 px-4 py-2 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-orange/30 disabled:opacity-40"
                  >
                    {editBusy ? "Enregistrement…" : "Enregistrer"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
            role="presentation"
            onClick={() => {
              if (!deleteBusy) setDeleteOpen(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={`${baseId}-del-client-title`}
              aria-describedby={`${baseId}-del-client-desc`}
              className="glass-panel w-full max-w-md rounded-2xl border border-brand-red/30 bg-black/50 p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex gap-3">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-orange/35 bg-brand-red/20"
                  aria-hidden
                >
                  <AlertTriangle className="h-5 w-5 text-brand-orange" />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <h2 id={`${baseId}-del-client-title`} className="font-display text-lg tracking-wide text-brand-cream/95">
                    Supprimer ce client&nbsp;?
                  </h2>
                  <p id={`${baseId}-del-client-desc`} className="mt-2 text-sm leading-relaxed text-white/55">
                    Suppression <strong className="font-medium text-brand-cream/85">définitive</strong> du client{" "}
                    <span className="font-medium text-brand-cream/90">« {client.name} »</span> (effacement SQL, pas de
                    corbeille ni récupération).
                    <span className="mt-2 block text-white/40">
                      Bloqué s’il existe des réservations ou des lignes de paiement droit d’entrée visiteur.
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  disabled={deleteBusy}
                  onClick={() => setDeleteOpen(false)}
                  className="h-9 shrink-0 rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {deleteErr ? (
                <p className="mb-4 rounded-lg border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-xs text-brand-cream/95" role="alert">
                  {deleteErr}
                </p>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={deleteBusy}
                  onClick={() => setDeleteOpen(false)}
                  className="rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-white/85 hover:bg-white/[0.1] disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={deleteBusy}
                  onClick={() => void confirmDelete()}
                  className="rounded-xl border border-brand-red/45 bg-gradient-to-r from-brand-red to-brand-red-orange px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-white shadow-glow-sm hover:opacity-95 disabled:opacity-50"
                >
                  {deleteBusy ? "Suppression…" : "Supprimer"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="mt-12">
        <h2 className="mb-4 font-display text-2xl text-brand-cream/90">Facturation</h2>
        <div className="overflow-hidden rounded-2xl border border-white/10 glass-panel">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
              <tr>
                <th className="px-4 py-3">N° facture</th>
                <th className="px-4 py-3">Nature</th>
                <th className="px-4 py-3">Émission</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Paiement</th>
              </tr>
            </thead>
            <tbody>
              {staysLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-white/40">
                    Chargement…
                  </td>
                </tr>
              ) : clientInvoices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-white/40">
                    Aucune facture pour ce client.
                  </td>
                </tr>
              ) : (
                clientInvoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-4 font-mono text-xs text-brand-orange/90">{inv.number}</td>
                    <td className="px-4 py-4 text-xs text-white/50">{inv.lineLabel ?? "—"}</td>
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
