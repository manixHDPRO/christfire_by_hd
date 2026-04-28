import { useAuth } from "@/auth/AuthContext";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import {
  apiCreatePayment,
  apiGetExchangeRate,
  apiGetReceptionCashRegisterSituation,
  apiGetTreasuryCashDayStatus,
  apiListBungalows,
  apiListClients,
  apiListReservations,
  apiPostVisitorEntryFeePayment,
  apiSubmitReceptionRegisterReport,
} from "@/lib/api";
import { nominalPresetForResteUsd, nominalToUsdFloor } from "@/lib/paymentConversion";
import { userHasPermission } from "@/lib/permissions";
import {
  normalizeReservationFromApi,
  reservationBungalowIds,
  reservationIsGroup,
} from "@/lib/reservationBungalows";
import { DEPOSIT_MIN_FRACTION, reservationGrandTotal } from "@/lib/reservationPayment";
import { visitorVisitShortLabel } from "@/lib/visitorVisitDisplay";
import type {
  Bungalow,
  Client,
  PaymentCurrencyCode,
  ReceptionCashRegisterSituation,
  Reservation,
  ReservationPaymentMethod,
  ReservationStatus,
} from "@/types";
import { motion } from "framer-motion";
import { ArrowRight, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

const METHODS: ReservationPaymentMethod[] = ["Espèces", "Carte", "Virement", "Autre"];

function isPayableReservationStatus(status: ReservationStatus): boolean {
  return status === "En attente paiement" || status === "En cours";
}

function statusBadgeClass(status: ReservationStatus): string {
  switch (status) {
    case "En attente paiement":
      return "border-violet-500/35 bg-violet-500/10 text-violet-100/90";
    case "Confirmé":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100/95";
    case "En cours":
      return "border-sky-500/30 bg-sky-500/10 text-sky-100/95";
    case "Terminé":
      return "border-white/15 bg-white/5 text-white/55";
    case "No-show":
      return "border-amber-500/35 bg-amber-500/10 text-amber-100/90";
    default:
      return "border-white/10 bg-white/5 text-white/60";
  }
}

function paymentErrorMessage(code: string): string {
  switch (code) {
    case "unknown_reservation":
      return "Réservation introuvable.";
    case "validation_error":
      return "Montant ou données invalides.";
    case "cdf_amount_too_small":
      return "En francs congolais, le montant saisi est trop faible pour créditer au moins 1 $ sur le solde (arrondi à l’unité). Augmentez le montant ou payez en dollars.";
    case "amount_exceeds_balance":
      return "Le montant dépasse le reste à payer pour cette réservation.";
    case "unauthorized":
      return "Session expirée. Reconnectez-vous.";
    case "network_error":
      return "Réseau indisponible.";
    case "cash_day_not_opened":
      return "La journée caisse n’est pas ouverte par la trésorerie : l’encaissement est bloqué.";
    default:
      return "L’enregistrement a échoué. Réessayez.";
  }
}

function receptionClosureSituationErrorMessage(code: string): string {
  switch (code) {
    case "cash_day_not_opened":
      return "La journée caisse n’est pas ouverte pour cette date — impossible d’afficher la situation. Attendez l’ouverture trésorerie ou choisissez une autre date.";
    case "unauthorized":
      return "Session expirée. Reconnectez-vous.";
    case "network_error":
      return "Réseau indisponible.";
    default:
      return "Impossible de charger la situation journalière. Réessayez.";
  }
}

function receptionReportErrorMessage(code: string): string {
  switch (code) {
    case "report_already_validated":
      return "Ce jour est déjà validé en trésorerie : contactez la trésorerie en cas d’erreur.";
    case "validation_error":
      return "Vérifiez les montants (entiers ≥ 0) et la date.";
    case "unauthorized":
      return "Session expirée. Reconnectez-vous.";
    case "forbidden":
      return "Droits insuffisants.";
    case "forbidden_point_of_sale":
      return "Cette caisse ne vous est pas assignée.";
    case "no_point_of_sale_assignment":
      return "Aucune caisse ne vous est assignée. Contactez l’administrateur.";
    case "network_error":
      return "Réseau indisponible.";
    case "cash_day_not_opened":
      return "La trésorerie n’a pas ouvert cette journée caisse : le rapport ne peut pas être enregistré.";
    default:
      return "L’enregistrement a échoué. Réessayez.";
  }
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function visitorPaymentErrorMessage(code: string): string {
  switch (code) {
    case "not_found":
      return "Client introuvable.";
    case "not_visitor_profile":
      return "Ce client n’a pas de profil avec droit d’entrée visiteur.";
    case "no_entry_fee":
      return "Aucun montant de droit d’entrée n’est défini sur la fiche.";
    case "already_paid":
      return "Le droit d’entrée est déjà entièrement encaissé.";
    case "cdf_amount_too_small":
      return "En francs congolais, le montant saisi est trop faible pour créditer au moins 1 $ sur le droit d’entrée. Augmentez le montant ou payez en dollars.";
    case "amount_exceeds_balance":
      return "Après conversion, le montant dépasse le reste à payer (solde tenu en dollars).";
    case "validation_error":
      return "Montant ou données invalides.";
    case "unauthorized":
      return "Session expirée. Reconnectez-vous.";
    case "network_error":
      return "Réseau indisponible.";
    case "cash_day_not_opened":
      return "La journée caisse n’est pas ouverte : encaissement du droit d’entrée bloqué.";
    default:
      return "L’enregistrement a échoué. Réessayez.";
  }
}

export type PaymentsVariant = "finance" | "reception";

export function Payments({ variant = "finance" }: { variant?: PaymentsVariant }) {
  const { user } = useAuth();
  const isReception = variant === "reception";
  const canSubmitReceptionReport =
    userHasPermission(user, "finance.treasury") ||
    userHasPermission(user, "lodging.reception_cash") ||
    userHasPermission(user, "lodging.stay_reception") ||
    userHasPermission(user, "finance.payments");
  const [searchParams, setSearchParams] = useSearchParams();
  const presetReservationId = searchParams.get("reservation") ?? "";
  const presetClientId = searchParams.get("client") ?? "";

  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(false);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [clientsLk, setClientsLk] = useState<Client[]>([]);
  const [bungalowsLk, setBungalowsLk] = useState<Bungalow[]>([]);

  const [selReservationId, setSelReservationId] = useState("");
  const [amountField, setAmountField] = useState("");
  const [selVisitorClientId, setSelVisitorClientId] = useState("");
  const [visAmountField, setVisAmountField] = useState("");
  const [method, setMethod] = useState<ReservationPaymentMethod>("Espèces");
  const [note, setNote] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);
  const [visSubmitBusy, setVisSubmitBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [visFormErr, setVisFormErr] = useState<string | null>(null);
  /** Taux affiché / validation client (aligné sur Paramètres ; défaut si l’API échoue). */
  const [cdfPerUsd, setCdfPerUsd] = useState(2850);
  const [reservationPayCurrency, setReservationPayCurrency] = useState<PaymentCurrencyCode>("USD");
  const [visitorPayCurrency, setVisitorPayCurrency] = useState<PaymentCurrencyCode>("USD");

  const [recOpeningStr, setRecOpeningStr] = useState("0");
  const [recCountedStr, setRecCountedStr] = useState("");
  const [recNotesCashier, setRecNotesCashier] = useState("");
  const [recSubmitBusy, setRecSubmitBusy] = useState(false);
  const [recFormErr, setRecFormErr] = useState<string | null>(null);
  const [recSavedFlash, setRecSavedFlash] = useState(false);
  const [recClosureSituation, setRecClosureSituation] = useState<ReceptionCashRegisterSituation | null>(null);
  const [recClosureSituationLoading, setRecClosureSituationLoading] = useState(false);
  const [recClosureSituationErr, setRecClosureSituationErr] = useState<string | null>(null);
  const [recClosureSituationAck, setRecClosureSituationAck] = useState(false);
  const [recSituationRefreshKey, setRecSituationRefreshKey] = useState(0);

  const [cashDayToday, setCashDayToday] = useState<Awaited<ReturnType<typeof apiGetTreasuryCashDayStatus>>>(null);
  const [cashDayForReport, setCashDayForReport] = useState<Awaited<ReturnType<typeof apiGetTreasuryCashDayStatus>>>(null);

  /** Journée d’exploitation alignée sur le serveur ; non modifiable par l’utilisateur. */
  const recReportDate = useMemo(() => {
    const bd = cashDayToday?.businessDate?.trim();
    if (bd && /^\d{4}-\d{2}-\d{2}$/.test(bd)) return bd;
    return localDateKey(new Date());
  }, [cashDayToday?.businessDate]);

  const receptionMainTab: "encaissements" | "cloture" =
    isReception && canSubmitReceptionReport && searchParams.get("tab") === "cloture" ? "cloture" : "encaissements";

  const setReceptionMainTab = useCallback(
    (tab: "encaissements" | "cloture") => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          if (tab === "cloture") n.set("tab", "cloture");
          else n.delete("tab");
          return n;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clients = clientsLk;
  const bungalows = bungalowsLk;

  const payableReservations = useMemo(
    () =>
      [...reservations]
        .filter((r) => isPayableReservationStatus(r.status))
        .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)),
    [reservations],
  );

  const payableVisitorClients = useMemo(
    () =>
      [...clients]
        .filter((c) => {
          const due = Math.floor(c.entryFeeUsd ?? 0);
          const paid = Math.floor(c.entryFeePaidUsd ?? 0);
          return due >= 1 && paid < due;
        })
        .sort((a, b) => a.name.localeCompare(b.name, "fr")),
    [clients],
  );

  const reload = useCallback(async () => {
    setFormErr(null);
    setVisFormErr(null);
    setLoading(true);
    const [res, cl, bu, xr] = await Promise.all([
      apiListReservations(),
      apiListClients(),
      apiListBungalows(),
      apiGetExchangeRate(),
    ]);
    if (xr?.cdfPerUsd != null && Number.isFinite(xr.cdfPerUsd) && xr.cdfPerUsd >= 1) {
      setCdfPerUsd(Math.floor(xr.cdfPerUsd));
    }
    if (res === null || cl === null || bu === null) {
      setApiError(true);
      setReservations([]);
      setClientsLk([]);
      setBungalowsLk([]);
    } else {
      setApiError(false);
      setReservations(
        res.map((r) =>
          normalizeReservationFromApi({
            ...r,
            amountPaid: r.amountPaid ?? 0,
            latePenaltyUsd: r.latePenaltyUsd ?? 0,
          }),
        ),
      );
      setClientsLk(
        cl.map((c) => ({
          ...c,
          entryFeePaidUsd: c.entryFeePaidUsd ?? 0,
        })),
      );
      setBungalowsLk(bu);
    }
    setLoading(false);
    const cd = await apiGetTreasuryCashDayStatus();
    setCashDayToday(cd);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;
    void apiGetTreasuryCashDayStatus(recReportDate).then((x) => {
      if (!cancelled) setCashDayForReport(x);
    });
    return () => {
      cancelled = true;
    };
  }, [recReportDate]);

  useEffect(() => {
    const id = presetReservationId;
    if (!id) return;
    if (payableReservations.some((r) => r.id === id)) {
      setSelVisitorClientId("");
      setVisAmountField("");
      setVisFormErr(null);
      setSelReservationId(id);
      const r = payableReservations.find((x) => x.id === id);
      if (r) {
        const total = reservationGrandTotal(r.amount, r.latePenaltyUsd ?? 0);
        const reste = Math.max(0, total - (r.amountPaid ?? 0));
        setAmountField(nominalPresetForResteUsd(reste, reservationPayCurrency, cdfPerUsd));
      }
    }
  }, [presetReservationId, payableReservations, reservationPayCurrency, cdfPerUsd]);

  useEffect(() => {
    const cid = presetClientId;
    if (!cid) return;
    const c = clients.find((x) => x.id === cid);
    if (!c) return;
    const due = Math.floor(c.entryFeeUsd ?? 0);
    const paid = Math.floor(c.entryFeePaidUsd ?? 0);
    if (due < 1 || paid >= due) return;
    setSelReservationId("");
    setAmountField("");
    setFormErr(null);
    setSelVisitorClientId(cid);
    setVisAmountField(nominalPresetForResteUsd(due - paid, visitorPayCurrency, cdfPerUsd));
  }, [presetClientId, clients, visitorPayCurrency, cdfPerUsd]);

  useEffect(() => {
    if (!selReservationId) return;
    if (!payableReservations.some((r) => r.id === selReservationId)) {
      setSelReservationId("");
      setAmountField("");
    }
  }, [payableReservations, selReservationId]);

  const selected = useMemo(
    () => reservations.find((r) => r.id === selReservationId) ?? null,
    [reservations, selReservationId],
  );

  const selectedVisitor = useMemo(
    () => clients.find((c) => c.id === selVisitorClientId) ?? null,
    [clients, selVisitorClientId],
  );

  /** Un seul formulaire à droite : réservation si une réservation est ciblée, sinon visiteur si un client l’est. */
  const encaissementKind = selReservationId ? "reservation" : selVisitorClientId ? "visitor" : "none";

  const reservationPayEquivUsd = useMemo(() => {
    const amt = Number.parseInt(amountField.replace(/\s/g, ""), 10);
    if (!Number.isFinite(amt) || amt < 1) return null;
    return nominalToUsdFloor(amt, reservationPayCurrency, cdfPerUsd);
  }, [amountField, reservationPayCurrency, cdfPerUsd]);

  const visitorPayEquivUsd = useMemo(() => {
    const amt = Number.parseInt(visAmountField.replace(/\s/g, ""), 10);
    if (!Number.isFinite(amt) || amt < 1) return null;
    return nominalToUsdFloor(amt, visitorPayCurrency, cdfPerUsd);
  }, [visAmountField, visitorPayCurrency, cdfPerUsd]);

  const encaissementBlocked =
    !!user &&
    !userHasPermission(user, "finance.treasury") &&
    cashDayToday !== null &&
    !cashDayToday.opened;

  const receptionReportBlocked =
    !!user &&
    canSubmitReceptionReport &&
    !userHasPermission(user, "finance.treasury") &&
    cashDayForReport !== null &&
    !cashDayForReport.opened;

  useEffect(() => {
    if (!isReception || !canSubmitReceptionReport || receptionMainTab !== "cloture") return;
    if (receptionReportBlocked) {
      setRecClosureSituation(null);
      setRecClosureSituationLoading(false);
      setRecClosureSituationErr(null);
      setRecClosureSituationAck(false);
      return;
    }
    let cancelled = false;
    setRecClosureSituationLoading(true);
    setRecClosureSituationErr(null);
    setRecClosureSituation(null);
    setRecClosureSituationAck(false);
    void apiGetReceptionCashRegisterSituation(recReportDate).then((r) => {
      if (cancelled) return;
      setRecClosureSituationLoading(false);
      if (r.ok) setRecClosureSituation(r.situation);
      else setRecClosureSituationErr(receptionClosureSituationErrorMessage(r.code));
    });
    return () => {
      cancelled = true;
    };
  }, [
    isReception,
    canSubmitReceptionReport,
    receptionMainTab,
    recReportDate,
    receptionReportBlocked,
    recSituationRefreshKey,
  ]);

  useEffect(() => {
    if (!recClosureSituation) return;
    if (typeof recClosureSituation.treasuryOpeningFloatUsd === "number") {
      setRecOpeningStr(String(recClosureSituation.treasuryOpeningFloatUsd));
    }
  }, [recClosureSituation]);

  useEffect(() => {
    if (!selVisitorClientId) return;
    const c = clients.find((x) => x.id === selVisitorClientId);
    const due = Math.floor(c?.entryFeeUsd ?? 0);
    const paid = Math.floor(c?.entryFeePaidUsd ?? 0);
    if (!c || due < 1 || paid >= due) {
      setSelVisitorClientId("");
      setVisAmountField("");
    }
  }, [clients, selVisitorClientId]);

  const submitPayment = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFormErr(null);
      if (!selReservationId) {
        setFormErr("Choisissez une réservation.");
        return;
      }
      const amt = Number.parseInt(amountField.replace(/\s/g, ""), 10);
      if (!Number.isFinite(amt) || amt < 1) {
        setFormErr(
          reservationPayCurrency === "CDF"
            ? "Indiquez un montant entier en francs congolais (≥ 1 FC)."
            : "Indiquez un montant entier à encaisser (≥ 1 $).",
        );
        return;
      }
      const target = reservations.find((r) => r.id === selReservationId);
      if (!target) {
        setFormErr("Réservation introuvable.");
        return;
      }
      const totalDue = reservationGrandTotal(target.amount, target.latePenaltyUsd ?? 0);
      const reste = Math.max(0, totalDue - (target.amountPaid ?? 0));
      if (reste <= 0) {
        setFormErr("Il n’y a plus de solde à encaisser sur cette réservation.");
        return;
      }
      const equivUsd = nominalToUsdFloor(amt, reservationPayCurrency, cdfPerUsd);
      if (reservationPayCurrency === "CDF" && equivUsd < 1) {
        setFormErr(paymentErrorMessage("cdf_amount_too_small"));
        return;
      }
      if (equivUsd > reste) {
        setFormErr(
          `Après conversion, le crédit (${equivUsd} $) dépasse le reste à payer (${reste} $). Réduisez le montant ou payez en dollars.`,
        );
        return;
      }

      setSubmitBusy(true);
      const result = await apiCreatePayment({
        reservationId: selReservationId,
        amount: amt,
        currency: reservationPayCurrency,
        method,
        note: note.trim() || undefined,
      });
      setSubmitBusy(false);
      if (result.ok) {
        setReservations((prev) =>
          prev.map((r) =>
            r.id === result.reservation.id
              ? { ...r, amountPaid: result.reservation.amountPaid, status: result.reservation.status }
              : r,
          ),
        );
        setAmountField("");
        setNote("");
        setSearchParams({}, { replace: true });
        return;
      }
      setFormErr(paymentErrorMessage(result.code));
    },
    [
      amountField,
      cdfPerUsd,
      method,
      note,
      reservationPayCurrency,
      reservations,
      selReservationId,
      setSearchParams,
    ],
  );

  const submitVisitorPayment = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setVisFormErr(null);
      if (!selVisitorClientId) {
        setVisFormErr("Choisissez un client visiteur.");
        return;
      }
      const amt = Number.parseInt(visAmountField.replace(/\s/g, ""), 10);
      if (!Number.isFinite(amt) || amt < 1) {
        setVisFormErr(
          visitorPayCurrency === "CDF"
            ? "Indiquez un montant entier en francs congolais (≥ 1 FC)."
            : "Indiquez un montant entier à encaisser (≥ 1 $).",
        );
        return;
      }
      const c = clients.find((x) => x.id === selVisitorClientId);
      if (!c) {
        setVisFormErr("Client introuvable.");
        return;
      }
      const due = Math.floor(c.entryFeeUsd ?? 0);
      const paid = Math.floor(c.entryFeePaidUsd ?? 0);
      const reste = due - paid;
      if (reste <= 0) {
        setVisFormErr("Le droit d’entrée est déjà soldé.");
        return;
      }
      const equivUsd = nominalToUsdFloor(amt, visitorPayCurrency, cdfPerUsd);
      if (visitorPayCurrency === "CDF" && equivUsd < 1) {
        setVisFormErr(visitorPaymentErrorMessage("cdf_amount_too_small"));
        return;
      }
      if (equivUsd > reste) {
        setVisFormErr(
          `Après conversion, le crédit (${equivUsd} $) dépasse le reste (${reste} $). Réduisez le montant ou payez en dollars.`,
        );
        return;
      }
      setVisSubmitBusy(true);
      const result = await apiPostVisitorEntryFeePayment(selVisitorClientId, {
        amount: amt,
        currency: visitorPayCurrency,
        method,
        note: note.trim() || undefined,
      });
      setVisSubmitBusy(false);
      if (result.ok) {
        setClientsLk((prev) => prev.map((x) => (x.id === result.client.id ? { ...result.client } : x)));
        setVisAmountField("");
        setSearchParams({}, { replace: true });
        return;
      }
      setVisFormErr(visitorPaymentErrorMessage(result.code));
    },
    [clients, cdfPerUsd, method, note, selVisitorClientId, setSearchParams, visAmountField, visitorPayCurrency],
  );

  const submitReceptionRegister = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setRecFormErr(null);
      const openingFloatUsd = Math.round(Number(recOpeningStr.replace(/\s/g, "").replace(",", ".")) || 0);
      const countedCashUsd = Math.round(Number(recCountedStr.replace(/\s/g, "").replace(",", ".")) || 0);
      if (!Number.isFinite(countedCashUsd) || countedCashUsd < 0) {
        setRecFormErr("Indiquez le comptage caisse en USD (entier ≥ 0).");
        return;
      }
      if (!Number.isFinite(openingFloatUsd) || openingFloatUsd < 0) {
        setRecFormErr("Fond de caisse ouverture invalide.");
        return;
      }
      const reportDate = recReportDate.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
        setRecFormErr("Date du rapport invalide.");
        return;
      }
      if (!receptionReportBlocked) {
        if (recClosureSituationLoading) {
          setRecFormErr("Chargement de la situation journalière… Patientez un instant.");
          return;
        }
        if (recClosureSituationErr) {
          setRecFormErr("Consultez la situation journalière : le chargement a échoué. Actualisez puis réessayez.");
          return;
        }
        if (!recClosureSituation) {
          setRecFormErr("La situation journalière n’est pas disponible. Actualisez la page ou la date.");
          return;
        }
        if (!recClosureSituationAck) {
          setRecFormErr(
            "Vous devez prendre connaissance de la situation journalière et cocher la confirmation avant de clôturer.",
          );
          return;
        }
      }
      setRecSubmitBusy(true);
      try {
        const res = await apiSubmitReceptionRegisterReport({
          reportDate,
          openingFloatUsd,
          countedCashUsd,
          notesCashier: recNotesCashier.trim(),
        });
        if (!res.ok) {
          setRecFormErr(receptionReportErrorMessage(res.code));
          return;
        }
        setRecCountedStr("");
        setRecNotesCashier("");
        setRecSavedFlash(true);
        window.setTimeout(() => setRecSavedFlash(false), 2500);
      } finally {
        setRecSubmitBusy(false);
      }
    },
    [
      recClosureSituation,
      recClosureSituationAck,
      recClosureSituationErr,
      recClosureSituationLoading,
      recCountedStr,
      recNotesCashier,
      recOpeningStr,
      recReportDate,
      receptionReportBlocked,
    ],
  );

  return (
    <div>
      <Breadcrumb
        items={
          isReception
            ? [{ label: "Réservations", to: "/reservations" }, { label: "Caisse réception" }]
            : [{ label: "Finance", to: "/finance" }, { label: "Paiement" }]
        }
      />
      <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-4xl tracking-wide text-white">
            {isReception ? "Caisse réception" : "Paiement"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/45">
            {isReception ? (
              <>
                Encaissements à la réception : séjours (réservations <strong className="text-white/55">en cours</strong>{" "}
                ou <strong className="text-white/55">en attente de paiement</strong>) et{" "}
                <strong className="text-white/55">droit d’entrée visiteur</strong>. Choisissez une ligne puis{" "}
                <strong className="text-white/55">Utiliser</strong> pour ouvrir le formulaire à droite.
              </>
            ) : (
              <>
                Choisissez une ligne puis <strong className="text-white/55">Utiliser</strong> : le formulaire
                d’encaissement correspondant s’affiche à droite (réservation en cours ou en attente de paiement, ou
                droit d’entrée visiteur). Les autres statuts de séjour se gèrent depuis les réservations.
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          <Link
            to="/reservations"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-brand-cream/90 transition-colors hover:bg-white/10"
          >
            Réservations
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          {isReception ? (
            <Link
              to="/clients"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-brand-cream/90 transition-colors hover:bg-white/10"
            >
              Clients
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      </header>

      {isReception && canSubmitReceptionReport ? (
        <div
          className="mb-6 flex flex-wrap gap-2 border-b border-white/10 pb-1"
          role="tablist"
          aria-label="Sections caisse réception"
        >
          <button
            type="button"
            role="tab"
            id="caisse-reception-tab-encaissements"
            aria-selected={receptionMainTab === "encaissements"}
            aria-controls="caisse-reception-panel-encaissements"
            onClick={() => setReceptionMainTab("encaissements")}
            className={`rounded-t-lg px-4 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
              receptionMainTab === "encaissements"
                ? "border border-b-0 border-white/15 bg-white/[0.06] text-brand-cream/95"
                : "border border-transparent text-white/45 hover:bg-white/[0.04] hover:text-white/70"
            }`}
          >
            Encaissements
          </button>
          <button
            type="button"
            role="tab"
            id="caisse-reception-tab-cloture"
            aria-selected={receptionMainTab === "cloture"}
            aria-controls="caisse-reception-panel-cloture"
            onClick={() => setReceptionMainTab("cloture")}
            className={`rounded-t-lg px-4 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
              receptionMainTab === "cloture"
                ? "border border-b-0 border-white/15 bg-white/[0.06] text-brand-cream/95"
                : "border border-transparent text-white/45 hover:bg-white/[0.04] hover:text-white/70"
            }`}
          >
            Clôture caisse réception
          </button>
        </div>
      ) : null}

      {encaissementBlocked && (!isReception || receptionMainTab === "encaissements") ? (
        <div
          className="mb-6 rounded-2xl border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-50/95"
          role="status"
        >
          <p className="font-semibold text-amber-100/95">Encaissements suspendus</p>
          <p className="mt-1 text-amber-100/80">
            La trésorerie n’a pas encore ouvert la journée caisse ({cashDayToday?.businessDate ?? "—"}). Les paiements
            réservation et droit d’entrée visiteur sont bloqués.
          </p>
        </div>
      ) : null}

      {isReception && canSubmitReceptionReport && receptionMainTab === "cloture" ? (
        <motion.section
          id="caisse-reception-panel-cloture"
          role="tabpanel"
          aria-labelledby="caisse-reception-tab-cloture"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 rounded-2xl border border-white/10 glass-panel p-6"
        >
          <h2 className="font-display text-lg tracking-wide text-brand-cream/95">Clôture caisse réception (USD)</h2>
          <p className="mt-1 text-xs text-white/40">
            Un rapport par <strong className="text-white/55">jour calendaire</strong>. Il apparaît dans{" "}
            <Link to="/tresorerie" className="text-brand-orange/85 hover:underline">
              Trésorerie
            </Link>{" "}
            pour validation ; la trésorerie enregistre alors une entrée USD au livre de caisse.
          </p>

          <div className="mt-5 rounded-xl border border-white/15 bg-black/25 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-brand-cream/95">Situation journalière (votre caisse)</h3>
              {!receptionReportBlocked ? (
                <button
                  type="button"
                  onClick={() => setRecSituationRefreshKey((k) => k + 1)}
                  disabled={recClosureSituationLoading}
                  className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-medium text-white/70 hover:bg-white/10 disabled:opacity-40"
                >
                  Actualiser
                </button>
              ) : null}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-white/40">
              Espèces enregistrées dans le système à <strong className="text-white/55">votre nom</strong> pour la date du
              rapport (séjours + droits d’entrée visiteur). L’<strong className="text-white/55">attendu en caisse</strong>{" "}
              après comptage = fond d’ouverture + total ci-dessous.
            </p>
            {receptionReportBlocked ? (
              <p className="mt-3 text-xs text-amber-200/85" role="status">
                Journée caisse non ouverte pour {recReportDate} : la situation ne peut pas être calculée tant que la
                trésorerie n’a pas ouvert.
              </p>
            ) : recClosureSituationLoading ? (
              <p className="mt-3 text-xs text-white/50">Chargement de la situation…</p>
            ) : recClosureSituationErr ? (
              <p className="mt-3 text-xs text-red-200/90" role="alert">
                {recClosureSituationErr}
              </p>
            ) : recClosureSituation ? (
              <>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div className="flex justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 tabular-nums">
                    <dt className="text-white/45">Paiements séjour (espèces USD)</dt>
                    <dd className="font-medium text-white/90">
                      {recClosureSituation.reservationPaymentsCashUsd.toLocaleString("fr-FR")} $
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 tabular-nums">
                    <dt className="text-white/45">Droits d’entrée visiteur (espèces USD)</dt>
                    <dd className="font-medium text-white/90">
                      {recClosureSituation.visitorEntryCashUsd.toLocaleString("fr-FR")} $
                    </dd>
                  </div>
                  <div className="sm:col-span-2 flex justify-between gap-2 rounded-lg border border-brand-orange/25 bg-brand-orange/10 px-3 py-2 tabular-nums">
                    <dt className="font-medium text-brand-cream/90">Total espèces enregistrées (système)</dt>
                    <dd className="font-semibold text-brand-cream/95">
                      {recClosureSituation.systemCashSalesUsd.toLocaleString("fr-FR")} $
                    </dd>
                  </div>
                </dl>
                <label className="mt-4 flex cursor-pointer items-start gap-2 text-xs text-white/75">
                  <input
                    type="checkbox"
                    checked={recClosureSituationAck}
                    onChange={(e) => setRecClosureSituationAck(e.target.checked)}
                    className="mt-0.5 rounded border-white/25 bg-black/40 text-brand-orange focus:ring-brand-orange/40"
                  />
                  <span>
                    Je confirme avoir pris connaissance de cette situation journalière avant d’enregistrer la clôture.
                  </span>
                </label>
              </>
            ) : (
              <p className="mt-3 text-xs text-white/45">Aucune donnée de situation.</p>
            )}
          </div>

          <form onSubmit={submitReceptionRegister} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {receptionReportBlocked ? (
              <p
                className="sm:col-span-2 lg:col-span-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/90"
                role="status"
              >
                Journée caisse non ouverte pour {recReportDate} : enregistrez la clôture après l’ouverture trésorerie.
              </p>
            ) : null}
            <div className="sm:col-span-2 lg:col-span-1">
              <label
                htmlFor="rec-rapport-date"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
              >
                Date du rapport
              </label>
              <input
                id="rec-rapport-date"
                type="date"
                value={recReportDate}
                disabled
                title="Date fixée : journée d’exploitation en cours"
                className="w-full cursor-not-allowed rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white/70 outline-none opacity-60"
              />
              <p className="mt-1 text-[10px] text-white/40">Journée d’exploitation en cours (non modifiable).</p>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Fond d’ouverture (USD)
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={recOpeningStr}
                onChange={(e) => setRecOpeningStr(e.target.value)}
                disabled={
                  receptionReportBlocked ||
                  (recClosureSituation != null &&
                    typeof recClosureSituation.treasuryOpeningFloatUsd === "number")
                }
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
                placeholder="0"
              />
              {recClosureSituation != null &&
              typeof recClosureSituation.treasuryOpeningFloatUsd === "number" ? (
                <p className="mt-1 text-[10px] text-white/40">
                  Montant fixé par la trésorerie à l’ouverture de journée.
                </p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Espèces comptées (USD)
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={recCountedStr}
                onChange={(e) => setRecCountedStr(e.target.value)}
                disabled={receptionReportBlocked}
                className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
                placeholder="ex. 450"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Commentaire caissier
              </label>
              <textarea
                rows={2}
                value={recNotesCashier}
                onChange={(e) => setRecNotesCashier(e.target.value)}
                disabled={receptionReportBlocked}
                className="w-full resize-none rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-brand-orange/40 disabled:opacity-40"
                placeholder="Remarques, coffre…"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-4 flex flex-col gap-2">
              {recFormErr ? (
                <p
                  className="rounded-lg border border-brand-red/30 bg-brand-red/10 px-3 py-2 text-xs text-brand-cream/95"
                  role="alert"
                >
                  {recFormErr}
                </p>
              ) : null}
              {recSavedFlash ? (
                <p className="text-xs text-emerald-300/90">Rapport déposé — en attente de validation trésorerie.</p>
              ) : null}
              <button
                type="submit"
                disabled={
                  recSubmitBusy ||
                  receptionReportBlocked ||
                  (!receptionReportBlocked &&
                    (recClosureSituationLoading ||
                      !!recClosureSituationErr ||
                      !recClosureSituation ||
                      !recClosureSituationAck))
                }
                className="w-full max-w-md rounded-xl bg-gradient-to-r from-brand-red to-brand-red-orange py-3 text-sm font-semibold text-white shadow-glow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
              >
                {recSubmitBusy ? "Enregistrement…" : "Enregistrer la clôture caisse réception"}
              </button>
            </div>
          </form>
        </motion.section>
      ) : null}

      {(!isReception || receptionMainTab === "encaissements") && (
        <div
          id={isReception ? "caisse-reception-panel-encaissements" : undefined}
          role={isReception && canSubmitReceptionReport ? "tabpanel" : undefined}
          aria-labelledby={isReception && canSubmitReceptionReport ? "caisse-reception-tab-encaissements" : undefined}
          className="contents"
        >
      {apiError && (
        <p
          className="mb-6 rounded-xl border border-brand-orange/30 bg-brand-orange/10 px-4 py-3 text-sm text-brand-cream/95"
          role="alert"
        >
          Impossible de charger les données (API ou session). Vérifiez le serveur et la connexion.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,380px)]">
        <div className="flex min-w-0 flex-col gap-6">
        <motion.section
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel overflow-hidden rounded-2xl border border-white/10"
        >
          <div className="border-b border-white/10 px-5 py-4 md:px-6">
            <h2 className="font-display text-lg tracking-wide text-brand-cream/95">
              Réservations en cours ou en attente de paiement
            </h2>
            <p className="mt-1 text-xs text-white/40">
              Cliquez sur « Utiliser » pour ouvrir l’encaissement réservation à droite.
            </p>
          </div>
          {loading ? (
            <p className="px-5 py-12 text-center text-sm text-white/45 md:px-6">Chargement…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  <tr>
                    <th className="px-4 py-3 md:px-6">Statut</th>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Bungalow</th>
                    <th className="px-4 py-3">Séjour</th>
                    <th className="px-4 py-3 text-right">Reste à payer</th>
                    <th className="px-4 py-3 text-right">Payé / total</th>
                    <th className="px-4 py-3 text-right md:px-6"> </th>
                  </tr>
                </thead>
                <tbody>
                  {payableReservations.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-white/40 md:px-6">
                        Aucune réservation en cours ou en attente de paiement.
                      </td>
                    </tr>
                  ) : (
                    payableReservations.map((r) => {
                      const cn = clients.find((c) => c.id === r.clientId)?.name ?? "—";
                      const bc = reservationBungalowIds(r)
                        .map((id) => bungalows.find((b) => b.id === id)?.code ?? id)
                        .join(" + ");
                      const active = selReservationId === r.id;
                      const totalR = reservationGrandTotal(r.amount, r.latePenaltyUsd ?? 0);
                      return (
                        <tr
                          key={r.id}
                          className={`border-b border-white/5 hover:bg-white/[0.02] ${active ? "bg-brand-orange/[0.06]" : ""}`}
                        >
                          <td className="px-4 py-3 md:px-6">
                            <span
                              className={`inline-block rounded-lg border px-2.5 py-1 text-xs font-medium ${statusBadgeClass(r.status)}`}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-medium text-white/90">{cn}</td>
                          <td className="px-4 py-3 text-brand-orange/85">{bc}</td>
                          <td className="px-4 py-3 text-white/50">
                            {r.start} → {r.end}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-brand-orange/90">
                            {Math.max(0, totalR - (r.amountPaid ?? 0))} $
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-white/70">
                            {(r.amountPaid ?? 0).toString()} / {totalR} $
                          </td>
                          <td className="px-4 py-3 text-right md:px-6">
                            <button
                              type="button"
                              onClick={() => {
                                setSelVisitorClientId("");
                                setVisAmountField("");
                                setVisFormErr(null);
                                setSelReservationId(r.id);
                                const reste = Math.max(0, totalR - (r.amountPaid ?? 0));
                                setAmountField(nominalPresetForResteUsd(reste, reservationPayCurrency, cdfPerUsd));
                              }}
                              className="rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-[11px] font-medium text-brand-cream/90 hover:bg-white/10"
                            >
                              Utiliser
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.03 }}
          className="glass-panel overflow-hidden rounded-2xl border border-white/10"
        >
          <div className="border-b border-white/10 px-5 py-4 md:px-6">
            <h2 className="font-display text-lg tracking-wide text-brand-cream/95">Droit d’entrée visiteur</h2>
            <p className="mt-1 text-xs text-white/40">
              Clients avec droit d’entrée et solde restant. « Utiliser » ouvre l’encaissement visiteur à droite.
            </p>
          </div>
          {loading ? (
            <p className="px-5 py-12 text-center text-sm text-white/45 md:px-6">Chargement…</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                  <tr>
                    <th className="px-4 py-3 md:px-6">Client</th>
                    <th className="px-4 py-3 text-right">Dû</th>
                    <th className="px-4 py-3 text-right">Encaissé</th>
                    <th className="px-4 py-3 text-right">Reste</th>
                    <th className="px-4 py-3 text-right md:px-6"> </th>
                  </tr>
                </thead>
                <tbody>
                  {payableVisitorClients.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-white/40 md:px-6">
                        Aucun droit d’entrée à encaisser.
                      </td>
                    </tr>
                  ) : (
                    payableVisitorClients.map((c) => {
                      const due = Math.floor(c.entryFeeUsd ?? 0);
                      const paid = Math.floor(c.entryFeePaidUsd ?? 0);
                      const reste = Math.max(0, due - paid);
                      const active = selVisitorClientId === c.id;
                      return (
                        <tr
                          key={c.id}
                          className={`border-b border-white/5 hover:bg-white/[0.02] ${active ? "bg-sky-500/[0.06]" : ""}`}
                        >
                          <td className="px-4 py-3 font-medium text-white/90 md:px-6">
                            <div>{c.name}</div>
                            {visitorVisitShortLabel(c) ? (
                              <div className="mt-0.5 text-[10px] font-normal text-white/40">{visitorVisitShortLabel(c)}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-white/70">{due} $</td>
                          <td className="px-4 py-3 text-right tabular-nums text-white/70">{paid} $</td>
                          <td className="px-4 py-3 text-right tabular-nums text-sky-200/90">{reste} $</td>
                          <td className="px-4 py-3 text-right md:px-6">
                            <button
                              type="button"
                              onClick={() => {
                                setSelReservationId("");
                                setAmountField("");
                                setFormErr(null);
                                setSelVisitorClientId(c.id);
                                setVisAmountField(nominalPresetForResteUsd(reste, visitorPayCurrency, cdfPerUsd));
                              }}
                              className="rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-[11px] font-medium text-brand-cream/90 hover:bg-white/10"
                            >
                              Utiliser
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </motion.section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
        {encaissementKind === "none" ? (
          <motion.section
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel h-fit rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-5 md:p-6"
          >
            <div className="mb-2 flex items-center gap-2">
              <Wallet className="h-5 w-5 text-white/35" aria-hidden />
              <h2 className="font-display text-lg tracking-wide text-white/55">Encaissement</h2>
            </div>
            <p className="text-sm leading-relaxed text-white/45">
              Aucun formulaire ouvert. Utilisez le bouton <strong className="text-white/60">Utiliser</strong> sur une
              ligne du tableau des <strong className="text-white/60">réservations</strong> pour encaisser un séjour, ou
              sur une ligne du <strong className="text-white/60">droit d’entrée visiteur</strong> pour encaisser ce
              montant.
            </p>
          </motion.section>
        ) : null}

        {encaissementKind === "reservation" ? (
        <motion.section
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-panel h-fit rounded-2xl border border-white/10 p-5 md:p-6"
        >
          <div className="mb-4 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-brand-orange" aria-hidden />
            <h2 className="font-display text-lg tracking-wide text-brand-cream/95">Encaissement réservation</h2>
          </div>
          {!selected ? (
            <p className="mb-3 text-xs text-white/40">Choisissez une réservation dans la liste ou le menu déroulant.</p>
          ) : null}
          {formErr && (
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100/90">
              {formErr}
            </div>
          )}
          <form onSubmit={(ev) => void submitPayment(ev)} className="space-y-3">
            <div>
              <label htmlFor="pay-res" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Réservation
              </label>
              <select
                id="pay-res"
                value={selReservationId}
                onChange={(ev) => {
                  const id = ev.target.value;
                  setSelVisitorClientId("");
                  setVisAmountField("");
                  setVisFormErr(null);
                  setSelReservationId(id);
                  const r = payableReservations.find((x) => x.id === id);
                  if (r) {
                    const tr = reservationGrandTotal(r.amount, r.latePenaltyUsd ?? 0);
                    const reste = Math.max(0, tr - (r.amountPaid ?? 0));
                    setAmountField(nominalPresetForResteUsd(reste, reservationPayCurrency, cdfPerUsd));
                  } else {
                    setAmountField("");
                  }
                }}
                className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                disabled={loading || apiError || encaissementBlocked}
              >
                <option value="">— Choisir —</option>
                {payableReservations.map((r) => {
                  const cn = clients.find((c) => c.id === r.clientId)?.name ?? "—";
                  const bc = reservationBungalowIds(r)
                    .map((id) => bungalows.find((b) => b.id === id)?.code ?? id)
                    .join(" + ");
                  return (
                    <option key={r.id} value={r.id}>
                      {bc} · {cn} · {r.start} → {r.end} · {r.status}
                    </option>
                  );
                })}
              </select>
            </div>
            {selected ? (
              <div className="grid gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm">
                <div className="flex justify-between gap-2 tabular-nums">
                  <span className="text-white/45">Séjour</span>
                  <span className="font-medium text-white/85">{selected.amount} $</span>
                </div>
                <div className="flex justify-between gap-2 tabular-nums">
                  <span className="text-white/45">Personnes (payeur = client fiche)</span>
                  <span className="font-medium text-white/85">
                    {reservationIsGroup(selected)
                      ? Math.max(2, Math.min(99, Math.floor(Number(selected.guestCount ?? 2))))
                      : "—"}
                  </span>
                </div>
                {(selected.latePenaltyUsd ?? 0) > 0 ? (
                  <div className="flex justify-between gap-2 tabular-nums">
                    <span className="text-white/45">Pénalité retard d’occupation</span>
                    <span className="font-medium text-amber-200/90">{selected.latePenaltyUsd} $</span>
                  </div>
                ) : null}
                <div className="flex justify-between gap-2 tabular-nums">
                  <span className="text-white/45">Total dû</span>
                  <span className="font-medium text-white/90">
                    {reservationGrandTotal(selected.amount, selected.latePenaltyUsd ?? 0)} $
                  </span>
                </div>
                <div className="flex justify-between gap-2 tabular-nums">
                  <span className="text-white/45">Déjà encaissé</span>
                  <span className="text-white/75">{selected.amountPaid ?? 0} $</span>
                </div>
                <div className="flex justify-between gap-2 border-t border-white/10 pt-2 tabular-nums">
                  <span className="text-white/50">Reste à payer</span>
                  <span className="font-medium text-brand-orange/90">
                    {Math.max(
                      0,
                      reservationGrandTotal(selected.amount, selected.latePenaltyUsd ?? 0) -
                        (selected.amountPaid ?? 0),
                    )}{" "}
                    $
                  </span>
                </div>
              </div>
            ) : null}
            <div>
              <label htmlFor="pay-currency-res" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Devise de paiement
              </label>
              <select
                id="pay-currency-res"
                value={reservationPayCurrency}
                onChange={(ev) => {
                  const cur = ev.target.value as PaymentCurrencyCode;
                  setReservationPayCurrency(cur);
                  const id = selReservationId;
                  const r = payableReservations.find((x) => x.id === id);
                  if (r) {
                    const tr = reservationGrandTotal(r.amount, r.latePenaltyUsd ?? 0);
                    const reste = Math.max(0, tr - (r.amountPaid ?? 0));
                    setAmountField(nominalPresetForResteUsd(reste, cur, cdfPerUsd));
                  }
                }}
                className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                disabled={loading || apiError || encaissementBlocked}
              >
                <option value="USD">USD (dollar)</option>
                <option value="CDF">CDF (franc congolais, FC)</option>
              </select>
              <p className="mt-1 text-[11px] text-white/35">
                Taux indicatif (paramètres) : 1 USD = {cdfPerUsd.toLocaleString("fr-FR")} FC. Le crédit sur la réservation est en dollars (conversion avec arrondi à l’unité, comme le serveur).
              </p>
            </div>
            <div>
              <label htmlFor="pay-amt" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Montant payé {reservationPayCurrency === "CDF" ? "(FC)" : "($)"}
              </label>
              <input
                id="pay-amt"
                inputMode="numeric"
                value={amountField}
                onChange={(ev) => setAmountField(ev.target.value)}
                className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                placeholder={reservationPayCurrency === "CDF" ? "Ex. 570000" : "Ex. 200"}
                disabled={loading || apiError || encaissementBlocked}
              />
              {reservationPayCurrency === "CDF" && reservationPayEquivUsd != null ? (
                <p className="mt-1 text-[11px] text-white/45">
                  Équivalent crédité sur le solde (USD) :{" "}
                  <span className="tabular-nums font-medium text-white/70">{reservationPayEquivUsd} $</span>
                </p>
              ) : null}
              <p className="mt-1 text-[11px] text-white/35">
                Ajouté au cumul déjà encaissé. Si le cumul atteint le total ou l’acompte min. ({Math.round(DEPOSIT_MIN_FRACTION * 100)} %), la réservation passe en{" "}
                <span className="text-white/55">Confirmé</span>.
              </p>
            </div>
            <div>
              <label htmlFor="pay-method" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Moyen
              </label>
              <select
                id="pay-method"
                value={method}
                onChange={(ev) => setMethod(ev.target.value as ReservationPaymentMethod)}
                className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                disabled={loading || apiError || encaissementBlocked}
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="pay-note" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Note (optionnel)
              </label>
              <input
                id="pay-note"
                value={note}
                onChange={(ev) => setNote(ev.target.value)}
                className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                placeholder="Réf. virement, reçu…"
                maxLength={500}
                disabled={loading || apiError || encaissementBlocked}
              />
            </div>
            <button
              type="submit"
              disabled={submitBusy || loading || apiError || encaissementBlocked || payableReservations.length === 0}
              className="w-full rounded-xl border border-brand-orange/40 bg-brand-orange/20 py-2.5 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-orange/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitBusy ? "Enregistrement…" : "Enregistrer l’encaissement (réservation)"}
            </button>
          </form>
        </motion.section>
        ) : null}

        {encaissementKind === "visitor" ? (
        <motion.section
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-panel h-fit rounded-2xl border border-white/10 p-5 md:p-6"
        >
          <div className="mb-4 flex items-center gap-2">
            <Wallet className="h-5 w-5 text-sky-400/90" aria-hidden />
            <h2 className="font-display text-lg tracking-wide text-brand-cream/95">Encaissement visiteur</h2>
          </div>
          {selectedVisitor ? (
            <p className="mb-3 text-xs leading-relaxed text-white/45">
              Le cumul encaissé est enregistré sur la fiche client (droit d’entrée). La ligne apparaît dans{" "}
              <strong className="text-white/55">Facturation</strong> avec le libellé « Droit d’entrée visiteur ».
            </p>
          ) : (
            <p className="mb-3 text-xs text-white/40">Choisissez un client dans le tableau ou le menu déroulant.</p>
          )}
          {visFormErr && (
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100/90">
              {visFormErr}
            </div>
          )}
          <form onSubmit={(ev) => void submitVisitorPayment(ev)} className="space-y-3">
            <div>
              <label htmlFor="pay-vis-client" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Client visiteur
              </label>
              <select
                id="pay-vis-client"
                value={selVisitorClientId}
                onChange={(ev) => {
                  const id = ev.target.value;
                  setSelReservationId("");
                  setAmountField("");
                  setFormErr(null);
                  setSelVisitorClientId(id);
                  const cl = payableVisitorClients.find((x) => x.id === id);
                  if (cl) {
                    const due = Math.floor(cl.entryFeeUsd ?? 0);
                    const paid = Math.floor(cl.entryFeePaidUsd ?? 0);
                    const reste = Math.max(0, due - paid);
                    setVisAmountField(nominalPresetForResteUsd(reste, visitorPayCurrency, cdfPerUsd));
                  } else {
                    setVisAmountField("");
                  }
                }}
                className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                disabled={loading || apiError || encaissementBlocked}
              >
                <option value="">— Choisir —</option>
                {payableVisitorClients.map((c) => {
                  const due = Math.floor(c.entryFeeUsd ?? 0);
                  const paid = Math.floor(c.entryFeePaidUsd ?? 0);
                  const reste = Math.max(0, due - paid);
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name} · reste {reste} $
                    </option>
                  );
                })}
              </select>
            </div>
            {selectedVisitor ? (
              <div className="grid gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm">
                <div className="flex justify-between gap-2 tabular-nums">
                  <span className="text-white/45">Droit d’entrée (fiche)</span>
                  <span className="font-medium text-white/85">{Math.floor(selectedVisitor.entryFeeUsd ?? 0)} $</span>
                </div>
                <div className="flex justify-between gap-2 tabular-nums">
                  <span className="text-white/45">Déjà encaissé</span>
                  <span className="text-white/75">{Math.floor(selectedVisitor.entryFeePaidUsd ?? 0)} $</span>
                </div>
                <div className="flex justify-between gap-2 border-t border-white/10 pt-2 tabular-nums">
                  <span className="text-white/50">Reste</span>
                  <span className="font-medium text-sky-200/90">
                    {Math.max(
                      0,
                      Math.floor(selectedVisitor.entryFeeUsd ?? 0) -
                        Math.floor(selectedVisitor.entryFeePaidUsd ?? 0),
                    )}{" "}
                    $
                  </span>
                </div>
              </div>
            ) : null}
            <div>
              <label htmlFor="pay-currency-vis" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Devise de paiement
              </label>
              <select
                id="pay-currency-vis"
                value={visitorPayCurrency}
                onChange={(ev) => {
                  const cur = ev.target.value as PaymentCurrencyCode;
                  setVisitorPayCurrency(cur);
                  const id = selVisitorClientId;
                  const cl = payableVisitorClients.find((x) => x.id === id);
                  if (cl) {
                    const due = Math.floor(cl.entryFeeUsd ?? 0);
                    const paid = Math.floor(cl.entryFeePaidUsd ?? 0);
                    const reste = Math.max(0, due - paid);
                    setVisAmountField(nominalPresetForResteUsd(reste, cur, cdfPerUsd));
                  }
                }}
                className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                disabled={loading || apiError || encaissementBlocked}
              >
                <option value="USD">USD (dollar)</option>
                <option value="CDF">CDF (franc congolais, FC)</option>
              </select>
              <p className="mt-1 text-[11px] text-white/35">
                Taux indicatif : 1 USD = {cdfPerUsd.toLocaleString("fr-FR")} FC. Le droit d’entrée est crédité en dollars.
              </p>
            </div>
            <div>
              <label htmlFor="pay-vis-amt" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Montant payé {visitorPayCurrency === "CDF" ? "(FC)" : "($)"}
              </label>
              <input
                id="pay-vis-amt"
                inputMode="numeric"
                value={visAmountField}
                onChange={(ev) => setVisAmountField(ev.target.value)}
                className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                placeholder={visitorPayCurrency === "CDF" ? "Ex. 14250" : "Ex. 5"}
                disabled={loading || apiError || encaissementBlocked}
              />
              {visitorPayCurrency === "CDF" && visitorPayEquivUsd != null ? (
                <p className="mt-1 text-[11px] text-white/45">
                  Équivalent crédité (USD) :{" "}
                  <span className="tabular-nums font-medium text-white/70">{visitorPayEquivUsd} $</span>
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor="pay-vis-method" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Moyen
              </label>
              <select
                id="pay-vis-method"
                value={method}
                onChange={(ev) => setMethod(ev.target.value as ReservationPaymentMethod)}
                className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                disabled={loading || apiError || encaissementBlocked}
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="pay-vis-note" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                Note (optionnel)
              </label>
              <input
                id="pay-vis-note"
                value={note}
                onChange={(ev) => setNote(ev.target.value)}
                className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                placeholder="Réf. virement, reçu…"
                maxLength={500}
                disabled={loading || apiError || encaissementBlocked}
              />
            </div>
            <button
              type="submit"
              disabled={visSubmitBusy || loading || apiError || encaissementBlocked || payableVisitorClients.length === 0}
              className="w-full rounded-xl border border-sky-500/40 bg-sky-500/15 py-2.5 text-sm font-medium text-sky-100 transition-colors hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {visSubmitBusy ? "Enregistrement…" : "Enregistrer l’encaissement (visiteur)"}
            </button>
          </form>
        </motion.section>
        ) : null}
        </div>
      </div>
        </div>
      )}
    </div>
  );
}
