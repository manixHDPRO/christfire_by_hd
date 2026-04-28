import { Breadcrumb } from "@/components/layout/Breadcrumb";
import {
  apiApplyReservationOccupancyPenalty,
  apiCreateReservation,
  apiGetCategoryRates,
  apiGetOccupancyRules,
  apiListBungalows,
  apiListClients,
  apiListReservations,
  apiPatchReservationStay,
  apiUpdateReservation,
} from "@/lib/api";
import { BOOKING_CHANNEL_OPTIONS } from "@/lib/bookingChannel";
import { isOccupancyPenaltyApplicable, occupancyPenaltyDeadlineIso } from "@/lib/occupancyPenalty";
import {
  normalizeReservationFromApi,
  reservationBungalowIds,
  reservationIsGroup,
} from "@/lib/reservationBungalows";
import {
  DEPOSIT_MIN_FRACTION,
  minimumDepositAmount,
  reservationGrandTotal,
  reservationPaymentCoversConfirmation,
} from "@/lib/reservationPayment";
import { addDaysIso, effectiveNightlyRateUsd, nightsInStay } from "@/lib/reservationPricing";
import type {
  BookingChannel,
  Bungalow,
  CategoryRate,
  Client,
  OccupancyRules,
  Reservation,
  ReservationKind,
  ReservationStatus,
} from "@/types";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  GripVertical,
  LayoutGrid,
  List,
  Plus,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

const columns: ReservationStatus[] = [
  "En attente paiement",
  "Confirmé",
  "En cours",
  "Terminé",
  "No-show",
];

/** Libellés réception : quand enregistrer check-in (→ En cours) et check-out (→ Terminé). */
const COLUMN_OPERATIONAL_HINTS: Partial<Record<ReservationStatus, string>> = {
  "En attente paiement": "En attente d’encaissement",
  Confirmé: "Réservation validée — avant arrivée du client",
  "En cours": "Check-in : client accueilli / séjour en cours",
  Terminé: "Check-out : séjour terminé",
  "No-show": "Client ne s’est pas présenté",
};

function formatReservationTraceAt(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function ReservationTraceMeta({ r }: { r: Reservation }) {
  const c = r.createdAt;
  const u = r.updatedAt;
  if (!c && !u) return <span className="text-white/25">—</span>;
  return (
    <div className="space-y-0.5 text-[10px] leading-snug text-white/40">
      {c ? <div>Créée {formatReservationTraceAt(c)}</div> : null}
      {u && u !== c ? <div>MAJ {formatReservationTraceAt(u)}</div> : null}
    </div>
  );
}

const VIEW_STORAGE_KEY = "christfire-reservations-view";

type ReservationsViewMode = "kanban" | "list" | "calendar";

function readInitialViewMode(): ReservationsViewMode {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY);
    if (v === "kanban" || v === "list" || v === "calendar") return v;
  } catch {
    /* private mode */
  }
  return "kanban";
}

const WEEKDAYS_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] as const;

function shiftMonthYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Grille 6×7 : dates ISO du mois ou cases vides. Semaine commence lundi. */
function monthMatrixYm(ym: string): (string | null)[] {
  const [y, m] = ym.split("-").map(Number);
  const monthIndex = m - 1;
  const first = new Date(Date.UTC(y, monthIndex, 1));
  const lastDay = new Date(Date.UTC(y, monthIndex + 1, 0)).getUTCDate();
  const mondayPad = (first.getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [];
  for (let i = 0; i < mondayPad; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) {
    cells.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);
  return cells;
}

function reservationsActiveOnDay(list: Reservation[], dayIso: string): Reservation[] {
  return list.filter((r) => r.start <= dayIso && dayIso < r.end);
}

function reservationStayNights(r: Reservation): number {
  return nightsInStay(r.start, r.end).length;
}

/** Prix / nuité dérivé du total enregistré (même logique que Nuité × prix au formulaire). */
function reservationDerivedPricePerNight(r: Reservation): string {
  const n = reservationStayNights(r);
  if (n < 1) return "—";
  return `${Math.round(r.amount / n)} $`;
}

/** Effectif déclaré sur la réservation (titulaire + accompagnants), entre 1 et 99. */
function reservationGuestCount(r: Pick<Reservation, "guestCount">): number {
  const n = Math.floor(Number(r.guestCount ?? 1));
  if (!Number.isFinite(n)) return 1;
  return Math.min(99, Math.max(1, n));
}

function GuestCountCell({
  r,
  disabled,
  onCommit,
}: {
  r: Reservation;
  disabled: boolean;
  onCommit: (id: string, n: number) => void;
}) {
  const minVal = reservationIsGroup(r) ? 2 : 1;
  const [val, setVal] = useState(String(Math.max(minVal, reservationGuestCount(r))));
  useEffect(() => {
    setVal(String(Math.max(minVal, reservationGuestCount(r))));
  }, [r.id, r.guestCount, minVal]);
  return (
    <input
      type="number"
      min={minVal}
      max={99}
      step={1}
      disabled={disabled}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => {
        const n = Math.max(
          minVal,
          Math.min(99, Math.floor(Number.parseInt(val.replace(/\s/g, ""), 10) || minVal)),
        );
        setVal(String(n));
        if (n !== reservationGuestCount(r)) onCommit(r.id, n);
      }}
      className="w-16 rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-center text-sm text-white outline-none ring-brand-orange/40 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
      aria-label={`Effectif pour ${r.id}`}
    />
  );
}

/** Indicatif pour la modale « Prolonger » : déduit le prix / nuit du total actuel, puis total et complément suggérés. */
type ExtendStayPricingHint =
  | { kind: "no_nights_before" }
  | {
      kind: "await_new_end";
      nightsBefore: number;
      pricePerNightRounded: number;
      amountBefore: number;
    }
  | {
      kind: "ready";
      nightsBefore: number;
      nightsAfter: number;
      extraNights: number;
      pricePerNightRounded: number;
      amountBefore: number;
      suggestedTotal: number;
      suggestedSupplement: number;
    };

function computeExtendStayPricingHint(r: Reservation, newEndIso: string): ExtendStayPricingHint {
  const nightsBefore = reservationStayNights(r);
  if (nightsBefore < 1) return { kind: "no_nights_before" };
  const pricePerNightRounded = Math.round(r.amount / nightsBefore);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newEndIso) || newEndIso <= r.end) {
    return {
      kind: "await_new_end",
      nightsBefore,
      pricePerNightRounded,
      amountBefore: r.amount,
    };
  }
  if (newEndIso <= r.start) {
    return {
      kind: "await_new_end",
      nightsBefore,
      pricePerNightRounded,
      amountBefore: r.amount,
    };
  }
  const nightsAfter = nightsInStay(r.start, newEndIso).length;
  const extraNights = nightsInStay(r.end, newEndIso).length;
  if (nightsAfter < 1 || extraNights < 1) {
    return {
      kind: "await_new_end",
      nightsBefore,
      pricePerNightRounded,
      amountBefore: r.amount,
    };
  }
  const suggestedTotal = nightsAfter * pricePerNightRounded;
  const suggestedSupplement = suggestedTotal - r.amount;
  return {
    kind: "ready",
    nightsBefore,
    nightsAfter,
    extraNights,
    pricePerNightRounded,
    amountBefore: r.amount,
    suggestedTotal,
    suggestedSupplement,
  };
}

function monthTitleFr(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
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

function reservationCreateErrorMessage(code: string): string {
  switch (code) {
    case "bungalow_overlap":
      return "Ce bungalow a déjà une réservation qui chevauche ces dates.";
    case "unknown_client":
      return "Client introuvable.";
    case "unknown_bungalow":
      return "Bungalow introuvable.";
    case "bungalow_not_available":
      return "Ce bungalow n’est pas disponible à la réservation (statut différent de « Disponible »).";
    case "validation_error":
      return "Vérifiez les dates (fin après début) et le montant.";
    case "unauthorized":
      return "Session expirée. Reconnectez-vous.";
    case "network_error":
      return "Réseau indisponible.";
    default:
      return "L’enregistrement a échoué. Réessayez.";
  }
}

/** Même règle que l’API : intervalles [start, end) en dates ISO. */
function hasBungalowOverlap(
  reservations: Reservation[],
  bungalowId: string,
  start: string,
  end: string,
  excludeId?: string,
): boolean {
  return reservations.some(
    (r) =>
      r.id !== excludeId &&
      reservationBungalowIds(r).includes(bungalowId) &&
      r.start < end &&
      r.end > start,
  );
}

function hasAnyBungalowOverlap(
  reservations: Reservation[],
  bungalowIds: string[],
  start: string,
  end: string,
  excludeId?: string,
): boolean {
  return bungalowIds.some((id) => hasBungalowOverlap(reservations, id, start, end, excludeId));
}

function statusFromOverId(overId: string | number | undefined, list: Reservation[]): ReservationStatus | null {
  if (overId == null) return null;
  const s = String(overId);
  if (columns.includes(s as ReservationStatus)) return s as ReservationStatus;
  const res = list.find((r) => r.id === s);
  return res ? res.status : null;
}

function applyOccupancyPenaltyErrorMessage(code: string): string {
  switch (code) {
    case "not_found":
      return "Réservation introuvable.";
    case "penalty_already_applied":
      return "Une pénalité est déjà enregistrée sur cette réservation.";
    case "not_eligible_status":
      return "La pénalité ne s’applique qu’aux réservations « Confirmé » (client pas encore arrivé).";
    case "grace_not_expired":
      return "Le délai de grâce après le début du séjour n’est pas encore écoulé.";
    case "penalty_amount_zero":
      return "Le montant de pénalité est à 0 dans les réglages : augmentez-le dans Paramètres → Tarification.";
    case "unauthorized":
      return "Session expirée. Reconnectez-vous.";
    default:
      return "Impossible d’appliquer la pénalité. Réessayez.";
  }
}

function canExtendStayStatus(status: string): boolean {
  return status === "Confirmé" || status === "En cours" || status === "Terminé";
}

function extendStayErrorMessage(code: string): string {
  switch (code) {
    case "not_found":
      return "Réservation introuvable.";
    case "bungalow_overlap":
      return "Ces dates se chevauchent avec une autre réservation sur ce bungalow.";
    case "end_not_after_current":
      return "La nouvelle date de fin doit être après la date de fin actuelle.";
    case "not_extendable_status":
      return "Ce statut ne permet pas de prolonger le séjour.";
    case "validation_error":
      return "Vérifiez les dates et le montant.";
    case "unauthorized":
      return "Session expirée. Reconnectez-vous.";
    case "network_error":
      return "Réseau indisponible.";
    default:
      return "Impossible de prolonger le séjour. Réessayez.";
  }
}

function DraggableRes({
  r,
  clientName,
  bungalowCode,
  occupancyRules,
  todayIso,
  onApplyOccupancyPenalty,
  applyBusyId,
  onOpenExtend,
}: {
  r: Reservation;
  clientName: (id: string) => string;
  bungalowCode: (id: string) => string;
  occupancyRules: OccupancyRules | null;
  todayIso: string;
  onApplyOccupancyPenalty: (id: string) => void;
  applyBusyId: string | null;
  onOpenExtend?: (r: Reservation) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: r.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)`, zIndex: 50 }
    : undefined;
  const paid = r.amountPaid ?? 0;
  const penaltyDue =
    occupancyRules && isOccupancyPenaltyApplicable(r, occupancyRules, todayIso) ? occupancyRules : null;
  const grand = reservationGrandTotal(r.amount, r.latePenaltyUsd ?? 0);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-xl border border-white/10 bg-white/[0.06] p-3 shadow-md backdrop-blur-sm ${
        isDragging ? "opacity-40 ring-2 ring-brand-orange/50" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-0.5 cursor-grab touch-none text-white/35 hover:text-brand-orange active:cursor-grabbing"
          aria-label="Glisser pour changer le statut"
          {...listeners}
          {...attributes}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white/90">{clientName(r.clientId)}</p>
          <p className="text-xs text-brand-orange/80">
            {reservationBungalowIds(r)
              .map((id) => bungalowCode(id))
              .join(" + ")}
          </p>
          <p className="mt-1 text-[11px] text-white/40">
            {r.start} → {r.end}
          </p>
          {r.createdAt || r.updatedAt ? (
            <div className="mt-1.5 border-t border-white/5 pt-1.5">
              <ReservationTraceMeta r={r} />
            </div>
          ) : null}
          {reservationIsGroup(r) ? (
            <p className="mt-0.5 text-[10px] text-white/35">{reservationGuestCount(r)} pers.</p>
          ) : null}
          <p className="mt-1 text-xs font-semibold text-brand-cream/80">
            Payé {paid} / {grand} $
            {(r.latePenaltyUsd ?? 0) > 0 ? (
              <span className="ml-1 text-[10px] font-normal text-amber-200/80">(dont pénalité {r.latePenaltyUsd} $)</span>
            ) : null}
          </p>
          {penaltyDue ? (
            <div className="mt-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-snug text-amber-100/90">
              <span className="flex items-start gap-1">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                Non occupé après le {occupancyPenaltyDeadlineIso(r.start, penaltyDue.graceDays)} : pénalité{" "}
                {penaltyDue.penaltyUsd} $ applicable.
              </span>
              <button
                type="button"
                disabled={applyBusyId === r.id}
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={() => onApplyOccupancyPenalty(r.id)}
                className="mt-1.5 w-full rounded border border-amber-400/40 bg-black/30 px-2 py-1 text-[10px] font-semibold text-amber-100 hover:bg-amber-500/15 disabled:opacity-50"
              >
                {applyBusyId === r.id ? "…" : "Appliquer la pénalité"}
              </button>
            </div>
          ) : null}
          {onOpenExtend && canExtendStayStatus(r.status) && !reservationIsGroup(r) ? (
            <button
              type="button"
              onPointerDown={(ev) => ev.stopPropagation()}
              onClick={() => onOpenExtend(r)}
              className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-lg border border-sky-500/35 bg-sky-500/10 px-2 py-1 text-[10px] font-medium text-sky-100/90 hover:bg-sky-500/15"
            >
              <CalendarPlus className="h-3 w-3 shrink-0" aria-hidden />
              Prolonger
            </button>
          ) : null}
          <Link
            to={`/caisse-reception?reservation=${encodeURIComponent(r.id)}`}
            onPointerDown={(ev) => ev.stopPropagation()}
            className="mt-2 inline-flex items-center gap-1 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-[10px] font-medium text-brand-cream/90 hover:bg-white/10"
          >
            <Wallet className="h-3 w-3" aria-hidden />
            Paiement
          </Link>
          {r.status === "Confirmé" || r.status === "En cours" || r.status === "Terminé" ? (
            <Link
              to={`/accueil-sejour?reservation=${encodeURIComponent(r.id)}`}
              onPointerDown={(ev) => ev.stopPropagation()}
              className="mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-100/90 hover:bg-emerald-500/15"
            >
              <ClipboardCheck className="h-3 w-3 shrink-0" aria-hidden />
              Accueil séjour
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Column({
  status,
  items,
  isOver,
  clientName,
  bungalowCode,
  occupancyRules,
  todayIso,
  onApplyOccupancyPenalty,
  applyBusyId,
  onOpenExtend,
}: {
  status: ReservationStatus;
  items: Reservation[];
  isOver: boolean;
  clientName: (id: string) => string;
  bungalowCode: (id: string) => string;
  occupancyRules: OccupancyRules | null;
  todayIso: string;
  onApplyOccupancyPenalty: (id: string) => void;
  applyBusyId: string | null;
  onOpenExtend?: (r: Reservation) => void;
}) {
  const { setNodeRef } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[280px] flex-col gap-3 rounded-2xl border p-2 transition-colors sm:p-3 md:min-h-[360px] ${
        isOver
          ? "border-brand-orange/45 bg-brand-orange/5 ring-1 ring-brand-orange/30"
          : "border-white/10 bg-black/20"
      }`}
    >
      <h2 className="border-b border-white/10 pb-2 text-center font-display text-[11px] uppercase leading-tight tracking-wider text-white/55 sm:text-sm">
        <span className="block">{status}</span>
        {COLUMN_OPERATIONAL_HINTS[status] ? (
          <span className="mt-1.5 block text-[10px] font-normal normal-case tracking-normal text-white/38">
            {COLUMN_OPERATIONAL_HINTS[status]}
          </span>
        ) : null}
      </h2>
      <div className="flex flex-1 flex-col gap-2">
        {items.map((r) => (
          <DraggableRes
            key={r.id}
            r={r}
            clientName={clientName}
            bungalowCode={bungalowCode}
            occupancyRules={occupancyRules}
            todayIso={todayIso}
            onApplyOccupancyPenalty={onApplyOccupancyPenalty}
            applyBusyId={applyBusyId}
            onOpenExtend={onOpenExtend}
          />
        ))}
        {items.length === 0 && (
          <p className="flex flex-1 items-center justify-center py-8 text-xs text-white/25">Déposer ici</p>
        )}
      </div>
    </div>
  );
}

function ReservationsListView({
  rows,
  clientName,
  bungalowCode,
  occupancyRules,
  todayIso,
  onApplyOccupancyPenalty,
  applyBusyId,
  onOpenExtend,
  onGuestCountCommit,
  guestCountDisabled,
}: {
  rows: Reservation[];
  clientName: (id: string) => string;
  bungalowCode: (id: string) => string;
  occupancyRules: OccupancyRules | null;
  todayIso: string;
  onApplyOccupancyPenalty: (id: string) => void;
  applyBusyId: string | null;
  onOpenExtend?: (r: Reservation) => void;
  onGuestCountCommit: (id: string, n: number) => void;
  guestCountDisabled: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 glass-panel">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-white/40">
            <tr>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3 text-center">Effectif</th>
              <th className="px-4 py-3">Bungalow</th>
              <th className="px-4 py-3">Début</th>
              <th className="px-4 py-3">Fin</th>
              <th className="px-4 py-3 text-right">Nuité</th>
              <th className="px-4 py-3 text-right">Prix / nuité</th>
              <th className="px-4 py-3 text-right">Montant total</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3 text-right">Prolongation</th>
              <th className="px-4 py-3 text-right">Pénalité</th>
              <th className="px-4 py-3 text-right">Paiement</th>
              <th className="px-4 py-3">Enregistrement</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-4 py-12 text-center text-white/40">
                  Aucune réservation à afficher.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => {
                const nights = reservationStayNights(r);
                const st = columns.includes(r.status) ? r.status : "En attente paiement";
                const penaltyDue =
                  occupancyRules && isOccupancyPenaltyApplicable(r, occupancyRules, todayIso) ? occupancyRules : null;
                return (
                <motion.tr
                  key={r.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.02, 0.3) }}
                  className="border-b border-white/5 hover:bg-white/[0.02]"
                >
                  <td className="px-4 py-3 font-medium text-white/90">{clientName(r.clientId)}</td>
                  <td className="px-4 py-3 text-center align-middle">
                    {reservationIsGroup(r) ? (
                      <GuestCountCell r={r} disabled={guestCountDisabled} onCommit={onGuestCountCommit} />
                    ) : (
                      <span className="text-xs text-white/30">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-brand-orange/85">
                    {reservationBungalowIds(r)
                      .map((id) => bungalowCode(id))
                      .join(" + ")}
                  </td>
                  <td className="px-4 py-3 text-white/55">{r.start}</td>
                  <td className="px-4 py-3 text-white/55">{r.end}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/70">
                    {nights > 0 ? nights : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-white/70">
                    {reservationDerivedPricePerNight(r)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-brand-cream/85">{r.amount} $</td>
                  <td className="px-4 py-3 align-top">
                    <span
                      className={`inline-block rounded-lg border px-2.5 py-1.5 text-xs font-medium ${statusBadgeClass(st)}`}
                    >
                      {st}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right align-top">
                    {onOpenExtend && canExtendStayStatus(r.status) && !reservationIsGroup(r) ? (
                      <button
                        type="button"
                        onClick={() => onOpenExtend(r)}
                        className="inline-flex items-center gap-1 rounded-lg border border-sky-500/35 bg-sky-500/10 px-2 py-1 text-[10px] font-medium text-sky-100/90 hover:bg-sky-500/15"
                      >
                        <CalendarPlus className="h-3 w-3 shrink-0" aria-hidden />
                        Prolonger
                      </button>
                    ) : (
                      <span className="text-xs text-white/25">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right align-top">
                    {(r.latePenaltyUsd ?? 0) > 0 ? (
                      <span className="text-xs tabular-nums text-amber-200/85">{r.latePenaltyUsd} $</span>
                    ) : penaltyDue ? (
                      <button
                        type="button"
                        disabled={applyBusyId === r.id}
                        onClick={() => onApplyOccupancyPenalty(r.id)}
                        className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-100/90 hover:bg-amber-500/20 disabled:opacity-50"
                      >
                        {applyBusyId === r.id ? "…" : `Appliquer ${penaltyDue.penaltyUsd} $`}
                      </button>
                    ) : (
                      <span className="text-xs text-white/25">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/caisse-reception?reservation=${encodeURIComponent(r.id)}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-[11px] font-medium text-brand-cream/90 hover:bg-white/10"
                    >
                      <Wallet className="h-3 w-3" aria-hidden />
                      Paiement
                    </Link>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <ReservationTraceMeta r={r} />
                  </td>
                </motion.tr>
              );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReservationsCalendarView({
  list,
  calendarMonth,
  onMonthChange,
  clientName,
  bungalowCode,
}: {
  list: Reservation[];
  calendarMonth: string;
  onMonthChange: (ym: string) => void;
  clientName: (id: string) => string;
  bungalowCode: (id: string) => string;
}) {
  const matrix = monthMatrixYm(calendarMonth);
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="rounded-2xl border border-white/10 glass-panel p-4 md:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg capitalize tracking-wide text-brand-cream/90">{monthTitleFr(calendarMonth)}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMonthChange(shiftMonthYm(calendarMonth, -1))}
            className="rounded-lg border border-white/10 p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Mois précédent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              const t = new Date();
              onMonthChange(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`);
            }}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-white/55 transition-colors hover:bg-white/10 hover:text-white"
          >
            Aujourd’hui
          </button>
          <button
            type="button"
            onClick={() => onMonthChange(shiftMonthYm(calendarMonth, 1))}
            className="rounded-lg border border-white/10 p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Mois suivant"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wider text-white/35 md:gap-2">
        {WEEKDAYS_FR.map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1 md:gap-2">
        {matrix.map((dayIso, idx) => {
          if (!dayIso) {
            return <div key={`empty-${idx}`} className="min-h-[72px] rounded-lg bg-transparent md:min-h-[88px]" />;
          }
          const onDay = reservationsActiveOnDay(list, dayIso);
          const isToday = dayIso === todayIso;
          return (
            <div
              key={dayIso}
              className={`flex min-h-[72px] flex-col rounded-lg border p-1 md:min-h-[88px] md:p-1.5 ${
                isToday ? "border-brand-orange/40 bg-brand-orange/5" : "border-white/8 bg-black/20"
              }`}
            >
              <span className={`text-[11px] font-semibold md:text-xs ${isToday ? "text-brand-orange" : "text-white/50"}`}>
                {Number(dayIso.slice(8, 10))}
              </span>
              <div className="mt-0.5 flex flex-1 flex-col gap-0.5 overflow-hidden">
                {onDay.slice(0, 3).map((r) => (
                  <div
                    key={r.id}
                    title={`${clientName(r.clientId)} · ${reservationBungalowIds(r)
                      .map((id) => bungalowCode(id))
                      .join(" + ")} · ${r.status}${
                      reservationIsGroup(r) ? ` · ${reservationGuestCount(r)} pers.` : ""
                    }`}
                    className={`truncate rounded border px-1 py-0.5 text-[9px] leading-tight md:text-[10px] ${statusBadgeClass(r.status)}`}
                  >
                    {reservationBungalowIds(r)
                      .map((id) => bungalowCode(id))
                      .join(" + ")}
                  </div>
                ))}
                {onDay.length > 3 ? (
                  <span className="text-[9px] text-white/35">+{onDay.length - 3}</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-[11px] text-white/35">
        Chaque case correspond à une nuitée (séjour actif ce jour-là). Pour le <strong className="text-white/50">check-in</strong>{" "}
        (client à la réception → statut <strong className="text-white/50">En cours</strong>) ou le{" "}
        <strong className="text-white/50">check-out</strong> (fin de séjour → <strong className="text-white/50">Terminé</strong>), utilisez le{" "}
        <strong className="text-white/50">vue Kanban</strong> (glisser-déposer). Pour{" "}
        <strong className="text-white/50">prolonger</strong> un séjour, passez en <strong className="text-white/50">Liste</strong> ou{" "}
        <strong className="text-white/50">Kanban</strong> (bouton Prolonger + Paiement pour le complément).
      </p>
    </div>
  );
}

export function Reservations() {
  const baseId = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<ReservationsViewMode>(() => readInitialViewMode());
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
  });
  const [list, setList] = useState<Reservation[]>([]);
  const [clientsLk, setClientsLk] = useState<Client[]>([]);
  const [bungalowsLk, setBungalowsLk] = useState<Bungalow[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryRates, setCategoryRates] = useState<CategoryRate[]>([]);
  const [categoryRatesLoading, setCategoryRatesLoading] = useState(true);
  const [apiError, setApiError] = useState(false);
  const [patchErr, setPatchErr] = useState<string | null>(null);
  const [occupancyRules, setOccupancyRules] = useState<OccupancyRules | null>(null);
  const [applyPenaltyBusyId, setApplyPenaltyBusyId] = useState<string | null>(null);
  const [extendTarget, setExtendTarget] = useState<Reservation | null>(null);
  const [extendNewEnd, setExtendNewEnd] = useState("");
  const [extendAmountStr, setExtendAmountStr] = useState("");
  const [extendBusy, setExtendBusy] = useState(false);
  const [extendErr, setExtendErr] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [nvClientId, setNvClientId] = useState("");
  const [nvReservationKind, setNvReservationKind] = useState<ReservationKind>("individual");
  const [nvBungalowId, setNvBungalowId] = useState("");
  /** Bungalows cochés pour une réservation groupe (ordre conservé). */
  const [nvGroupBungalowIds, setNvGroupBungalowIds] = useState<string[]>([]);
  const [nvStart, setNvStart] = useState("");
  const [nvEnd, setNvEnd] = useState("");
  /** Prix par nuit ($ entiers) — prérempli depuis la grille tarifaire, modifiable. */
  const [nvPricePerNight, setNvPricePerNight] = useState("");
  /** Effectif groupe (≥ 2) ; masqué en mode individuel. */
  const [nvGuestCount, setNvGuestCount] = useState("2");
  const [nvBookingChannel, setNvBookingChannel] = useState<BookingChannel>("direct");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<ReservationStatus | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const todayIso = new Date().toISOString().slice(0, 10);

  const clientsSorted = useMemo(() => {
    return [...clientsLk].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [clientsLk]);

  const bungalowsSorted = useMemo(() => {
    return [...bungalowsLk].sort((a, b) => a.code.localeCompare(b.code, "fr", { numeric: true }));
  }, [bungalowsLk]);

  /** Bungalows proposés à la création de réservation : statut Disponible uniquement. */
  const bungalowsDisponibles = useMemo(
    () => bungalowsSorted.filter((b) => b.status === "Disponible"),
    [bungalowsSorted],
  );

  const createFormBungalowIds = useMemo(() => {
    if (nvReservationKind === "individual") return nvBungalowId ? [nvBungalowId] : [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of nvGroupBungalowIds) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  }, [nvBungalowId, nvGroupBungalowIds, nvReservationKind]);

  /** Nuitées et prix catalogue pour le formulaire (Paramètres · PRIX / NUITE $). */
  const stayPricingMeta = useMemo(() => {
    const ids = createFormBungalowIds;
    if (!createOpen || ids.length === 0 || !nvStart || !nvEnd || nvEnd <= nvStart) return null;
    if (nvReservationKind === "group" && ids.length < 2) return null;
    const nightList = nightsInStay(nvStart, nvEnd);
    let pricePerNightUSD = 0;
    for (const id of ids) {
      const b = bungalowsSorted.find((x) => x.id === id);
      if (!b) return null;
      pricePerNightUSD += effectiveNightlyRateUsd(b, categoryRates);
    }
    return {
      nights: nightList.length,
      pricePerNightUSD,
    };
  }, [bungalowsSorted, categoryRates, createFormBungalowIds, createOpen, nvEnd, nvReservationKind, nvStart]);

  useEffect(() => {
    if (!createOpen) return;
    if (!stayPricingMeta || stayPricingMeta.nights < 1) {
      setNvPricePerNight("");
      return;
    }
    setNvPricePerNight(String(stayPricingMeta.pricePerNightUSD));
  }, [createOpen, stayPricingMeta]);

  const createTotalAmount = useMemo(() => {
    const nights = stayPricingMeta?.nights ?? 0;
    const ppn = Number.parseInt(nvPricePerNight.replace(/\s/g, ""), 10);
    if (nights < 1 || !Number.isFinite(ppn) || ppn < 0) return null;
    return nights * ppn;
  }, [stayPricingMeta?.nights, nvPricePerNight]);

  /** Si le bungalow choisi n’est plus « Disponible » ou la liste charge après ouverture du formulaire. */
  useEffect(() => {
    if (!createOpen || bungalowsDisponibles.length === 0) return;
    if (nvReservationKind !== "individual") return;
    if (!bungalowsDisponibles.some((b) => b.id === nvBungalowId)) {
      setNvBungalowId(bungalowsDisponibles[0]!.id);
    }
  }, [bungalowsDisponibles, createOpen, nvBungalowId, nvReservationKind]);

  /** Côté groupe : retirer les codes non disponibles et garantir au moins 2 choix si possible. */
  useEffect(() => {
    if (!createOpen || nvReservationKind !== "group" || bungalowsDisponibles.length === 0) return;
    setNvGroupBungalowIds((prev) => {
      const availIds = bungalowsDisponibles.map((b) => b.id);
      const kept = prev.filter((id) => availIds.includes(id));
      if (kept.length >= 2) return kept;
      const merged: string[] = [...kept];
      for (const id of availIds) {
        if (!merged.includes(id)) merged.push(id);
        if (merged.length >= 2) break;
      }
      return merged;
    });
  }, [bungalowsDisponibles, createOpen, nvReservationKind]);

  const canOpenCreate =
    bungalowsDisponibles.length > 0 &&
    clientsSorted.length > 0 &&
    !loading &&
    !apiError &&
    !categoryRatesLoading;

  const clientName = useCallback(
    (id: string) => {
      return clientsLk.find((c) => c.id === id)?.name ?? "—";
    },
    [clientsLk],
  );

  const bungalowCode = useCallback(
    (id: string) => {
      return bungalowsLk.find((b) => b.id === id)?.code ?? id;
    },
    [bungalowsLk],
  );

  const reload = useCallback(async () => {
    setPatchErr(null);
    setLoading(true);
    setCategoryRatesLoading(true);
    const [res, clients, bungalows, rates, occ] = await Promise.all([
      apiListReservations(),
      apiListClients(),
      apiListBungalows(),
      apiGetCategoryRates(),
      apiGetOccupancyRules(),
    ]);
    if (res === null || clients === null || bungalows === null) {
      setApiError(true);
      setList([]);
      setClientsLk([]);
      setBungalowsLk([]);
      setCategoryRates([]);
      setOccupancyRules(null);
    } else {
      setApiError(false);
      setList(
        res.map((r) =>
          normalizeReservationFromApi({
            ...r,
            amountPaid: r.amountPaid ?? 0,
            latePenaltyUsd: r.latePenaltyUsd ?? 0,
          }),
        ),
      );
      setClientsLk(clients);
      setBungalowsLk(bungalows);
      setCategoryRates(rates ?? []);
      setOccupancyRules(occ);
    }
    setCategoryRatesLoading(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  const openCreate = useCallback(
    (presetClientId?: string) => {
      setCreateErr(null);
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const pickClient =
        presetClientId && clientsSorted.some((c) => c.id === presetClientId)
          ? presetClientId
          : (clientsSorted[0]?.id ?? "");
      setNvClientId(pickClient);
      setNvReservationKind("individual");
      setNvBungalowId(bungalowsDisponibles[0]?.id ?? "");
      const avail = bungalowsDisponibles.map((b) => b.id);
      setNvGroupBungalowIds(avail.slice(0, Math.min(2, avail.length)));
      setNvStart(today);
      setNvEnd(tomorrow);
      setNvPricePerNight("");
      setNvGuestCount("2");
      setNvBookingChannel("direct");
      setCreateOpen(true);
    },
    [bungalowsDisponibles, clientsSorted],
  );

  /** Liste clients : lien « Réserver » avec ?nouveau=1&clientId=… */
  useEffect(() => {
    if (searchParams.get("nouveau") !== "1") return;
    const clientId = searchParams.get("clientId");
    if (!clientId) return;
    if (loading) return;
    if (apiError) {
      setSearchParams({}, { replace: true });
      return;
    }
    if (clientsSorted.length === 0 || bungalowsDisponibles.length === 0) {
      setSearchParams({}, { replace: true });
      return;
    }
    openCreate(clientId);
    setSearchParams({}, { replace: true });
  }, [
    apiError,
    bungalowsDisponibles.length,
    clientsSorted.length,
    loading,
    openCreate,
    searchParams,
    setSearchParams,
  ]);

  const submitCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setCreateErr(null);
      const nights = stayPricingMeta?.nights ?? 0;
      const ppn = Number.parseInt(nvPricePerNight.replace(/\s/g, ""), 10);
      const bungalowIds = createFormBungalowIds;
      if (!nvClientId) {
        setCreateErr("Choisissez un client.");
        return;
      }
      if (nvReservationKind === "individual") {
        if (!nvBungalowId) {
          setCreateErr("Choisissez un bungalow.");
          return;
        }
      } else {
        if (bungalowIds.length < 2) {
          setCreateErr("En groupe : cochez au moins deux bungalows.");
          return;
        }
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nvStart) || !/^\d{4}-\d{2}-\d{2}$/.test(nvEnd)) {
        setCreateErr("Dates invalides.");
        return;
      }
      if (nvEnd <= nvStart) {
        setCreateErr("La date de fin doit être après la date de début.");
        return;
      }
      if (nights < 1) {
        setCreateErr("Le séjour doit comporter au moins une nuitée (fin strictement après début).");
        return;
      }
      if (!Number.isFinite(ppn) || ppn < 0) {
        setCreateErr("Indiquez un prix / nuité valide (entier ≥ 0).");
        return;
      }
      const amount = nights * ppn;
      if (!Number.isFinite(amount) || amount < 0) {
        setCreateErr("Montant total invalide.");
        return;
      }
      const gRaw = nvGuestCount.trim() === "" ? 2 : Number.parseInt(nvGuestCount.trim(), 10);
      const guestCountGroup = Math.max(2, Math.min(99, Number.isFinite(gRaw) ? gRaw : 2));

      if (hasAnyBungalowOverlap(list, bungalowIds, nvStart, nvEnd)) {
        setCreateErr(reservationCreateErrorMessage("bungalow_overlap"));
        return;
      }

      setCreateBusy(true);
      const res = await apiCreateReservation({
        clientId: nvClientId,
        bungalowIds,
        reservationKind: nvReservationKind,
        start: nvStart,
        end: nvEnd,
        amount,
        guestCount: nvReservationKind === "group" ? guestCountGroup : undefined,
        bookingChannel: nvBookingChannel,
      });
      setCreateBusy(false);
      if (res.ok) {
        setList((prev) =>
          [...prev, normalizeReservationFromApi(res.reservation)].sort((a, b) => a.start.localeCompare(b.start)),
        );
        setCreateOpen(false);
        return;
      }
      setCreateErr(reservationCreateErrorMessage(res.code));
    },
    [
      createFormBungalowIds,
      list,
      nvBungalowId,
      nvClientId,
      nvEnd,
      nvGuestCount,
      nvPricePerNight,
      nvReservationKind,
      nvStart,
      nvBookingChannel,
      stayPricingMeta,
    ],
  );

  const byCol = useMemo(() => {
    const m: Record<ReservationStatus, Reservation[]> = {
      "En attente paiement": [],
      Confirmé: [],
      "En cours": [],
      Terminé: [],
      "No-show": [],
    };
    for (const r of list) {
      const st = columns.includes(r.status) ? r.status : "En attente paiement";
      m[st].push(r);
    }
    return m;
  }, [list]);

  const sortedForList = useMemo(
    () => [...list].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end)),
    [list],
  );

  const applyOccupancyPenalty = useCallback(
    async (id: string) => {
      setApplyPenaltyBusyId(id);
      setPatchErr(null);
      const rules = occupancyRules;
      if (!rules) {
        setPatchErr("Règles d’occupation non chargées. Vérifiez les paramètres et la connexion.");
        setApplyPenaltyBusyId(null);
        return;
      }
      const cur = list.find((r) => r.id === id);
      if (!cur || !isOccupancyPenaltyApplicable(cur, rules, todayIso)) {
        setPatchErr("Cette réservation n’est pas éligible à la pénalité (statut, dates ou pénalité déjà appliquée).");
        setApplyPenaltyBusyId(null);
        return;
      }
      const res = await apiApplyReservationOccupancyPenalty(id);
      if (res.ok) {
        setList((prev) =>
          prev.map((r) => (r.id === id ? { ...r, ...res.reservation, latePenaltyUsd: res.reservation.latePenaltyUsd ?? 0 } : r)),
        );
      } else {
        setPatchErr(applyOccupancyPenaltyErrorMessage(res.code));
      }
      setApplyPenaltyBusyId(null);
    },
    [list, occupancyRules, todayIso],
  );

  const openExtend = useCallback((r: Reservation) => {
    setPatchErr(null);
    setExtendErr(null);
    setExtendTarget(r);
    setExtendNewEnd(addDaysIso(r.end, 1));
    setExtendAmountStr(String(r.amount));
  }, []);

  const extendPricingHint = useMemo(
    () => (extendTarget ? computeExtendStayPricingHint(extendTarget, extendNewEnd) : null),
    [extendTarget, extendNewEnd],
  );

  const extendAmountParsed = useMemo(() => {
    const v = Number.parseInt(extendAmountStr.replace(/\s/g, ""), 10);
    return Number.isFinite(v) && v >= 0 ? v : null;
  }, [extendAmountStr]);

  const submitExtend = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setExtendErr(null);
      if (!extendTarget) return;
      const r = extendTarget;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(extendNewEnd)) {
        setExtendErr("Date de fin invalide.");
        return;
      }
      if (extendNewEnd <= r.end) {
        setExtendErr("La nouvelle date de fin doit être après la date de fin actuelle.");
        return;
      }
      if (extendNewEnd <= r.start) {
        setExtendErr("La date de fin doit être après le début du séjour.");
        return;
      }
      const amount = Number.parseInt(extendAmountStr.replace(/\s/g, ""), 10);
      if (!Number.isFinite(amount) || amount < 0) {
        setExtendErr("Montant total invalide (entier ≥ 0).");
        return;
      }
      if (hasAnyBungalowOverlap(list, reservationBungalowIds(r), r.start, extendNewEnd, r.id)) {
        setExtendErr(extendStayErrorMessage("bungalow_overlap"));
        return;
      }
      setExtendBusy(true);
      const res = await apiPatchReservationStay(r.id, { end: extendNewEnd, amount });
      setExtendBusy(false);
      if (res.ok) {
        setList((prev) =>
          prev.map((x) =>
            x.id === r.id
              ? normalizeReservationFromApi({
                  ...x,
                  ...res.reservation,
                  amountPaid: res.reservation.amountPaid ?? 0,
                  latePenaltyUsd: res.reservation.latePenaltyUsd ?? 0,
                })
              : x,
          ),
        );
        setExtendTarget(null);
      } else {
        setExtendErr(extendStayErrorMessage(res.code));
      }
    },
    [extendAmountStr, extendNewEnd, extendTarget, list, todayIso],
  );

  const persistReservationGuestCount = useCallback(
    async (id: string, guestCount: number) => {
      setPatchErr(null);
      const current = list.find((r) => r.id === id);
      if (!current || !reservationIsGroup(current)) return;
      if (reservationGuestCount(current) === guestCount) return;
      const snapshot = list.map((r) => ({ ...r }));
      setList((prev) => prev.map((r) => (r.id === id ? { ...r, guestCount } : r)));
      const result = await apiUpdateReservation(id, { guestCount });
      if (!result.ok) {
        setList(snapshot);
        setPatchErr(
          result.code === "unauthorized"
            ? "Session expirée. Reconnectez-vous."
            : "Impossible d’enregistrer l’effectif. Réessayez.",
        );
      } else {
        setList((prev) =>
          prev.map((r) =>
            r.id === id ? normalizeReservationFromApi({ ...r, ...result.reservation }) : r,
          ),
        );
      }
    },
    [list],
  );

  const persistReservationStatus = useCallback(
    async (id: string, nextStatus: ReservationStatus) => {
      const current = list.find((r) => r.id === id);
      if (!current || current.status === nextStatus) return;
      const totalDue = reservationGrandTotal(current.amount, current.latePenaltyUsd ?? 0);
      if (
        nextStatus === "Confirmé" &&
        !reservationPaymentCoversConfirmation(current.amount, current.latePenaltyUsd ?? 0, current.amountPaid ?? 0)
      ) {
        setPatchErr(
          `Impossible de passer en « Confirmé » : encaissez au moins le total (${totalDue} $) ou un acompte d’au moins ${minimumDepositAmount(totalDue)} $ (${Math.round(DEPOSIT_MIN_FRACTION * 100)} % du montant).`,
        );
        return;
      }
      setPatchErr(null);
      const snapshot = list.map((r) => ({ ...r }));
      setList((prev) => prev.map((r) => (r.id === id ? { ...r, status: nextStatus } : r)));
      const result = await apiUpdateReservation(id, { status: nextStatus });
      if (!result.ok) {
        setList(snapshot);
        setPatchErr(
          result.code === "unauthorized"
            ? "Session expirée. Reconnectez-vous."
            : result.code === "confirm_requires_payment"
              ? `Encaissez au moins le total ou ${Math.round(DEPOSIT_MIN_FRACTION * 100)} % du montant avant de confirmer.`
              : "Impossible d’enregistrer le statut. Réessayez.",
        );
      }
    },
    [list],
  );

  const active = activeId ? list.find((r) => r.id === activeId) : null;

  function onDragStart(e: DragStartEvent) {
    setPatchErr(null);
    setActiveId(String(e.active.id));
  }

  function onDragOver(e: DragOverEvent) {
    setOverCol(statusFromOverId(e.over?.id, list));
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    setOverCol(null);
    const { active: a, over } = e;
    const nextStatus = statusFromOverId(over?.id, list);
    if (!nextStatus) return;
    const id = String(a.id);
    const current = list.find((r) => r.id === id);
    if (!current || current.status === nextStatus) return;

    void persistReservationStatus(id, nextStatus);
  }

  return (
    <div>
      <Breadcrumb items={[{ label: "Réservations" }]} />
      <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-4xl tracking-wide text-white">Réservations</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/45">
            {viewMode === "kanban" && (
              <>
                Glisser-déposer pour changer le statut.
              </>
            )}
            {viewMode === "list" && (
              <>
                Tableau trié par date de début.
              </>
            )}
            {viewMode === "calendar" && (
              <>
                Vue mensuelle des séjours actifs par jour.
              </>
            )}
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-center lg:justify-end">
          <div
            className="flex flex-wrap rounded-xl border border-white/10 bg-black/25 p-1"
            role="group"
            aria-label="Mode d’affichage des réservations"
          >
            {(
              [
                { id: "kanban" as const, label: "Kanban", Icon: LayoutGrid },
                { id: "list" as const, label: "Liste", Icon: List },
                { id: "calendar" as const, label: "Calendrier", Icon: CalendarDays },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setViewMode(id)}
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors sm:flex-none ${
                  viewMode === id
                    ? "bg-brand-red/50 text-white shadow-sm"
                    : "text-white/45 hover:bg-white/5 hover:text-white/75"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => openCreate()}
              disabled={!canOpenCreate}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-orange/40 bg-brand-orange/15 px-4 py-2.5 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-orange/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
              Nouvelle réservation
            </button>
            <div className="hidden items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs text-white/50 sm:inline-flex">
              <CalendarRange className="h-4 w-4 shrink-0 text-brand-orange" />
              Préférence mémorisée sur cet appareil
            </div>
          </div>
        </div>
      </header>

      {apiError && (
        <p
          className="mb-6 rounded-xl border border-brand-orange/30 bg-brand-orange/10 px-4 py-3 text-sm text-brand-cream/95"
          role="alert"
        >
          Impossible de charger les réservations (API ou session). Vérifiez que le serveur tourne et que vous êtes connecté.
        </p>
      )}

      {patchErr && (
        <p className="mb-6 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-100" role="alert">
          {patchErr}
        </p>
      )}

      {viewMode === "kanban" && (
        <motion.div
          className="mb-6 rounded-2xl border border-dashed border-brand-orange/25 bg-brand-orange/[0.04] px-4 py-3 text-xs text-white/55"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <strong className="text-brand-cream/90">Retour visuel drag & drop :</strong> une colonne valide s’illumine à
          l’approche. « Confirmé » uniquement après encaissement du total dû (séjour + pénalité éventuelle) ou d’un acompte (≥{" "}
          {Math.round(DEPOSIT_MIN_FRACTION * 100)} %) via le <strong className="text-white/50">module Paiement</strong>.
          <span className="mt-2 block">
            <strong className="text-brand-cream/85">Check-in</strong> : dès que le client se présente à la réception, faites
            glisser la carte de <strong className="text-white/55">Confirmé</strong> vers{" "}
            <strong className="text-white/55">En cours</strong> (le bungalow passe alors en{" "}
            <strong className="text-white/55">Occupé</strong> ; il restait en{" "}
            <strong className="text-white/55">Réservé</strong> tant qu’il était seulement confirmé, sans check-in).
            <strong className="ml-1 text-brand-cream/85">Check-out</strong> : en fin de séjour, glissez{" "}
            <strong className="text-white/55">En cours</strong> vers <strong className="text-white/55">Terminé</strong>.
            <span className="mt-2 block">
              <strong className="text-brand-cream/85">Prolongation</strong> : sur les cartes{" "}
              <strong className="text-white/55">Confirmé</strong>, <strong className="text-white/55">En cours</strong> ou{" "}
              <strong className="text-white/55">Terminé</strong>, utilisez <strong className="text-white/55">Prolonger</strong> pour
              repousser la date de fin et mettre à jour le montant total ; enregistrez le complément dans{" "}
              <strong className="text-white/50">Paiement</strong>.
            </span>
          </span>
        </motion.div>
      )}

      {(viewMode === "list" || viewMode === "calendar") && (
        <motion.div
          className="mb-6 rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-3 text-xs text-white/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <strong className="text-brand-cream/90">Réception —</strong>{" "}
          <strong className="text-white/65">Check-in</strong> : quand le client arrivé est enregistré, passez la réservation
          en <strong className="text-white/55">En cours</strong>
          {viewMode === "list" ? " (passez en vue Kanban pour modifier le statut)" : " (vue Kanban)"}.{" "}
          <strong className="text-white/65">Check-out</strong> : à la fin du séjour, passez en{" "}
          <strong className="text-white/55">Terminé</strong>. Pour repousser la fin d’un séjour (y compris déjà terminé), utilisez{" "}
          <strong className="text-white/55">Prolonger</strong> puis le <strong className="text-white/50">module Paiement</strong> pour
          le complément.
        </motion.div>
      )}

      {loading ? (
        <p className="py-16 text-center text-white/45">Chargement des réservations…</p>
      ) : viewMode === "list" ? (
        <ReservationsListView
          rows={sortedForList}
          clientName={clientName}
          bungalowCode={bungalowCode}
          occupancyRules={occupancyRules}
          todayIso={todayIso}
          onApplyOccupancyPenalty={(id) => void applyOccupancyPenalty(id)}
          applyBusyId={applyPenaltyBusyId}
          onOpenExtend={openExtend}
          onGuestCountCommit={(id, n) => void persistReservationGuestCount(id, n)}
          guestCountDisabled={loading || apiError}
        />
      ) : viewMode === "calendar" ? (
        <ReservationsCalendarView
          list={list}
          calendarMonth={calendarMonth}
          onMonthChange={setCalendarMonth}
          clientName={clientName}
          bungalowCode={bungalowCode}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={(ev) => void onDragEnd(ev)}
          onDragCancel={() => {
            setActiveId(null);
            setOverCol(null);
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {columns.map((s) => (
              <Column
                key={s}
                status={s}
                items={byCol[s]}
                isOver={overCol === s}
                clientName={clientName}
                bungalowCode={bungalowCode}
                occupancyRules={occupancyRules}
                todayIso={todayIso}
                onApplyOccupancyPenalty={(id) => void applyOccupancyPenalty(id)}
                applyBusyId={applyPenaltyBusyId}
                onOpenExtend={openExtend}
              />
            ))}
          </div>
          <DragOverlay>
            {active ? (
              <div className="rounded-xl border border-brand-orange/40 bg-zinc-900/95 p-3 shadow-2xl">
                <p className="text-sm font-medium text-white">{clientName(active.clientId)}</p>
                <p className="text-xs text-white/45">
                  {active.start} → {active.end}
                </p>
                {reservationIsGroup(active) ? (
                  <p className="mt-0.5 text-[10px] text-white/40">{reservationGuestCount(active)} pers.</p>
                ) : null}
                <p className="mt-1 text-[11px] text-brand-cream/75">
                  Payé {(active.amountPaid ?? 0).toString()} /{" "}
                  {reservationGrandTotal(active.amount, active.latePenaltyUsd ?? 0)} $
                </p>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <AnimatePresence>
        {createOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
            role="presentation"
            onClick={() => {
              if (!createBusy) setCreateOpen(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`${baseId}-new-res-title`}
              className="glass-panel max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 p-6 shadow-xl"
              onClick={(ev) => ev.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <h2 id={`${baseId}-new-res-title`} className="font-display text-lg tracking-wide text-brand-cream/95">
                  Nouvelle réservation
                </h2>
                <button
                  type="button"
                  disabled={createBusy}
                  onClick={() => setCreateOpen(false)}
                  className="rounded-lg p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mb-4 text-xs text-white/45">
                Les dates sont traitées comme un séjour du <strong className="text-white/60">jour de début</strong> au{" "}
                <strong className="text-white/60">jour de fin</strong> (exclu pour les chevauchements) : une réservation
                8→12 et une autre 12→15 ne se chevauchent pas.
              </p>
              {createErr && (
                <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100/90">
                  {createErr}
                </div>
              )}
              <form onSubmit={(ev) => void submitCreate(ev)} className="space-y-3">
                <div>
                  <label
                    htmlFor={`${baseId}-res-client`}
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                  >
                    Client
                  </label>
                  <select
                    id={`${baseId}-res-client`}
                    required
                    value={nvClientId}
                    onChange={(ev) => setNvClientId(ev.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                  >
                    {clientsSorted.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-white/35">
                    Le client choisi reste le <strong className="text-white/50">payeur</strong>
                    {nvReservationKind === "group"
                      ? " ; en groupe, indiquez l’effectif total (≥ 2 personnes) pour la réception."
                      : "."}
                  </p>
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-res-channel`}
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                  >
                    Canal de réservation
                  </label>
                  <select
                    id={`${baseId}-res-channel`}
                    value={nvBookingChannel}
                    onChange={(ev) => setNvBookingChannel(ev.target.value as BookingChannel)}
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                  >
                    {BOOKING_CHANNEL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-white/35">
                    Utilisé dans les rapports (mix direct / OTA / agence…).
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor={`${baseId}-res-kind`}
                      className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                    >
                      Type réservation
                    </label>
                    <select
                      id={`${baseId}-res-kind`}
                      value={nvReservationKind}
                      onChange={(ev) => {
                        const v = ev.target.value as ReservationKind;
                        setNvReservationKind(v);
                        if (v === "group") {
                          const ids = bungalowsDisponibles.map((b) => b.id);
                          setNvGroupBungalowIds(ids.slice(0, Math.min(2, ids.length)));
                          setNvGuestCount("2");
                        }
                      }}
                      className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                    >
                      <option value="individual">Individuel</option>
                      <option value="group" disabled={bungalowsDisponibles.length < 2}>
                        En groupe
                      </option>
                    </select>
                    {bungalowsDisponibles.length < 2 ? (
                      <p className="mt-1 text-[10px] text-amber-200/70">
                        Au moins deux bungalows « Disponible » sont nécessaires pour une réservation en groupe.
                      </p>
                    ) : null}
                  </div>
                  {nvReservationKind === "group" ? (
                    <div className="w-full shrink-0 sm:w-40">
                      <label
                        htmlFor={`${baseId}-res-guests`}
                        className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                      >
                        Nombre de personnes
                      </label>
                      <input
                        id={`${baseId}-res-guests`}
                        type="number"
                        min={2}
                        max={99}
                        step={1}
                        required
                        value={nvGuestCount}
                        onChange={(ev) => setNvGuestCount(ev.target.value)}
                        className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                      />
                    </div>
                  ) : null}
                </div>
                {nvReservationKind === "group" ? (
                  <fieldset className="rounded-lg border border-white/10 p-3">
                      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">
                        Bungalows réservés
                      </legend>
                      <p className="mb-2 text-[10px] text-white/35">
                        Cochez au moins deux unités pour le même séjour (mêmes dates, montant total unique).
                      </p>
                      <ul className="max-h-40 space-y-2 overflow-y-auto text-sm">
                        {bungalowsDisponibles.map((b) => (
                          <li key={b.id}>
                            <label className="flex cursor-pointer items-center gap-2 text-white/85">
                              <input
                                type="checkbox"
                                checked={nvGroupBungalowIds.includes(b.id)}
                                onChange={() => {
                                  setNvGroupBungalowIds((prev) =>
                                    prev.includes(b.id) ? prev.filter((x) => x !== b.id) : [...prev, b.id],
                                  );
                                }}
                                className="rounded border-white/20 bg-black/40 text-brand-orange focus:ring-brand-orange/40"
                              />
                              <span>
                                {b.code} — {b.label}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </fieldset>
                ) : (
                  <div>
                    <label
                      htmlFor={`${baseId}-res-bungalow`}
                      className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                    >
                      Bungalow
                    </label>
                    <select
                      id={`${baseId}-res-bungalow`}
                      required
                      value={nvBungalowId}
                      onChange={(ev) => setNvBungalowId(ev.target.value)}
                      className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                    >
                      {bungalowsDisponibles.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.code} — {b.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-[11px] text-white/35">
                      Seuls les bungalows au statut « Disponible » sont proposés.
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor={`${baseId}-res-start`}
                      className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                    >
                      Début
                    </label>
                    <input
                      id={`${baseId}-res-start`}
                      type="date"
                      required
                      value={nvStart}
                      onChange={(ev) => setNvStart(ev.target.value)}
                      className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`${baseId}-res-end`}
                      className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                    >
                      Fin
                    </label>
                    <input
                      id={`${baseId}-res-end`}
                      type="date"
                      required
                      value={nvEnd}
                      onChange={(ev) => setNvEnd(ev.target.value)}
                      className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                      Nuité
                    </span>
                    <div
                      className="flex min-h-[42px] items-center rounded-lg border border-white/10 bg-black/20 px-3 text-sm text-white/80"
                      aria-live="polite"
                    >
                      {stayPricingMeta && stayPricingMeta.nights > 0 ? stayPricingMeta.nights : "—"}
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor={`${baseId}-res-ppn`}
                      className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                    >
                      Prix / nuité ($)
                    </label>
                    <input
                      id={`${baseId}-res-ppn`}
                      inputMode="numeric"
                      required
                      value={nvPricePerNight}
                      onChange={(ev) => setNvPricePerNight(ev.target.value)}
                      className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 placeholder:text-white/30 focus:ring-2"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45">
                      Montant total ($)
                    </span>
                    <div
                      className="flex min-h-[42px] items-center rounded-lg border border-brand-orange/25 bg-brand-orange/10 px-3 text-sm font-semibold text-brand-cream/95"
                      aria-live="polite"
                    >
                      {createTotalAmount !== null ? `${createTotalAmount}` : "—"}
                    </div>
                  </div>
                </div>
                {!categoryRatesLoading && categoryRates.length === 0 ? (
                  <p className="text-[11px] text-brand-orange/80" role="status">
                    Grille tarifaire non chargée — saisissez le prix / nuité à la main ou rechargez la page.
                  </p>
                ) : null}
                <p className="rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2 text-[11px] leading-relaxed text-violet-100/90">
                  Statut initial : <strong>En attente paiement</strong> (aucun encaissement encore). Les paiements se font dans{" "}
                  <Link to="/caisse-reception" className="font-semibold text-violet-200/95 underline-offset-2 hover:underline">
                    Paiement
                  </Link>
                  . Passage en <strong>Confirmé</strong> lorsque le total ou un acompte ≥{" "}
                  {Math.round(DEPOSIT_MIN_FRACTION * 100)} % est enregistré ; le check-in (réception) fait ensuite passer en{" "}
                  <strong>En cours</strong> (vue Kanban).
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={createBusy}
                    onClick={() => setCreateOpen(false)}
                    className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 disabled:opacity-40"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={createBusy}
                    className="rounded-lg border border-brand-orange/40 bg-brand-orange/20 px-4 py-2 text-sm font-medium text-brand-cream transition-colors hover:bg-brand-orange/30 disabled:opacity-40"
                  >
                    {createBusy ? "Enregistrement…" : "Enregistrer"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {extendTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
            role="presentation"
            onClick={() => {
              if (!extendBusy) setExtendTarget(null);
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`${baseId}-extend-stay-title`}
              className="glass-panel max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 p-6 shadow-xl"
              onClick={(ev) => ev.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <h2 id={`${baseId}-extend-stay-title`} className="font-display text-lg tracking-wide text-brand-cream/95">
                  Prolonger le séjour
                </h2>
                <button
                  type="button"
                  disabled={extendBusy}
                  onClick={() => setExtendTarget(null)}
                  className="rounded-lg p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mb-3 text-xs text-white/45">
                <strong className="text-white/55">{clientName(extendTarget.clientId)}</strong> ·{" "}
                <span className="text-brand-orange/80">
                  {reservationBungalowIds(extendTarget)
                    .map((id) => bungalowCode(id))
                    .join(" + ")}
                </span>
                <br />
                Séjour actuel : <strong className="text-white/60">{extendTarget.start}</strong> →{" "}
                <strong className="text-white/60">{extendTarget.end}</strong> ({reservationStayNights(extendTarget)} nuit
                {reservationStayNights(extendTarget) > 1 ? "s" : ""}) · total {extendTarget.amount} $
              </p>
              {extendErr && (
                <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100/90">
                  {extendErr}
                </div>
              )}

              {extendPricingHint ? (
                <div className="mb-4 space-y-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] px-3 py-3 text-xs leading-relaxed text-white/80">
                  <p className="font-semibold text-emerald-100/95">Calcul indicatif (à partir du total actuel)</p>
                  <p className="text-[10px] text-white/40">
                    Les nuitées suivent la même règle que partout dans l’app : intervalle{" "}
                    <span className="text-white/55">[début, fin)</span> — la date de fin est le jour de départ et ne compte
                    pas comme nuitée.
                  </p>
                  {extendPricingHint.kind === "no_nights_before" ? (
                    <p className="text-amber-100/85">
                      Impossible de déduire un prix par nuitée : le séjour actuel n’a pas de nuitée enregistrée (vérifiez
                      dates et montant).
                    </p>
                  ) : extendPricingHint.kind === "await_new_end" ? (
                    <>
                      <p className="tabular-nums">
                        Séjour actuel : <strong className="text-white/90">{extendPricingHint.nightsBefore}</strong>{" "}
                        nuit{extendPricingHint.nightsBefore > 1 ? "s" : ""} pour{" "}
                        <strong className="text-white/90">{extendPricingHint.amountBefore} $</strong> → prix moyen retenu{" "}
                        <strong className="text-white/90">{extendPricingHint.pricePerNightRounded} $</strong> / nuit
                        (arrondi).
                      </p>
                      <p className="text-white/45">
                        Indiquez une <strong className="text-white/60">nouvelle date de fin</strong> strictement après{" "}
                        <span className="tabular-nums text-white/55">{extendTarget.end}</span> pour afficher le total et le
                        complément conseillés.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="tabular-nums">
                        Prix moyen déduit : <strong className="text-white/90">{extendPricingHint.pricePerNightRounded} $</strong>{" "}
                        / nuit — à partir de {extendPricingHint.amountBefore} $ ÷ {extendPricingHint.nightsBefore} nuit
                        {extendPricingHint.nightsBefore > 1 ? "s" : ""}.
                      </p>
                      <p className="tabular-nums">
                        Après prolongation : <strong className="text-white/90">{extendPricingHint.nightsAfter}</strong> nuit
                        {extendPricingHint.nightsAfter > 1 ? "s" : ""} au total (
                        {extendPricingHint.nightsBefore} +{" "}
                        <strong className="text-emerald-200/90">{extendPricingHint.extraNights}</strong>).
                      </p>
                      <p className="tabular-nums text-sm font-medium text-emerald-100/95">
                        Total conseillé : {extendPricingHint.nightsAfter} × {extendPricingHint.pricePerNightRounded} $ ={" "}
                        <strong>{extendPricingHint.suggestedTotal} $</strong>
                      </p>
                      <p className="tabular-nums text-white/55">
                        Complément estimé sur le séjour (hors pénalité) :{" "}
                        <strong className="text-white/75">{extendPricingHint.suggestedSupplement} $</strong>
                      </p>
                    </>
                  )}
                </div>
              ) : null}

              <form onSubmit={(ev) => void submitExtend(ev)} className="space-y-3">
                <div>
                  <label
                    htmlFor={`${baseId}-extend-end`}
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                  >
                    Nouvelle date de fin
                  </label>
                  <input
                    id={`${baseId}-extend-end`}
                    type="date"
                    required
                    min={addDaysIso(extendTarget.end, 1)}
                    value={extendNewEnd}
                    onChange={(ev) => setExtendNewEnd(ev.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                  />
                  {extendNewEnd > extendTarget.end ? (
                    <p className="mt-1 text-[10px] text-white/35">
                      {(() => {
                        const n = nightsInStay(extendTarget.end, extendNewEnd).length;
                        return n === 1
                          ? "+1 nuitée supplémentaire (après la date de fin actuelle)."
                          : `+${n} nuits supplémentaires (après la date de fin actuelle).`;
                      })()}
                    </p>
                  ) : null}
                </div>
                <div>
                  <label
                    htmlFor={`${baseId}-extend-amount`}
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/45"
                  >
                    Montant total du séjour ($)
                  </label>
                  <input
                    id={`${baseId}-extend-amount`}
                    inputMode="numeric"
                    required
                    value={extendAmountStr}
                    onChange={(ev) => setExtendAmountStr(ev.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-brand-orange/40 focus:ring-2"
                  />
                  {extendPricingHint?.kind === "ready" && extendAmountParsed !== null && extendAmountParsed !== extendPricingHint.suggestedTotal ? (
                    <p className="mt-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-100/90">
                      Montant saisi : <strong className="tabular-nums">{extendAmountParsed} $</strong> — le calcul
                      indicatif donne <strong className="tabular-nums">{extendPricingHint.suggestedTotal} $</strong>{" "}
                      (écart volontaire possible : tarif dégressif, remise, etc.).
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {extendPricingHint?.kind === "ready" ? (
                      <button
                        type="button"
                        disabled={extendBusy}
                        onClick={() => setExtendAmountStr(String(extendPricingHint.suggestedTotal))}
                        className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-[11px] font-medium text-emerald-100/95 transition-colors hover:bg-emerald-500/25 disabled:opacity-40"
                      >
                        Appliquer le total conseillé ({extendPricingHint.suggestedTotal} $)
                      </button>
                    ) : null}
                    <p className="min-w-0 flex-1 text-[10px] text-white/35">
                      Enregistrez le complément dans{" "}
                      <Link to={`/caisse-reception?reservation=${encodeURIComponent(extendTarget.id)}`} className="text-sky-200/90 underline-offset-2 hover:underline">
                        Paiement
                      </Link>
                      .
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={extendBusy}
                    onClick={() => setExtendTarget(null)}
                    className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/70 transition-colors hover:bg-white/10 disabled:opacity-40"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={extendBusy}
                    className="rounded-lg border border-sky-500/40 bg-sky-500/15 px-4 py-2 text-sm font-medium text-sky-100 transition-colors hover:bg-sky-500/25 disabled:opacity-40"
                  >
                    {extendBusy ? "Enregistrement…" : "Enregistrer la prolongation"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
