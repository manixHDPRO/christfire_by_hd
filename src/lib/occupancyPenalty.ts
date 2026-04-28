import type { OccupancyRules, Reservation } from "@/types";
import { addDaysIso } from "@/lib/reservationPricing";

/** Date ISO (UTC) à partir de laquelle la pénalité peut s’appliquer : début du séjour + jours de grâce. */
export function occupancyPenaltyDeadlineIso(start: string, graceDays: number): string {
  return addDaysIso(start, graceDays);
}

/** Réservation « Confirmé » mais pas encore « En cours », sans pénalité enregistrée, après la fin du délai de grâce. */
export function isOccupancyPenaltyApplicable(
  r: Reservation,
  rules: Pick<OccupancyRules, "graceDays" | "penaltyUsd">,
  todayIso: string,
): boolean {
  if (r.status !== "Confirmé") return false;
  if ((r.latePenaltyUsd ?? 0) > 0) return false;
  if (rules.penaltyUsd <= 0 || rules.graceDays < 1) return false;
  return todayIso >= occupancyPenaltyDeadlineIso(r.start, rules.graceDays);
}
