import { db } from "./db.js";
import { bookingChannelLabelFr, normalizeBookingChannel } from "./bookingChannel.js";

const KPI_STATUSES = new Set(["Confirmé", "En cours", "Terminé"]);

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d + days);
  return new Date(t).toISOString().slice(0, 10);
}

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function nightsInStay(start: string, end: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= start) return [];
  const out: string[] = [];
  let cur = start;
  while (cur < end) {
    out.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return out;
}

function eachDateInclusive(from: string, to: string): string[] {
  if (from > to) return [];
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDaysIso(cur, 1);
  }
  return out;
}

function isSellableBungalowStatus(status: string): boolean {
  return status === "Disponible" || status === "Réservé" || status === "Occupé";
}

function loadBungalowIdsForReservation(reservationId: string, fallbackBungalowId: string): string[] {
  const rows = db
    .prepare(
      `SELECT bungalow_id FROM reservation_bungalows WHERE reservation_id = ? ORDER BY sort_order ASC, bungalow_id ASC`,
    )
    .all(reservationId) as { bungalow_id: string }[];
  if (rows.length) return rows.map((r) => r.bungalow_id);
  return [fallbackBungalowId];
}

type BungalowRow = { id: string; category: string; status: string; code: string };

type ReservationCore = {
  id: string;
  client_id: string;
  start_date: string;
  end_date: string;
  status: string;
  amount: number;
  amount_paid: number;
  late_penalty_usd: number;
  booking_channel: string;
  bungalow_id: string;
};

export type ReportsKpisPayload = {
  period: { from: string; to: string; nightsInPeriod: number };
  notes: { occupancyDefinition: string; revenueDefinition: string };
  global: {
    sellableUnits: number;
    availableRoomNights: number;
    soldRoomNights: number;
    occupancyPct: number;
    roomRevenueUsd: number;
    adrUsd: number | null;
    revparUsd: number | null;
  };
  byCategory: Array<{
    category: string;
    availableRoomNights: number;
    soldRoomNights: number;
    occupancyPct: number;
    roomRevenueUsd: number;
    adrUsd: number | null;
    revparUsd: number | null;
  }>;
  byChannel: Array<{
    channel: string;
    channelLabel: string;
    soldRoomNights: number;
    roomRevenueUsd: number;
    reservationCount: number;
  }>;
  debts: {
    totalOutstandingUsd: number;
    reservationCount: number;
    rows: Array<{
      reservationId: string;
      clientId: string;
      clientName: string;
      bungalowCodes: string;
      stayStart: string;
      stayEnd: string;
      status: string;
      balanceUsd: number;
      totalDueUsd: number;
      amountPaidUsd: number;
    }>;
  };
  forecast: {
    onTheBooksNext30Days: {
      from: string;
      to: string;
      availableRoomNights: number;
      soldRoomNights: number;
      occupancyPct: number;
    };
    trailing30Days: {
      from: string;
      to: string;
      occupancyPct: number;
      adrUsd: number | null;
      revparUsd: number | null;
      roomRevenueUsd: number;
      soldRoomNights: number;
      availableRoomNights: number;
    };
    indicativeCommentFr: string;
  };
};

type Agg = {
  availableRoomNights: number;
  soldRoomNights: number;
  roomRevenueUsd: number;
};

function emptyAgg(): Agg {
  return { availableRoomNights: 0, soldRoomNights: 0, roomRevenueUsd: 0 };
}

function finalizeAgg(a: Agg): { occupancyPct: number; adrUsd: number | null; revparUsd: number | null } {
  const occ = a.availableRoomNights > 0 ? Math.round((a.soldRoomNights / a.availableRoomNights) * 1000) / 10 : 0;
  const adr = a.soldRoomNights > 0 ? Math.round(a.roomRevenueUsd / a.soldRoomNights) : null;
  const revpar =
    a.availableRoomNights > 0 ? Math.round((a.roomRevenueUsd / a.availableRoomNights) * 100) / 100 : null;
  return { occupancyPct: occ, adrUsd: adr, revparUsd: revpar };
}

function accumulatePeriod(
  periodFrom: string,
  periodTo: string,
  sellableBungalowIds: string[],
  bungalowById: Map<string, BungalowRow>,
  reservations: ReservationCore[],
  bungalowIdsByResId: Map<string, string[]>,
): { global: Agg; byCategory: Map<string, Agg>; byChannel: Map<string, Agg>; channelResIds: Map<string, Set<string>> } {
  const nights = eachDateInclusive(periodFrom, periodTo);
  const global = emptyAgg();
  const byCategory = new Map<string, Agg>();
  const byChannel = new Map<string, Agg>();
  const channelResIds = new Map<string, Set<string>>();

  const sellableSet = new Set(sellableBungalowIds);
  const D = nights.length;
  global.availableRoomNights = sellableSet.size * D;

  for (const cat of new Set(sellableBungalowIds.map((id) => bungalowById.get(id)?.category ?? "?"))) {
    const unitsInCat = sellableBungalowIds.filter((id) => (bungalowById.get(id)?.category ?? "?") === cat).length;
    if (unitsInCat > 0) {
      byCategory.set(cat, {
        availableRoomNights: unitsInCat * D,
        soldRoomNights: 0,
        roomRevenueUsd: 0,
      });
    }
  }

  for (const res of reservations) {
    if (!KPI_STATUSES.has(res.status)) continue;
    const unitIds = bungalowIdsByResId.get(res.id) ?? [res.bungalow_id];
    const sellableUnits = unitIds.filter((id) => sellableSet.has(id));
    if (sellableUnits.length === 0) continue;

    const stayNights = nightsInStay(res.start_date, res.end_date);
    const totalStayNights = stayNights.length;
    if (totalStayNights < 1) continue;

    const overlapNights = stayNights.filter((n) => n >= periodFrom && n <= periodTo);
    if (overlapNights.length === 0) continue;

    const revenueSliceTotal = Math.round((res.amount * overlapNights.length) / totalStayNights);

    const ch = normalizeBookingChannel(res.booking_channel);
    if (!byChannel.has(ch)) {
      byChannel.set(ch, emptyAgg());
      channelResIds.set(ch, new Set());
    }
    channelResIds.get(ch)!.add(res.id);

    const totalBn = overlapNights.length * sellableUnits.length;
    const base = Math.floor(revenueSliceTotal / totalBn);
    const extra = revenueSliceTotal - base * totalBn;
    let partIdx = 0;
    for (const _n of overlapNights) {
      for (const bungId of sellableUnits) {
        const add = base + (partIdx < extra ? 1 : 0);
        partIdx += 1;
        global.soldRoomNights += 1;
        global.roomRevenueUsd += add;

        const cat = bungalowById.get(bungId)?.category ?? "Standard";
        const catAgg = byCategory.get(cat);
        if (catAgg) {
          catAgg.soldRoomNights += 1;
          catAgg.roomRevenueUsd += add;
        }

        const chAgg = byChannel.get(ch)!;
        chAgg.soldRoomNights += 1;
        chAgg.roomRevenueUsd += add;
      }
    }
  }

  return { global, byCategory, byChannel, channelResIds };
}

export function buildReportsKpis(periodFrom: string, periodTo: string): ReportsKpisPayload {
  const bungalowRows = db
    .prepare(`SELECT id, category, status, code FROM bungalows`)
    .all() as BungalowRow[];
  const bungalowById = new Map(bungalowRows.map((b) => [b.id, b]));
  const sellableBungalowIds = bungalowRows.filter((b) => isSellableBungalowStatus(b.status)).map((b) => b.id);

   const resRows = db
    .prepare(
      `SELECT id, client_id, bungalow_id, start_date, end_date, status, amount,
              COALESCE(amount_paid, 0) AS amount_paid,
              COALESCE(late_penalty_usd, 0) AS late_penalty_usd,
              COALESCE(booking_channel, 'direct') AS booking_channel
       FROM reservations`,
    )
    .all() as ReservationCore[];

  const bungalowIdsByResId = new Map<string, string[]>();
  for (const r of resRows) {
    bungalowIdsByResId.set(r.id, loadBungalowIdsForReservation(r.id, r.bungalow_id));
  }

  const { global, byCategory, byChannel, channelResIds } = accumulatePeriod(
    periodFrom,
    periodTo,
    sellableBungalowIds,
    bungalowById,
    resRows,
    bungalowIdsByResId,
  );

  const catOrder = ["Premium", "Deluxe", "Standard"];
  const byCategoryList = [...byCategory.entries()]
    .sort(([a], [b]) => {
      const ia = catOrder.indexOf(a);
      const ib = catOrder.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b, "fr");
    })
    .map(([category, agg]) => {
      const f = finalizeAgg(agg);
      return {
        category,
        availableRoomNights: agg.availableRoomNights,
        soldRoomNights: agg.soldRoomNights,
        occupancyPct: f.occupancyPct,
        roomRevenueUsd: agg.roomRevenueUsd,
        adrUsd: f.adrUsd,
        revparUsd: f.revparUsd,
      };
    });

  const byChannelList = [...byChannel.entries()]
    .sort((a, b) => b[1].roomRevenueUsd - a[1].roomRevenueUsd)
    .map(([channel, agg]) => ({
      channel,
      channelLabel: bookingChannelLabelFr(channel),
      soldRoomNights: agg.soldRoomNights,
      roomRevenueUsd: agg.roomRevenueUsd,
      reservationCount: channelResIds.get(channel)?.size ?? 0,
    }));

  const g = finalizeAgg(global);

  const debtRows = db
    .prepare(
      `SELECT r.id AS reservation_id, r.client_id, c.name AS client_name,
              r.start_date, r.end_date, r.status, r.amount,
              COALESCE(r.amount_paid, 0) AS amount_paid,
              COALESCE(r.late_penalty_usd, 0) AS late_penalty_usd,
              r.bungalow_id
       FROM reservations r
       JOIN clients c ON c.id = r.client_id
       WHERE (r.amount + COALESCE(r.late_penalty_usd, 0) - COALESCE(r.amount_paid, 0)) > 0
       ORDER BY (r.amount + COALESCE(r.late_penalty_usd, 0) - COALESCE(r.amount_paid, 0)) DESC
       LIMIT 80`,
    )
    .all() as Array<{
      reservation_id: string;
      client_id: string;
      client_name: string;
      start_date: string;
      end_date: string;
      status: string;
      amount: number;
      amount_paid: number;
      late_penalty_usd: number;
      bungalow_id: string;
    }>;

  const debts = {
    totalOutstandingUsd: 0,
    reservationCount: 0,
    rows: [] as ReportsKpisPayload["debts"]["rows"],
  };

  for (const row of debtRows) {
    const totalDue = row.amount + row.late_penalty_usd;
    const balance = totalDue - row.amount_paid;
    if (balance <= 0) continue;
    debts.totalOutstandingUsd += balance;
    debts.reservationCount += 1;
    const ids = loadBungalowIdsForReservation(row.reservation_id, row.bungalow_id);
    const codes = ids.map((id) => bungalowById.get(id)?.code ?? id).join(", ");
    debts.rows.push({
      reservationId: row.reservation_id,
      clientId: row.client_id,
      clientName: row.client_name,
      bungalowCodes: codes,
      stayStart: row.start_date,
      stayEnd: row.end_date,
      status: row.status,
      balanceUsd: balance,
      totalDueUsd: totalDue,
      amountPaidUsd: row.amount_paid,
    });
  }

  const today = todayIsoUtc();
  const next30End = addDaysIso(today, 29);
  const trailStart = addDaysIso(today, -30);

  const fut = accumulatePeriod(today, next30End, sellableBungalowIds, bungalowById, resRows, bungalowIdsByResId);
  const trail = accumulatePeriod(trailStart, addDaysIso(today, -1), sellableBungalowIds, bungalowById, resRows, bungalowIdsByResId);
  const futF = finalizeAgg(fut.global);
  const trailF = finalizeAgg(trail.global);

  const nightsInPeriod = eachDateInclusive(periodFrom, periodTo).length;

  return {
    period: { from: periodFrom, to: periodTo, nightsInPeriod },
    notes: {
      occupancyDefinition:
        "Nuitées vendues (statuts Confirmé, En cours, Terminé) / nuitées disponibles (bungalows exploitables × jours de la période). Les statuts « En attente paiement » et « No-show » sont exclus.",
      revenueDefinition:
        "Chiffre d’hébergement : montant du séjour (USD) réparti sur les nuitées, proratisé sur la période. Les pénalités retard d’occupation ne sont pas incluses dans l’ADR / RevPAR.",
    },
    global: {
      sellableUnits: sellableBungalowIds.length,
      availableRoomNights: global.availableRoomNights,
      soldRoomNights: global.soldRoomNights,
      occupancyPct: g.occupancyPct,
      roomRevenueUsd: global.roomRevenueUsd,
      adrUsd: g.adrUsd,
      revparUsd: g.revparUsd,
    },
    byCategory: byCategoryList,
    byChannel: byChannelList,
    debts,
    forecast: {
      onTheBooksNext30Days: {
        from: today,
        to: next30End,
        availableRoomNights: fut.global.availableRoomNights,
        soldRoomNights: fut.global.soldRoomNights,
        occupancyPct: futF.occupancyPct,
      },
      trailing30Days: {
        from: trailStart,
        to: addDaysIso(today, -1),
        occupancyPct: trailF.occupancyPct,
        adrUsd: trailF.adrUsd,
        revparUsd: trailF.revparUsd,
        roomRevenueUsd: trail.global.roomRevenueUsd,
        soldRoomNights: trail.global.soldRoomNights,
        availableRoomNights: trail.global.availableRoomNights,
      },
      indicativeCommentFr:
        "Indicateurs indicatifs : « Réservé J+30 » = nuitées déjà vendues sur les 30 prochains jours (réservations confirmées ou en cours / terminées couvrant cette fenêtre). La fenêtre « 30 jours glissants » précédente sert de repère de rythme ; ce n’est pas une prévision statistique.",
    },
  };
}
