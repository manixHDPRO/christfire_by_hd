import type { LoginFailureCode } from "@/auth/loginCodes";
import type {
  AccountingDayClosure,
  AppUserRole,
  AuditLogEntry,
  AdminActiveSession,
  AuthSessionInfo,
  AuthUser,
  Bungalow,
  BungalowCategoryRow,
  CategoryRate,
  Client,
  ClientProfileType,
  CounterSale,
  FinanceCashAccount,
  FinanceCashMovement,
  FinanceCashMovementCategory,
  MaintenanceTicket,
  NightAuditSummary,
  MaintenanceTicketAttachment,
  MaintenanceTicketEvent,
  OperationalWorkflow,
  OperationalWorkflowListItem,
  OccupancyRules,
  PermissionCatalogEntry,
  PurchaseOrderDetail,
  PurchaseOrderEligibleForReceipt,
  PurchaseOrderListRow,
  StockArticleRef,
  StockArticleRefRow,
  StockArticleSubcategoryRow,
  InventoryArticleRefs,
  StockBalanceRow,
  StockDashboardAlert,
  StockDocument,
  StockDepotSetting,
  StockItem,
  StockLocation,
  StockReorderPolicyRow,
  StockSupplier,
  StockToOrderLine,
  BookingChannel,
  ReportsKpisPayload,
  ReservationKind,
  Reservation,
  ReservationPaymentLedgerRow,
  ReservationPaymentMethod,
  ReservationStatus,
  SystemUser,
  ReceptionCashRegisterSituation,
  ReceptionRegisterReport,
  TreasuryCashDayToday,
  CounterCashRegisterSituation,
  TreasuryOverviewPayload,
  TreasuryRegisterReport,
  UserInvitationPending,
  UserRole,
  VisitorEntryPaymentLedgerRow,
  PaymentCurrencyCode,
} from "@/types";

const BASE = import.meta.env.VITE_API_BASE ?? "";

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${BASE}${p}`;
}

async function parseJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function normalizeAuthUser(u: AuthUser): AuthUser {
  return {
    ...u,
    permissions: Array.isArray(u.permissions) ? u.permissions : [],
  };
}

export async function apiGetMe(): Promise<AuthUser | null> {
  const res = await fetch(apiUrl("/api/auth/me"), { credentials: "include" });
  if (!res.ok) return null;
  const data = await parseJson<{ user: AuthUser }>(res);
  return data?.user ? normalizeAuthUser(data.user) : null;
}

/**
 * Rafraîchissement de session sans « casser » l’UI si l’API est temporairement indisponible.
 * - `null` =401, session invalide (déconnexion)
 * - `undefined` = erreur réseau / 5xx (conserver l’utilisateur affiché)
 * - sinon utilisateur à jour
 */
export async function apiRefreshSession(): Promise<AuthUser | null | undefined> {
  try {
    const res = await fetch(apiUrl("/api/auth/me"), { credentials: "include" });
    if (res.status === 401) return null;
    if (!res.ok) return undefined;
    const data = await parseJson<{ user: AuthUser }>(res);
    return data?.user ? normalizeAuthUser(data.user) : undefined;
  } catch {
    return undefined;
  }
}

export async function apiLogin(
  email: string,
  password: string,
  totpCode?: string,
): Promise<{ ok: true; user: AuthUser } | { ok: false; code: LoginFailureCode }> {
  try {
    const res = await fetch(apiUrl("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        email,
        password,
        ...(totpCode != null && totpCode.trim() !== "" ? { totpCode: totpCode.trim() } : {}),
      }),
    });
    const data = await parseJson<{ user?: AuthUser; code?: string }>(res);
    if (!res.ok) {
      const code = data?.code;
      if (code === "inactive" || code === "invalid_credentials") {
        return { ok: false, code };
      }
      if (res.status === 403 && code === "2fa_required") {
        return { ok: false, code: "2fa_required" };
      }
      if (code === "invalid_totp") {
        return { ok: false, code: "invalid_totp" };
      }
      return { ok: false, code: "invalid_credentials" };
    }
    if (!data?.user) return { ok: false, code: "invalid_credentials" };
    return { ok: true, user: normalizeAuthUser(data.user) };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiLogout(): Promise<void> {
  try {
    await fetch(apiUrl("/api/auth/logout"), { method: "POST", credentials: "include" });
  } catch {
    /* déconnexion locale même si le réseau échoue */
  }
}

export async function apiListAuthSessions(): Promise<AuthSessionInfo[] | null> {
  try {
    const res = await fetch(apiUrl("/api/auth/sessions"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ sessions: AuthSessionInfo[] }>(res);
    return data?.sessions ?? null;
  } catch {
    return null;
  }
}

export async function apiRevokeAuthSession(
  sessionId: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/auth/sessions/${encodeURIComponent(sessionId)}`), {
      method: "DELETE",
      credentials: "include",
    });
    if (res.status === 204) return { ok: true };
    const data = await parseJson<{ code?: string }>(res);
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiRevokeOtherAuthSessions(): Promise<{ ok: true; revoked: number } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/auth/sessions/revoke-others"), {
      method: "POST",
      credentials: "include",
    });
    const data = await parseJson<{ revoked?: number; code?: string }>(res);
    if (!res.ok) return { ok: false, code: data?.code ?? "error" };
    return { ok: true, revoked: data?.revoked ?? 0 };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiStart2faSetup(): Promise<
  { ok: true; secret: string; otpauthUrl: string } | { ok: false; code: string }
> {
  try {
    const res = await fetch(apiUrl("/api/auth/2fa/setup-start"), {
      method: "POST",
      credentials: "include",
    });
    const data = await parseJson<{ secret?: string; otpauthUrl?: string; code?: string }>(res);
    if (!res.ok || !data?.secret || !data?.otpauthUrl) return { ok: false, code: data?.code ?? "error" };
    return { ok: true, secret: data.secret, otpauthUrl: data.otpauthUrl };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiVerify2faSetup(
  code: string,
): Promise<{ ok: true; user: AuthUser } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/auth/2fa/setup-verify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code }),
    });
    const data = await parseJson<{ user?: AuthUser; code?: string }>(res);
    if (!res.ok || !data?.user) return { ok: false, code: data?.code ?? "error" };
    return { ok: true, user: normalizeAuthUser(data.user) };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiCancel2faSetup(): Promise<void> {
  try {
    await fetch(apiUrl("/api/auth/2fa/setup-cancel"), { method: "POST", credentials: "include" });
  } catch {
    /* noop */
  }
}

export async function apiDisable2fa(
  password: string,
  totpCode: string,
): Promise<{ ok: true; user: AuthUser } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/auth/2fa/disable"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ password, totpCode }),
    });
    const data = await parseJson<{ user?: AuthUser; code?: string }>(res);
    if (!res.ok || !data?.user) return { ok: false, code: data?.code ?? "error" };
    return { ok: true, user: normalizeAuthUser(data.user) };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiListClients(): Promise<Client[] | null> {
  try {
    const res = await fetch(apiUrl("/api/clients"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ clients: Client[] }>(res);
    return data?.clients ?? null;
  } catch {
    return null;
  }
}

export async function apiGetClient(id: string): Promise<Client | null> {
  try {
    const res = await fetch(apiUrl(`/api/clients/${encodeURIComponent(id)}`), { credentials: "include" });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = await parseJson<{ client: Client }>(res);
    return data?.client ?? null;
  } catch {
    return null;
  }
}

/** Journal d’encaissements droit d’entrée pour une fiche client. */
export async function apiGetVisitorEntryPaymentsForClient(
  clientId: string,
): Promise<VisitorEntryPaymentLedgerRow[] | null> {
  try {
    const res = await fetch(
      apiUrl(`/api/clients/${encodeURIComponent(clientId)}/visitor-entry-payments`),
      { credentials: "include" },
    );
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = await parseJson<{ payments?: VisitorEntryPaymentLedgerRow[] }>(res);
    return Array.isArray(data?.payments) ? data.payments : [];
  } catch {
    return null;
  }
}

/** Tout le journal d’encaissements visiteurs (facturation globale). */
export async function apiGetVisitorEntryPaymentsLedger(): Promise<VisitorEntryPaymentLedgerRow[] | null> {
  try {
    const res = await fetch(apiUrl("/api/clients/visitor-entry-payments-ledger"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ payments?: VisitorEntryPaymentLedgerRow[] }>(res);
    return Array.isArray(data?.payments) ? data.payments : [];
  } catch {
    return null;
  }
}

/** Encaissement du droit d’entrée visiteur (client profil avec frais d’entrée). */
export async function apiPostVisitorEntryFeePayment(
  clientId: string,
  body: {
    amount: number;
    currency?: PaymentCurrencyCode;
    method?: ReservationPaymentMethod;
    note?: string;
  },
): Promise<{ ok: true; client: Client } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/clients/${encodeURIComponent(clientId)}/visitor-entry-payment`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        amount: body.amount,
        currency: body.currency ?? "USD",
        method: body.method ?? "Espèces",
        note: body.note ?? "",
      }),
    });
    const data = await parseJson<{ client?: Client; code?: string }>(res);
    if (res.status === 200 && data?.client) return { ok: true, client: data.client };
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 400 && data?.code === "not_visitor_profile") return { ok: false, code: "not_visitor_profile" };
    if (res.status === 400 && data?.code === "already_paid") return { ok: false, code: "already_paid" };
    if (res.status === 400 && data?.code === "no_entry_fee") return { ok: false, code: "no_entry_fee" };
    if (res.status === 400 && data?.code === "cdf_amount_too_small") return { ok: false, code: "cdf_amount_too_small" };
    if (res.status === 400 && data?.code === "amount_exceeds_balance") return { ok: false, code: "amount_exceeds_balance" };
    if (res.status === 400) return { ok: false, code: data?.code ?? "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    if (res.status === 403) return { ok: false, code: data?.code ?? "forbidden" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiListBungalows(): Promise<Bungalow[] | null> {
  try {
    const res = await fetch(apiUrl("/api/bungalows"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ bungalows: Bungalow[] }>(res);
    return data?.bungalows ?? null;
  } catch {
    return null;
  }
}

export async function apiGetBungalow(id: string): Promise<Bungalow | null> {
  try {
    const res = await fetch(apiUrl(`/api/bungalows/${encodeURIComponent(id)}`), { credentials: "include" });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = await parseJson<{ bungalow: Bungalow }>(res);
    return data?.bungalow ?? null;
  } catch {
    return null;
  }
}

export async function apiListReservations(): Promise<Reservation[] | null> {
  try {
    const res = await fetch(apiUrl("/api/reservations"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ reservations: Reservation[] }>(res);
    return data?.reservations ?? null;
  } catch {
    return null;
  }
}

export async function apiGetReportsKpis(from: string, to: string): Promise<ReportsKpisPayload | null> {
  try {
    const q = new URLSearchParams({ from, to });
    const res = await fetch(apiUrl(`/api/reports/kpis?${q}`), { credentials: "include" });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) return null;
    return (await res.json()) as ReportsKpisPayload;
  } catch {
    return null;
  }
}

/** Prolonger un séjour : nouvelle date de fin (après l’actuelle) + montant total du séjour mis à jour. */
export async function apiPatchReservationStay(
  id: string,
  body: { end: string; amount: number },
): Promise<{ ok: true; reservation: Reservation } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/reservations/${encodeURIComponent(id)}/stay`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ reservation?: Reservation; code?: string }>(res);
    if (res.status === 200 && data?.reservation) return { ok: true, reservation: data.reservation };
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 409) return { ok: false, code: data?.code ?? "bungalow_overlap" };
    if (res.status === 400) return { ok: false, code: data?.code ?? "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiUpdateReservation(
  id: string,
  body: UpdateReservationInput,
): Promise<{ ok: true; reservation: Reservation } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/reservations/${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ reservation?: Reservation; code?: string }>(res);
    if (res.status === 200 && data?.reservation) return { ok: true, reservation: data.reservation };
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 400 && data?.code === "confirm_requires_payment")
      return { ok: false, code: "confirm_requires_payment" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiApplyReservationOccupancyPenalty(
  id: string,
): Promise<{ ok: true; reservation: Reservation } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/reservations/${encodeURIComponent(id)}/occupancy-penalty`), {
      method: "POST",
      credentials: "include",
    });
    const data = await parseJson<{ reservation?: Reservation; code?: string }>(res);
    if (res.status === 200 && data?.reservation) return { ok: true, reservation: data.reservation };
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 400) return { ok: false, code: data?.code ?? "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiListPayments(): Promise<ReservationPaymentLedgerRow[] | null> {
  try {
    const res = await fetch(apiUrl("/api/payments"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ payments?: ReservationPaymentLedgerRow[] }>(res);
    return Array.isArray(data?.payments) ? data.payments : null;
  } catch {
    return null;
  }
}

export type CounterSalePointOfSale = {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  isMain: boolean;
};

export async function apiListCounterSalePoints(): Promise<CounterSalePointOfSale[] | null> {
  try {
    const res = await fetch(apiUrl("/api/counter-sales/points-of-sale"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ pointsOfSale?: CounterSalePointOfSale[] }>(res);
    return Array.isArray(data?.pointsOfSale) ? data.pointsOfSale : null;
  } catch {
    return null;
  }
}

export async function apiListCounterSales(params?: {
  from?: string;
  to?: string;
}): Promise<CounterSale[] | null> {
  try {
    const q = new URLSearchParams();
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    const res = await fetch(apiUrl(`/api/counter-sales${suffix}`), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ sales?: CounterSale[] }>(res);
    if (!Array.isArray(data?.sales)) return null;
    return data.sales.map((s) => ({
      ...s,
      pointOfSaleId: s.pointOfSaleId ?? null,
      pointOfSaleLabel: s.pointOfSaleLabel ?? null,
    }));
  } catch {
    return null;
  }
}

export async function apiGetNightAuditSummary(date: string): Promise<NightAuditSummary | null> {
  try {
    const q = new URLSearchParams({ date });
    const res = await fetch(apiUrl(`/api/night-audit/summary?${q}`), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<NightAuditSummary>(res);
    return data ?? null;
  } catch {
    return null;
  }
}

export async function apiListAccountingClosures(): Promise<AccountingDayClosure[] | null> {
  try {
    const res = await fetch(apiUrl("/api/night-audit/closures"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ closures?: AccountingDayClosure[] }>(res);
    return Array.isArray(data?.closures) ? data.closures : null;
  } catch {
    return null;
  }
}

export async function apiCloseAccountingDay(body: {
  businessDate: string;
  notes?: string;
  countedCashUsd?: number;
  countedCashCdf?: number;
}): Promise<
  | { ok: true; closure: AccountingDayClosure }
  | { ok: false; code: string }
> {
  try {
    const res = await fetch(apiUrl("/api/night-audit/close"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ closure?: AccountingDayClosure; code?: string }>(res);
    if (res.status === 201 && data?.closure) return { ok: true, closure: data.closure };
    if (res.status === 409) return { ok: false, code: data?.code ?? "already_closed" };
    if (res.status === 400) return { ok: false, code: data?.code ?? "validation_error" };
    if (res.status === 403) return { ok: false, code: "forbidden" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export function nightAuditExportUrl(date: string, format: "csv" | "json"): string {
  const q = new URLSearchParams({ date, format });
  return apiUrl(`/api/night-audit/export?${q}`);
}

export type CreateCounterSaleInput = {
  amountCdf: number;
  method?: ReservationPaymentMethod;
  label?: string;
  note?: string;
  clientId?: string;
  pointOfSaleId?: string;
};

export async function apiCreateCounterSale(
  body: CreateCounterSaleInput,
): Promise<{ ok: true; sale: CounterSale } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/counter-sales"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ sale?: CounterSale; code?: string }>(res);
    if (res.status === 201 && data?.sale) return { ok: true, sale: data.sale };
    if (res.status === 400 && data?.code === "unknown_client") return { ok: false, code: "unknown_client" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    if (res.status === 403) return { ok: false, code: data?.code ?? "forbidden" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

function normalizeTreasuryRegisterReport(r: TreasuryRegisterReport): TreasuryRegisterReport {
  return {
    ...r,
    status: r.status === "validated" ? "validated" : "submitted",
    validatedAt: r.validatedAt ?? null,
    validatedByUserId: r.validatedByUserId ?? null,
    validatedByName: r.validatedByName ?? null,
    cashBookMovementId: r.cashBookMovementId ?? null,
    notesTreasury: typeof r.notesTreasury === "string" ? r.notesTreasury : "",
  };
}

function normalizeReceptionRegisterReport(r: ReceptionRegisterReport): ReceptionRegisterReport {
  return {
    ...r,
    reportOwnerUserId: typeof r.reportOwnerUserId === "string" ? r.reportOwnerUserId : r.submittedByUserId ?? "",
    status: r.status === "validated" ? "validated" : "submitted",
    validatedAt: r.validatedAt ?? null,
    validatedByUserId: r.validatedByUserId ?? null,
    validatedByName: r.validatedByName ?? null,
    cashBookMovementId: r.cashBookMovementId ?? null,
    notesTreasury: typeof r.notesTreasury === "string" ? r.notesTreasury : "",
  };
}

export async function apiTreasuryOverview(params: {
  from: string;
  to: string;
}): Promise<TreasuryOverviewPayload | null> {
  try {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    const res = await fetch(apiUrl(`/api/treasury/overview?${q}`), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<TreasuryOverviewPayload>(res);
    if (!data?.from || !data?.to || !Array.isArray(data.counterRollup) || !Array.isArray(data.registerReports)) {
      return null;
    }
    const receptionRegisterReports = Array.isArray(data.receptionRegisterReports)
      ? data.receptionRegisterReports.map(normalizeReceptionRegisterReport)
      : [];
    let cashDayToday: TreasuryCashDayToday | undefined;
    const rawCd = data.cashDayToday;
    if (
      rawCd &&
      typeof rawCd.businessDate === "string" &&
      typeof rawCd.opened === "boolean"
    ) {
      cashDayToday = {
        businessDate: rawCd.businessDate,
        opened: rawCd.opened,
        openedAt: rawCd.openedAt ?? null,
        openedByName: rawCd.openedByName ?? null,
        ...(typeof rawCd.receptionOpeningFloatUsd === "number"
          ? { receptionOpeningFloatUsd: rawCd.receptionOpeningFloatUsd }
          : {}),
        ...(Array.isArray(rawCd.counterTreasuryOpenings)
          ? { counterTreasuryOpenings: rawCd.counterTreasuryOpenings }
          : {}),
      };
    }
    return {
      ...data,
      registerReports: data.registerReports.map(normalizeTreasuryRegisterReport),
      receptionRegisterReports,
      cashDayToday,
    };
  } catch {
    return null;
  }
}

export async function apiGetTreasuryCashDayStatus(date?: string): Promise<TreasuryCashDayToday | null> {
  try {
    const q = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `?date=${encodeURIComponent(date)}` : "";
    const res = await fetch(apiUrl(`/api/treasury/cash-day-status${q}`), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<TreasuryCashDayToday>(res);
    if (!data?.businessDate || typeof data.opened !== "boolean") return null;
    return {
      businessDate: data.businessDate,
      opened: data.opened,
      openedAt: data.openedAt ?? null,
      openedByName: data.openedByName ?? null,
      ...(typeof data.receptionOpeningFloatUsd === "number"
        ? { receptionOpeningFloatUsd: data.receptionOpeningFloatUsd }
        : {}),
      ...(Array.isArray(data.counterTreasuryOpenings)
        ? {
            counterTreasuryOpenings: data.counterTreasuryOpenings as TreasuryCashDayToday["counterTreasuryOpenings"],
          }
        : {}),
    };
  } catch {
    return null;
  }
}

export async function apiGetReceptionCashRegisterSituation(date: string): Promise<
  { ok: true; situation: ReceptionCashRegisterSituation } | { ok: false; code: string }
> {
  try {
    const q = new URLSearchParams({ date });
    const res = await fetch(apiUrl(`/api/treasury/cash-register-situation/reception?${q}`), {
      credentials: "include",
    });
    const data = await parseJson<ReceptionCashRegisterSituation & { code?: string }>(res);
    if (res.ok && data && typeof data.systemCashSalesUsd === "number" && data.businessDate) {
      return {
        ok: true,
        situation: {
          businessDate: data.businessDate,
          reservationPaymentsCashUsd: data.reservationPaymentsCashUsd ?? 0,
          visitorEntryCashUsd: data.visitorEntryCashUsd ?? 0,
          systemCashSalesUsd: data.systemCashSalesUsd,
          treasuryOpeningFloatUsd:
            typeof data.treasuryOpeningFloatUsd === "number" ? data.treasuryOpeningFloatUsd : undefined,
        },
      };
    }
    if (res.status === 403) return { ok: false, code: data?.code ?? "cash_day_not_opened" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiGetCounterCashRegisterSituation(
  date: string,
  pointOfSaleId: string,
): Promise<{ ok: true; situation: CounterCashRegisterSituation } | { ok: false; code: string }> {
  try {
    const q = new URLSearchParams({ date, pointOfSaleId });
    const res = await fetch(apiUrl(`/api/treasury/cash-register-situation/counter?${q}`), {
      credentials: "include",
    });
    const data = await parseJson<CounterCashRegisterSituation & { code?: string }>(res);
    if (
      res.ok &&
      data &&
      typeof data.systemCashSalesCdf === "number" &&
      data.businessDate &&
      data.pointOfSaleId
    ) {
      return {
        ok: true,
        situation: {
          businessDate: data.businessDate,
          pointOfSaleId: data.pointOfSaleId,
          pointOfSaleLabel: typeof data.pointOfSaleLabel === "string" ? data.pointOfSaleLabel : "",
          systemCashSalesCdf: data.systemCashSalesCdf,
          totalSalesCdf: data.totalSalesCdf ?? 0,
          saleCount: data.saleCount ?? 0,
          treasuryOpeningFloatCdf:
            typeof data.treasuryOpeningFloatCdf === "number" ? data.treasuryOpeningFloatCdf : null,
        },
      };
    }
    if (res.status === 403) return { ok: false, code: data?.code ?? "forbidden" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    if (res.status === 400) return { ok: false, code: data?.code ?? "validation_error" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiOpenTreasuryCashDay(body?: {
  businessDate?: string;
  notes?: string;
  receptionOpeningFloatUsd?: number;
  counterOpenings?: { pointOfSaleId: string; openingFloatCdf: number }[];
}): Promise<
  | {
      ok: true;
      businessDate: string;
      alreadyOpen: boolean;
      openedAt: string;
      openedByName: string | null;
    }
  | { ok: false; code: string }
> {
  try {
    const res = await fetch(apiUrl("/api/treasury/cash-day-openings"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body ?? {}),
    });
    const data = await parseJson<{
      businessDate?: string;
      alreadyOpen?: boolean;
      openedAt?: string;
      openedByName?: string | null;
      code?: string;
    }>(res);
    if ((res.status === 201 || res.status === 200) && data?.businessDate && data.openedAt) {
      return {
        ok: true,
        businessDate: data.businessDate,
        alreadyOpen: data.alreadyOpen === true,
        openedAt: data.openedAt,
        openedByName: data.openedByName ?? null,
      };
    }
    if (res.status === 400) return { ok: false, code: data?.code ?? "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    if (res.status === 403) return { ok: false, code: data?.code ?? "forbidden" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

/** Met à jour les fonds d’ouverture pour une journée caisse déjà ouverte (trésorerie). */
export async function apiPatchTreasuryCashDayOpenings(body: {
  businessDate: string;
  receptionOpeningFloatUsd: number;
  counterOpenings: { pointOfSaleId: string; openingFloatCdf: number }[];
}): Promise<
  | {
      ok: true;
      businessDate: string;
      receptionOpeningFloatUsd: number;
      counterTreasuryOpenings: { pointOfSaleId: string; pointOfSaleLabel: string; openingFloatCdf: number }[];
    }
  | { ok: false; code: string }
> {
  try {
    const res = await fetch(apiUrl("/api/treasury/cash-day-openings"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{
      businessDate?: string;
      receptionOpeningFloatUsd?: number;
      counterTreasuryOpenings?: { pointOfSaleId: string; pointOfSaleLabel: string; openingFloatCdf: number }[];
      code?: string;
    }>(res);
    if (
      res.ok &&
      data?.businessDate &&
      typeof data.receptionOpeningFloatUsd === "number" &&
      Array.isArray(data.counterTreasuryOpenings)
    ) {
      return {
        ok: true,
        businessDate: data.businessDate,
        receptionOpeningFloatUsd: data.receptionOpeningFloatUsd,
        counterTreasuryOpenings: data.counterTreasuryOpenings,
      };
    }
    if (res.status === 404) return { ok: false, code: data?.code ?? "cash_day_not_opened" };
    if (res.status === 400) return { ok: false, code: data?.code ?? "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    if (res.status === 403) return { ok: false, code: data?.code ?? "forbidden" };
    if (res.status === 500) return { ok: false, code: data?.code ?? "update_failed" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiListFinanceCashAccounts(): Promise<FinanceCashAccount[] | null> {
  try {
    const res = await fetch(apiUrl("/api/finance-cash/accounts"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ accounts?: FinanceCashAccount[] }>(res);
    return Array.isArray(data?.accounts) ? data.accounts : null;
  } catch {
    return null;
  }
}

export async function apiCreateFinanceCashAccount(body: {
  label: string;
  kind: "physical" | "bank";
  currency?: "CDF" | "USD";
  code?: string;
}): Promise<{ ok: true; account: FinanceCashAccount | null } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/finance-cash/accounts"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ account?: FinanceCashAccount | null; code?: string }>(res);
    if (res.status === 201) return { ok: true, account: data?.account ?? null };
    if (res.status === 409) return { ok: false, code: data?.code ?? "code_exists" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiListFinanceCashMovements(params?: {
  from?: string;
  to?: string;
  accountId?: string;
}): Promise<FinanceCashMovement[] | null> {
  try {
    const q = new URLSearchParams();
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.accountId) q.set("accountId", params.accountId);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    const res = await fetch(apiUrl(`/api/finance-cash/movements${suffix}`), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ movements?: FinanceCashMovement[] }>(res);
    return Array.isArray(data?.movements) ? data.movements : null;
  } catch {
    return null;
  }
}

export async function apiCreateFinanceCashMovement(body: {
  category: FinanceCashMovementCategory;
  occurredAt: string;
  sourceAccountId?: string | null;
  targetAccountId?: string | null;
  amount: number;
  currency?: "CDF" | "USD";
  label: string;
  note?: string;
}): Promise<{ ok: true; movement: FinanceCashMovement } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/finance-cash/movements"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ movement?: FinanceCashMovement; code?: string }>(res);
    if (res.status === 201 && data?.movement) return { ok: true, movement: data.movement };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiSubmitTreasuryRegisterReport(body: {
  pointOfSaleId: string;
  reportDate: string;
  openingFloatCdf: number;
  countedCashCdf: number;
  notesCashier?: string;
}): Promise<{ ok: true; report: TreasuryRegisterReport } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/treasury/register-reports"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ report?: TreasuryRegisterReport; code?: string }>(res);
    if (res.status === 201 && data?.report) {
      return { ok: true, report: normalizeTreasuryRegisterReport(data.report) };
    }
    if (res.status === 400 && data?.code === "unknown_point_of_sale") {
      return { ok: false, code: "unknown_point_of_sale" };
    }
    if (res.status === 409 && data?.code === "report_already_validated") {
      return { ok: false, code: "report_already_validated" };
    }
    if (res.status === 400) return { ok: false, code: data?.code ?? "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    if (res.status === 403) return { ok: false, code: data?.code ?? "forbidden" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export type TreasuryRemittanceAccount = {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
};

export async function apiTreasuryRemittanceAccounts(params?: {
  currency?: "CDF" | "USD";
}): Promise<TreasuryRemittanceAccount[] | null> {
  try {
    const q = new URLSearchParams();
    if (params?.currency) q.set("currency", params.currency);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    const res = await fetch(apiUrl(`/api/treasury/cash-remittance-accounts${suffix}`), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ accounts?: TreasuryRemittanceAccount[] }>(res);
    return Array.isArray(data?.accounts) ? data.accounts : null;
  } catch {
    return null;
  }
}

export async function apiSubmitReceptionRegisterReport(body: {
  reportDate: string;
  openingFloatUsd: number;
  countedCashUsd: number;
  notesCashier?: string;
}): Promise<{ ok: true; report: ReceptionRegisterReport } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/treasury/reception-register-reports"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ report?: ReceptionRegisterReport; code?: string }>(res);
    if (res.status === 201 && data?.report) {
      return { ok: true, report: normalizeReceptionRegisterReport(data.report) };
    }
    if (res.status === 409 && data?.code === "report_already_validated") {
      return { ok: false, code: "report_already_validated" };
    }
    if (res.status === 400) return { ok: false, code: data?.code ?? "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    if (res.status === 403) return { ok: false, code: data?.code ?? "forbidden" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiValidateTreasuryRegisterReport(
  reportId: string,
  body?: {
    targetAccountId?: string;
    amountCdf?: number;
    notesTreasury?: string;
  },
): Promise<{ ok: true; report: TreasuryRegisterReport } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/treasury/register-reports/${encodeURIComponent(reportId)}/validate`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body ?? {}),
    });
    const data = await parseJson<{ report?: TreasuryRegisterReport; code?: string }>(res);
    if (res.status === 200 && data?.report) {
      return { ok: true, report: normalizeTreasuryRegisterReport(data.report) };
    }
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 409) return { ok: false, code: data?.code ?? "already_validated" };
    if (res.status === 400 && data?.code === "no_cash_account") return { ok: false, code: "no_cash_account" };
    if (res.status === 400 && data?.code === "unknown_account") return { ok: false, code: "unknown_account" };
    if (res.status === 400) return { ok: false, code: data?.code ?? "validation_error" };
    if (res.status === 403) return { ok: false, code: "forbidden" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiValidateReceptionRegisterReport(
  reportId: string,
  body?: {
    targetAccountId?: string;
    amountUsd?: number;
    notesTreasury?: string;
  },
): Promise<{ ok: true; report: ReceptionRegisterReport } | { ok: false; code: string }> {
  try {
    const res = await fetch(
      apiUrl(`/api/treasury/reception-register-reports/${encodeURIComponent(reportId)}/validate`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body ?? {}),
      },
    );
    const data = await parseJson<{ report?: ReceptionRegisterReport; code?: string }>(res);
    if (res.status === 200 && data?.report) {
      return { ok: true, report: normalizeReceptionRegisterReport(data.report) };
    }
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 409) return { ok: false, code: data?.code ?? "already_validated" };
    if (res.status === 400 && data?.code === "no_cash_account") return { ok: false, code: "no_cash_account" };
    if (res.status === 400 && data?.code === "unknown_account") return { ok: false, code: "unknown_account" };
    if (res.status === 400) return { ok: false, code: data?.code ?? "validation_error" };
    if (res.status === 403) return { ok: false, code: "forbidden" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

/** Point de vente (caisse comptoir) — liste complète pour la trésorerie (y compris inactifs). */
export type TreasuryPointOfSale = {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  isMain: boolean;
  active: boolean;
  stockLocationId: string;
  stockLocationLabel: string;
};

export async function apiListTreasuryPointsOfSale(): Promise<TreasuryPointOfSale[] | null> {
  try {
    const res = await fetch(apiUrl("/api/treasury/points-of-sale"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ pointsOfSale?: TreasuryPointOfSale[] }>(res);
    return Array.isArray(data?.pointsOfSale) ? data.pointsOfSale : null;
  } catch {
    return null;
  }
}

export async function apiCreateTreasuryPointOfSale(body: {
  code: string;
  label: string;
  sortOrder?: number;
  isMain?: boolean;
}): Promise<{ ok: true; pointOfSale: TreasuryPointOfSale } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/treasury/points-of-sale"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ pointOfSale?: TreasuryPointOfSale; code?: string }>(res);
    if (res.status === 201 && data?.pointOfSale) return { ok: true, pointOfSale: data.pointOfSale };
    if (res.status === 409) return { ok: false, code: data?.code ?? "code_exists" };
    if (res.status === 400) return { ok: false, code: data?.code ?? "validation_error" };
    if (res.status === 403) return { ok: false, code: "forbidden" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiUpdateTreasuryPointOfSale(
  id: string,
  body: Partial<{
    code: string;
    label: string;
    sortOrder: number;
    active: boolean;
    isMain: boolean;
  }>,
): Promise<{ ok: true; pointOfSale: TreasuryPointOfSale } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/treasury/points-of-sale/${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ pointOfSale?: TreasuryPointOfSale; code?: string }>(res);
    if (res.status === 200 && data?.pointOfSale) return { ok: true, pointOfSale: data.pointOfSale };
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 409) return { ok: false, code: data?.code ?? "code_exists" };
    if (res.status === 400) return { ok: false, code: data?.code ?? "validation_error" };
    if (res.status === 403) return { ok: false, code: "forbidden" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export type CreatePaymentInput = {
  reservationId: string;
  amount: number;
  currency?: PaymentCurrencyCode;
  method?: ReservationPaymentMethod;
  note?: string;
};

export async function apiCreatePayment(
  body: CreatePaymentInput,
): Promise<
  | {
      ok: true;
      payment: ReservationPaymentLedgerRow | null;
      reservation: { id: string; amountPaid: number; status: ReservationStatus };
    }
  | { ok: false; code: string }
> {
  try {
    const res = await fetch(apiUrl("/api/payments"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{
      payment?: ReservationPaymentLedgerRow | null;
      reservation?: { id: string; amountPaid: number; status: ReservationStatus };
      code?: string;
    }>(res);
    if (res.status === 201 && data?.reservation?.id) {
      return {
        ok: true,
        payment: data.payment ?? null,
        reservation: data.reservation,
      };
    }
    if (res.status === 400 && data?.code === "unknown_reservation") return { ok: false, code: "unknown_reservation" };
    if (res.status === 400 && data?.code === "amount_exceeds_balance")
      return { ok: false, code: "amount_exceeds_balance" };
    if (res.status === 400 && data?.code === "cdf_amount_too_small") return { ok: false, code: "cdf_amount_too_small" };
    if (res.status === 400) return { ok: false, code: data?.code ?? "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    if (res.status === 403) return { ok: false, code: data?.code ?? "forbidden" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export type CreateReservationInput = {
  clientId: string;
  /** Individuel : un id ; groupe : au moins deux ids distincts. */
  bungalowIds: string[];
  reservationKind: ReservationKind;
  start: string;
  end: string;
  amount: number;
  /** Obligatoire côté API pour une réservation groupe (≥ 2). */
  guestCount?: number;
  bookingChannel?: BookingChannel;
};

export type UpdateReservationInput = {
  status?: ReservationStatus;
  guestCount?: number;
  bookingChannel?: BookingChannel;
};

export async function apiCreateReservation(
  body: CreateReservationInput,
): Promise<{ ok: true; reservation: Reservation } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/reservations"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ reservation?: Reservation; code?: string }>(res);
    if (res.status === 201 && data?.reservation) return { ok: true, reservation: data.reservation };
    if (res.status === 409 && data?.code === "bungalow_overlap") return { ok: false, code: "bungalow_overlap" };
    if (res.status === 400 && data?.code === "unknown_client") return { ok: false, code: "unknown_client" };
    if (res.status === 400 && data?.code === "unknown_bungalow") return { ok: false, code: "unknown_bungalow" };
    if (res.status === 400 && data?.code === "bungalow_not_available")
      return { ok: false, code: "bungalow_not_available" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export type CreateBungalowInput = Omit<Bungalow, "id">;

export async function apiCreateBungalow(
  body: CreateBungalowInput,
): Promise<{ ok: true; bungalow: Bungalow } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/bungalows"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ bungalow?: Bungalow; code?: string }>(res);
    if (res.status === 201 && data?.bungalow) return { ok: true, bungalow: data.bungalow };
    if (res.status === 409 && data?.code === "code_taken") return { ok: false, code: "code_taken" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export type UpdateBungalowInput = Partial<CreateBungalowInput>;

export async function apiUpdateBungalow(
  id: string,
  body: UpdateBungalowInput,
): Promise<{ ok: true; bungalow: Bungalow } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/bungalows/${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ bungalow?: Bungalow; code?: string }>(res);
    if (res.status === 200 && data?.bungalow) return { ok: true, bungalow: data.bungalow };
    if (res.status === 409 && data?.code === "code_taken") return { ok: false, code: "code_taken" };
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export type CreateClientInput = {
  name: string;
  /** Obligatoire pour profils hébergement / mixte ; facultatif pour « passage » (e-mail technique généré si vide). */
  email?: string;
  phone?: string;
  notes?: string;
  clientProfile?: string;
  /** USD entiers ; obligatoire (≥ 1) si le profil prévoit un droit d’entrée visiteur (sinon défaut = tarif Paramètres). */
  entryFeeUsd?: number;
  /** Obligatoire si profil avec droit d’entrée : `individual` | `group` | `family`. */
  visitorVisitKind?: "individual" | "group" | "family";
  /** Avec `group` ou `family` : nombre d’adultes (≥ 0, somme adultes + mineurs ≥ 1). */
  visitorAdultsCount?: number;
  /** Avec `group` ou `family` : nombre de mineurs (≥ 0). */
  visitorMinorsCount?: number;
};

export async function apiCreateClient(
  body: CreateClientInput,
): Promise<{ ok: true; client: Client } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/clients"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ client?: Client; code?: string }>(res);
    if (res.status === 201 && data?.client) return { ok: true, client: data.client };
    if (res.status === 409 && data?.code === "email_taken") return { ok: false, code: "email_taken" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export type UpdateClientInput = {
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
  clientProfile?: string;
  entryFeeUsd?: number;
  visitorVisitKind?: "individual" | "group" | "family";
  visitorAdultsCount?: number;
  visitorMinorsCount?: number;
};

export async function apiUpdateClient(
  id: string,
  body: UpdateClientInput,
): Promise<{ ok: true; client: Client } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/clients/${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ client?: Client; code?: string }>(res);
    if (res.status === 200 && data?.client) return { ok: true, client: data.client };
    if (res.status === 409 && data?.code === "email_taken") return { ok: false, code: "email_taken" };
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiListClientProfileTypes(): Promise<ClientProfileType[] | null> {
  try {
    const res = await fetch(apiUrl("/api/client-profile-types"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ profiles: ClientProfileType[] }>(res);
    return data?.profiles ?? null;
  } catch {
    return null;
  }
}

export async function apiCreateClientProfileType(body: {
  code: string;
  label: string;
  hint?: string;
  sortOrder?: number;
  emailOptional?: boolean;
  appliesEntryFee?: boolean;
}): Promise<{ ok: true; profile: ClientProfileType } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/client-profile-types"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ profile?: ClientProfileType; code?: string }>(res);
    if (res.status === 201 && data?.profile) return { ok: true, profile: data.profile };
    if (res.status === 409 && data?.code === "code_taken") return { ok: false, code: "code_taken" };
    if (res.status === 403) return { ok: false, code: "forbidden" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiPatchClientProfileType(
  code: string,
  body: Partial<{
    label: string;
    hint: string;
    sortOrder: number;
    emailOptional: boolean;
    appliesEntryFee: boolean;
  }>,
): Promise<{ ok: true; profile: ClientProfileType } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/client-profile-types/${encodeURIComponent(code)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ profile?: ClientProfileType; code?: string }>(res);
    if (res.status === 200 && data?.profile) return { ok: true, profile: data.profile };
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 403) return { ok: false, code: "forbidden" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiDeleteClientProfileType(code: string): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/client-profile-types/${encodeURIComponent(code)}`), {
      method: "DELETE",
      credentials: "include",
    });
    if (res.status === 204) return { ok: true };
    const data = await parseJson<{ code?: string }>(res);
    if (res.status === 409 && data?.code === "in_use") return { ok: false, code: "in_use" };
    if (res.status === 400 && data?.code === "last_profile") return { ok: false, code: "last_profile" };
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 403) return { ok: false, code: "forbidden" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiDeleteClient(id: string): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/clients/${encodeURIComponent(id)}`), {
      method: "DELETE",
      credentials: "include",
    });
    if (res.status === 204) return { ok: true };
    const data = await parseJson<{ code?: string }>(res);
    if (res.status === 409 && data?.code === "has_reservations") return { ok: false, code: "has_reservations" };
    if (res.status === 409 && data?.code === "has_visitor_ledger") return { ok: false, code: "has_visitor_ledger" };
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 403) return { ok: false, code: data?.code ?? "forbidden" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiListUsers(): Promise<SystemUser[] | null> {
  try {
    const res = await fetch(apiUrl("/api/users"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ users: SystemUser[] }>(res);
    return data?.users ?? null;
  } catch {
    return null;
  }
}

/** Journal d’audit applicatif (réservé administrateurs). `actorUserId` filtre les entrées par auteur. */
export async function apiListAuditLog(actorUserId?: string): Promise<AuditLogEntry[] | null> {
  try {
    const q =
      actorUserId != null && actorUserId.trim() !== ""
        ? `?actorUserId=${encodeURIComponent(actorUserId.trim())}`
        : "";
    const res = await fetch(apiUrl(`/api/audit-log${q}`), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ entries: AuditLogEntry[] }>(res);
    return data?.entries ?? null;
  } catch {
    return null;
  }
}

/** Sessions actives — tous les utilisateurs (admin app uniquement). */
export async function apiListAdminActiveSessions(): Promise<AdminActiveSession[] | null> {
  try {
    const res = await fetch(apiUrl("/api/auth/admin/sessions"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ sessions: AdminActiveSession[] }>(res);
    return data?.sessions ?? null;
  } catch {
    return null;
  }
}

export async function apiAdminRevokeSession(
  sessionId: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/auth/admin/sessions/${encodeURIComponent(sessionId)}`), {
      method: "DELETE",
      credentials: "include",
    });
    if (res.status === 204) return { ok: true };
    const data = await parseJson<{ code?: string }>(res);
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export type CreateUserInput = {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  active?: boolean;
};

export async function apiCreateUser(
  body: CreateUserInput,
): Promise<{ ok: true; user: SystemUser } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/users"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ user?: SystemUser; code?: string }>(res);
    if (res.status === 201 && data?.user) return { ok: true, user: data.user };
    if (res.status === 409 && data?.code === "email_taken") return { ok: false, code: "email_taken" };
    if (res.status === 403) return { ok: false, code: data?.code ?? "forbidden" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    return { ok: false, code: "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export type UpdateUserInput = {
  name?: string;
  email?: string;
  role?: UserRole;
  active?: boolean;
  /** Absent ou vide = ne pas changer */
  password?: string;
  /** Remplace les assignations caisse comptoir (Paramètres → utilisateurs). */
  pointOfSaleIds?: string[];
};

export async function apiUpdateUser(
  id: string,
  body: UpdateUserInput,
): Promise<{ ok: true; user: SystemUser } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/users/${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ user?: SystemUser; code?: string }>(res);
    if (res.status === 200 && data?.user) return { ok: true, user: data.user };
    if (res.status === 409 && data?.code === "email_taken") return { ok: false, code: "email_taken" };
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 403) return { ok: false, code: data?.code ?? "forbidden" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    return { ok: false, code: "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiDeleteUser(id: string): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/users/${encodeURIComponent(id)}`), {
      method: "DELETE",
      credentials: "include",
    });
    if (res.status === 204) return { ok: true };
    const data = await parseJson<{ code?: string; error?: string }>(res);
    if (res.status === 403) return { ok: false, code: data?.code ?? "forbidden" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiListUserInvitations(): Promise<UserInvitationPending[] | null> {
  try {
    const res = await fetch(apiUrl("/api/users/invitations"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ invitations?: UserInvitationPending[] }>(res);
    return data?.invitations ?? null;
  } catch {
    return null;
  }
}

export type CreateUserInvitationInput = {
  email: string;
  name: string;
  role: UserRole;
  active?: boolean;
};

export type CreateUserInvitationResult = {
  emailSent: true;
  expiresAt: string;
  invitee: { email: string; name: string; role: string; active: boolean };
};

export async function apiCreateUserInvitation(
  body: CreateUserInvitationInput,
): Promise<{ ok: true; result: CreateUserInvitationResult } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/users/invitations"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data =
      (await parseJson<{
        emailSent?: boolean;
        expiresAt?: string;
        invitee?: CreateUserInvitationResult["invitee"];
        code?: string;
      }>(res)) ?? {};
    if (
      res.status === 201 &&
      data.emailSent === true &&
      typeof data.expiresAt === "string" &&
      data.invitee
    ) {
      return {
        ok: true,
        result: { emailSent: true, expiresAt: data.expiresAt, invitee: data.invitee },
      };
    }
    if (res.status === 409) return { ok: false, code: "email_taken" };
    if (res.status === 503 && data.code === "email_not_configured") return { ok: false, code: "email_not_configured" };
    if (res.status === 400 && data.code === "public_url_required") return { ok: false, code: "public_url_required" };
    if (res.status === 502 && data.code === "email_send_failed") return { ok: false, code: "email_send_failed" };
    if (res.status === 403) {
      const c = data.code;
      if (c === "forbidden_role_assignment") return { ok: false, code: c };
      return { ok: false, code: c ?? "forbidden" };
    }
    if (res.status === 400) return { ok: false, code: data.code ?? "validation_error" };
    if (res.status === 503) return { ok: false, code: data.code ?? "email_not_configured" };
    if (res.status === 502) return { ok: false, code: data.code ?? "email_send_failed" };
    return { ok: false, code: "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiListAppUserRoles(): Promise<AppUserRole[] | null> {
  try {
    const res = await fetch(apiUrl("/api/user-roles"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ roles: AppUserRole[] }>(res);
    return data?.roles ?? null;
  } catch {
    return null;
  }
}

export async function apiGetPermissionCatalog(): Promise<PermissionCatalogEntry[] | null> {
  try {
    const res = await fetch(apiUrl("/api/user-roles/permission-catalog"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ catalog: PermissionCatalogEntry[] }>(res);
    return data?.catalog ?? null;
  } catch {
    return null;
  }
}

export type CreateAppUserRoleInput = {
  label: string;
  sortOrder?: number;
  isAppAdmin?: boolean;
  canManageAppUsers?: boolean;
  allowNonAdminInvite?: boolean;
  /** Si défini (et rôle non admin), remplace les droits explicites en base. */
  permissions?: string[];
};

export async function apiCreateAppUserRole(
  body: CreateAppUserRoleInput,
): Promise<{ ok: true; role: AppUserRole } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/user-roles"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ role?: AppUserRole; code?: string }>(res);
    if (res.status === 201 && data?.role) return { ok: true, role: data.role };
    if (res.status === 409 && data?.code === "label_taken") return { ok: false, code: "label_taken" };
    if (res.status === 403) return { ok: false, code: data?.code ?? "forbidden" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    return { ok: false, code: "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export type UpdateAppUserRoleInput = {
  label?: string;
  sortOrder?: number;
  isAppAdmin?: boolean;
  canManageAppUsers?: boolean;
  allowNonAdminInvite?: boolean;
  permissions?: string[];
};

export async function apiUpdateAppUserRole(
  id: string,
  body: UpdateAppUserRoleInput,
): Promise<{ ok: true; role: AppUserRole } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/user-roles/${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ role?: AppUserRole; code?: string }>(res);
    if (res.status === 200 && data?.role) return { ok: true, role: data.role };
    if (res.status === 409 && data?.code === "label_taken") return { ok: false, code: "label_taken" };
    if (res.status === 403) return { ok: false, code: data?.code ?? "forbidden" };
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    return { ok: false, code: "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiDeleteAppUserRole(id: string): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/user-roles/${encodeURIComponent(id)}`), {
      method: "DELETE",
      credentials: "include",
    });
    if (res.status === 204) return { ok: true };
    const data = await parseJson<{ code?: string }>(res);
    if (res.status === 403) return { ok: false, code: data?.code ?? "forbidden" };
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 409) return { ok: false, code: data?.code ?? "role_in_use" };
    return { ok: false, code: "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiDeleteUserInvitation(
  id: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/users/invitations/${encodeURIComponent(id)}`), {
      method: "DELETE",
      credentials: "include",
    });
    if (res.status === 204) return { ok: true };
    const data = await parseJson<{ code?: string }>(res);
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 403) return { ok: false, code: data?.code ?? "forbidden" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export type InvitePreview = {
  email: string;
  name: string;
  role: UserRole;
  expiresAt: string;
};

export async function apiGetInvitePreview(token: string): Promise<
  | { ok: true; preview: InvitePreview }
  | { ok: false; code: string }
> {
  try {
    const q = new URLSearchParams({ token });
    const res = await fetch(apiUrl(`/api/auth/invite-preview?${q}`), { credentials: "omit" });
    const data = await parseJson<InvitePreview & { code?: string }>(res);
    if (res.status === 200 && data?.email && data?.name && data?.role && data?.expiresAt) {
      return {
        ok: true,
        preview: {
          email: data.email,
          name: data.name,
          role: data.role as UserRole,
          expiresAt: data.expiresAt,
        },
      };
    }
    if (res.status === 410) return { ok: false, code: "invite_expired" };
    if (res.status === 404) return { ok: false, code: "invite_not_found" };
    if (res.status === 400) return { ok: false, code: "invalid_token" };
    return { ok: false, code: "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiAcceptInvite(
  token: string,
  password: string,
): Promise<{ ok: true; user: AuthUser } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/auth/accept-invite"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token, password }),
    });
    const data = await parseJson<{ user?: AuthUser; code?: string }>(res);
    if (res.status === 201 && data?.user) return { ok: true, user: normalizeAuthUser(data.user) };
    if (res.status === 409 && data?.code === "email_taken") return { ok: false, code: "email_taken" };
    if (res.status === 410) return { ok: false, code: "invite_expired" };
    if (res.status === 404) return { ok: false, code: "invite_not_found" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    return { ok: false, code: "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiGetExchangeRate(): Promise<{ cdfPerUsd: number } | null> {
  try {
    const res = await fetch(apiUrl("/api/settings/exchange-rate"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ cdfPerUsd?: number }>(res);
    if (typeof data?.cdfPerUsd !== "number" || !Number.isFinite(data.cdfPerUsd)) return null;
    return { cdfPerUsd: data.cdfPerUsd };
  } catch {
    return null;
  }
}

export async function apiPutExchangeRate(
  cdfPerUsd: number,
): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/settings/exchange-rate"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ cdfPerUsd }),
    });
    if (res.ok) return { ok: true };
    if (res.status === 403) return { ok: false, code: "forbidden" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiGetCategoryRates(): Promise<CategoryRate[] | null> {
  try {
    const res = await fetch(apiUrl("/api/settings/category-rates"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ rates?: CategoryRate[] }>(res);
    return Array.isArray(data?.rates) ? data.rates : null;
  } catch {
    return null;
  }
}

export type VisitorEntryRates = {
  /** Tarif adulte (alias historique de `adultPriceUsd`). */
  priceUsd: number;
  adultPriceUsd: number;
  minorPriceUsd: number;
};

export async function apiGetVisitorEntryPrice(): Promise<VisitorEntryRates | null> {
  try {
    const res = await fetch(apiUrl("/api/settings/visitor-entry-price"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ priceUsd?: number; adultPriceUsd?: number; minorPriceUsd?: number }>(res);
    if (typeof data?.priceUsd !== "number" || !Number.isFinite(data.priceUsd)) return null;
    const adult = Math.max(1, Math.floor(data.priceUsd));
    const minor = Math.max(
      1,
      Math.floor(
        typeof data.minorPriceUsd === "number" && Number.isFinite(data.minorPriceUsd) ? data.minorPriceUsd : 5,
      ),
    );
    return {
      priceUsd: adult,
      adultPriceUsd: typeof data.adultPriceUsd === "number" && Number.isFinite(data.adultPriceUsd)
        ? Math.max(1, Math.floor(data.adultPriceUsd))
        : adult,
      minorPriceUsd: minor,
    };
  } catch {
    return null;
  }
}

export async function apiGetOccupancyRules(): Promise<OccupancyRules | null> {
  try {
    const res = await fetch(apiUrl("/api/settings/occupancy-rules"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ graceDays?: number; penaltyUsd?: number }>(res);
    if (typeof data?.graceDays !== "number" || typeof data?.penaltyUsd !== "number") return null;
    return { graceDays: data.graceDays, penaltyUsd: data.penaltyUsd };
  } catch {
    return null;
  }
}

export async function apiPutOccupancyRules(
  rules: OccupancyRules,
): Promise<{ ok: true } & OccupancyRules | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/settings/occupancy-rules"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ graceDays: rules.graceDays, penaltyUsd: rules.penaltyUsd }),
    });
    const data = await parseJson<{ graceDays?: number; penaltyUsd?: number }>(res);
    if (res.ok && typeof data?.graceDays === "number" && typeof data?.penaltyUsd === "number") {
      return { ok: true, graceDays: data.graceDays, penaltyUsd: data.penaltyUsd };
    }
    if (res.status === 403) return { ok: false, code: "forbidden" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    return { ok: false, code: "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiPutVisitorEntryPrice(
  body: { adultPriceUsd: number; minorPriceUsd: number } | { priceUsd: number },
): Promise<{ ok: true } & VisitorEntryRates | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/settings/visitor-entry-price"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ priceUsd?: number; adultPriceUsd?: number; minorPriceUsd?: number }>(res);
    if (res.ok && typeof data?.priceUsd === "number") {
      const adult = Math.max(1, Math.floor(data.priceUsd));
      const minor = Math.max(
        1,
        Math.floor(
          typeof data.minorPriceUsd === "number" && Number.isFinite(data.minorPriceUsd) ? data.minorPriceUsd : 5,
        ),
      );
      return {
        ok: true,
        priceUsd: adult,
        adultPriceUsd:
          typeof data.adultPriceUsd === "number" && Number.isFinite(data.adultPriceUsd)
            ? Math.max(1, Math.floor(data.adultPriceUsd))
            : adult,
        minorPriceUsd: minor,
      };
    }
    if (res.status === 403) return { ok: false, code: "forbidden" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    return { ok: false, code: "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiPutCategoryRates(
  rates: CategoryRate[],
): Promise<{ ok: true; rates: CategoryRate[] } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/settings/category-rates"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ rates }),
    });
    const data = await parseJson<{ rates?: CategoryRate[] }>(res);
    if (res.ok && data?.rates) return { ok: true, rates: data.rates };
    if (res.status === 403) return { ok: false, code: "forbidden" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    return { ok: false, code: "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiGetBungalowCategories(): Promise<BungalowCategoryRow[] | null> {
  try {
    const res = await fetch(apiUrl("/api/settings/bungalow-categories"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ categories?: BungalowCategoryRow[] }>(res);
    return Array.isArray(data?.categories) ? data.categories : null;
  } catch {
    return null;
  }
}

export async function apiPutBungalowCategories(
  categories: BungalowCategoryRow[],
): Promise<{ ok: true; categories: BungalowCategoryRow[] } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/settings/bungalow-categories"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ categories }),
    });
    const data = await parseJson<{ categories?: BungalowCategoryRow[] }>(res);
    if (res.ok && data?.categories) return { ok: true, categories: data.categories };
    if (res.status === 403) return { ok: false, code: "forbidden" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    return { ok: false, code: "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export function apiMaintenanceAttachmentFileUrl(ticketId: string, attachmentId: string): string {
  return apiUrl(
    `/api/maintenance-tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachmentId)}/file`,
  );
}

export async function apiListMaintenanceTickets(params?: {
  bungalowId?: string;
  status?: string;
  priority?: string;
}): Promise<MaintenanceTicket[] | null> {
  try {
    const q = new URLSearchParams();
    if (params?.bungalowId) q.set("bungalowId", params.bungalowId);
    if (params?.status) q.set("status", params.status);
    if (params?.priority) q.set("priority", params.priority);
    const suffix = q.toString() ? `?${q.toString()}` : "";
    const res = await fetch(apiUrl(`/api/maintenance-tickets${suffix}`), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ tickets?: MaintenanceTicket[] }>(res);
    return Array.isArray(data?.tickets) ? data.tickets : null;
  } catch {
    return null;
  }
}

export async function apiGetMaintenanceTicket(
  id: string,
): Promise<{ ticket: MaintenanceTicket; events: MaintenanceTicketEvent[]; attachments: MaintenanceTicketAttachment[] } | null> {
  try {
    const res = await fetch(apiUrl(`/api/maintenance-tickets/${encodeURIComponent(id)}`), {
      credentials: "include",
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = await parseJson<{
      ticket?: MaintenanceTicket;
      events?: MaintenanceTicketEvent[];
      attachments?: MaintenanceTicketAttachment[];
    }>(res);
    if (!data?.ticket) return null;
    return {
      ticket: data.ticket,
      events: Array.isArray(data.events) ? data.events : [],
      attachments: Array.isArray(data.attachments) ? data.attachments : [],
    };
  } catch {
    return null;
  }
}

export type CreateMaintenanceTicketInput = {
  bungalowId: string;
  category: MaintenanceTicket["category"];
  title: string;
  description?: string;
  priority?: MaintenanceTicket["priority"];
};

export async function apiCreateMaintenanceTicket(
  body: CreateMaintenanceTicketInput,
): Promise<{ ok: true; ticket: MaintenanceTicket } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/maintenance-tickets"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ ticket?: MaintenanceTicket; code?: string }>(res);
    if (res.status === 201 && data?.ticket) return { ok: true, ticket: data.ticket };
    if (res.status === 400 && data?.code === "unknown_bungalow") return { ok: false, code: "unknown_bungalow" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export type PatchMaintenanceTicketInput = Partial<{
  title: string;
  description: string;
  priority: MaintenanceTicket["priority"];
  status: MaintenanceTicket["status"];
}>;

export async function apiPatchMaintenanceTicket(
  id: string,
  body: PatchMaintenanceTicketInput,
): Promise<{ ok: true; ticket: MaintenanceTicket } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/maintenance-tickets/${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ ticket?: MaintenanceTicket; code?: string }>(res);
    if (res.status === 200 && data?.ticket) return { ok: true, ticket: data.ticket };
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiPostMaintenanceTicketComment(
  ticketId: string,
  body: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/maintenance-tickets/${encodeURIComponent(ticketId)}/comments`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ body }),
    });
    if (res.status === 201) return { ok: true };
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result;
      if (typeof s !== "string") {
        reject(new Error("read"));
        return;
      }
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(r.error ?? new Error("read"));
    r.readAsDataURL(file);
  });
}

export async function apiPostMaintenanceTicketAttachment(
  ticketId: string,
  file: File,
): Promise<{ ok: true; attachment: MaintenanceTicketAttachment } | { ok: false; code: string }> {
  try {
    const dataBase64 = await fileToBase64(file);
    const res = await fetch(apiUrl(`/api/maintenance-tickets/${encodeURIComponent(ticketId)}/attachments`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        dataBase64,
      }),
    });
    const data = await parseJson<{ attachment?: MaintenanceTicketAttachment; code?: string }>(res);
    if (res.status === 201 && data?.attachment) return { ok: true, attachment: data.attachment };
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 400 && data?.code === "unsupported_mime") return { ok: false, code: "unsupported_mime" };
    if (res.status === 400 && data?.code === "file_too_large") return { ok: false, code: "file_too_large" };
    if (res.status === 400) return { ok: false, code: "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiListOperationalWorkflowItems(): Promise<OperationalWorkflowListItem[] | null> {
  try {
    const res = await fetch(apiUrl("/api/operational-workflow"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ items?: OperationalWorkflowListItem[] }>(res);
    return Array.isArray(data?.items) ? data.items : null;
  } catch {
    return null;
  }
}

export type OperationalWorkflowReservationSummary = {
  id: string;
  clientId: string;
  clientName: string;
  bungalowCodes: string;
  start: string;
  end: string;
  status: ReservationStatus;
};

export type PatchOperationalWorkflowInput = Partial<{
  legalCountryCode: string;
  idDocumentVerifiedAt: string | null;
  depositAmountUsd: number;
  depositMethod: string;
  depositReceivedAt: string | null;
  arrivalSignatureAt: string | null;
  arrivalInventoryNote: string;
  arrivalInventoryOk: boolean;
  checkInCompletedAt: string | null;
  departureExtrasNote: string;
  departureExtrasAmountUsd: number;
  keysReturned: boolean;
  keysNote: string;
  checkOutCompletedAt: string | null;
  legalDocumentsAckAt: string | null;
  legalAckDocIds: string[];
}>;

export async function apiGetOperationalWorkflow(reservationId: string): Promise<{
  reservation: OperationalWorkflowReservationSummary;
  workflow: OperationalWorkflow;
  hasPersistedWorkflow: boolean;
} | null> {
  try {
    const res = await fetch(apiUrl(`/api/operational-workflow/${encodeURIComponent(reservationId)}`), {
      credentials: "include",
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = await parseJson<{
      reservation?: OperationalWorkflowReservationSummary;
      workflow?: OperationalWorkflow;
      hasPersistedWorkflow?: boolean;
    }>(res);
    if (!data?.reservation || !data.workflow) return null;
    return {
      reservation: data.reservation,
      workflow: data.workflow,
      hasPersistedWorkflow: Boolean(data.hasPersistedWorkflow),
    };
  } catch {
    return null;
  }
}

export async function apiPatchOperationalWorkflow(
  reservationId: string,
  body: PatchOperationalWorkflowInput,
): Promise<
  | {
      ok: true;
      reservation: OperationalWorkflowReservationSummary;
      workflow: OperationalWorkflow;
      hasPersistedWorkflow: boolean;
    }
  | { ok: false; code: string }
> {
  try {
    const res = await fetch(apiUrl(`/api/operational-workflow/${encodeURIComponent(reservationId)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{
      reservation?: OperationalWorkflowReservationSummary;
      workflow?: OperationalWorkflow;
      hasPersistedWorkflow?: boolean;
      code?: string;
    }>(res);
    if (res.status === 200 && data?.reservation && data.workflow) {
      return {
        ok: true,
        reservation: data.reservation,
        workflow: data.workflow,
        hasPersistedWorkflow: Boolean(data.hasPersistedWorkflow),
      };
    }
    if (res.status === 404) return { ok: false, code: "not_found" };
    if (res.status === 400) return { ok: false, code: data?.code ?? "validation_error" };
    if (res.status === 401) return { ok: false, code: "unauthorized" };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

/* --- Inventaire & achats (logistique) --- */

export async function apiInventoryLocations(): Promise<StockLocation[] | null> {
  try {
    const res = await fetch(apiUrl("/api/inventory/locations"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ locations?: StockLocation[] }>(res);
    return Array.isArray(data?.locations) ? data.locations : null;
  } catch {
    return null;
  }
}

export async function apiInventoryArticleRefs(): Promise<InventoryArticleRefs | null> {
  try {
    const res = await fetch(apiUrl("/api/inventory/article-refs"), { credentials: "include" });
    if (!res.ok) return null;
    return await parseJson<InventoryArticleRefs>(res);
  } catch {
    return null;
  }
}

export async function apiInventoryItems(activeOnly = true): Promise<StockItem[] | null> {
  try {
    const q = activeOnly ? "" : "?active=0";
    const res = await fetch(apiUrl(`/api/inventory/items${q}`), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ items?: StockItem[] }>(res);
    return Array.isArray(data?.items) ? data.items : null;
  } catch {
    return null;
  }
}

export async function apiInventoryCreateItem(body: {
  label: string;
  unit?: string;
  category?: string;
  subcategory?: string;
  unitQty?: number;
  salePriceUsdCents?: number;
}): Promise<{ ok: true; item: StockItem } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/inventory/items"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ item?: StockItem; code?: string }>(res);
    if (res.status === 201 && data?.item) return { ok: true, item: data.item };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiInventoryUpdateItem(
  id: string,
  body: {
    label: string;
    unit: string;
    unitQty: number;
    category: string;
    subcategory: string;
    active: boolean;
    salePriceUsdCents: number;
  },
): Promise<{ ok: true; item: StockItem } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/inventory/items/${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ item?: StockItem; code?: string }>(res);
    if (res.status === 200 && data?.item) return { ok: true, item: data.item };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiInventoryBalances(): Promise<StockBalanceRow[] | null> {
  try {
    const res = await fetch(apiUrl("/api/inventory/balances"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ balances?: StockBalanceRow[] }>(res);
    return Array.isArray(data?.balances) ? data.balances : null;
  } catch {
    return null;
  }
}

export async function apiInventorySuppliers(): Promise<StockSupplier[] | null> {
  try {
    const res = await fetch(apiUrl("/api/inventory/suppliers"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ suppliers?: StockSupplier[] }>(res);
    return Array.isArray(data?.suppliers) ? data.suppliers : null;
  } catch {
    return null;
  }
}

export async function apiInventoryCreateSupplier(body: {
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  address?: string;
  leadTimeDays?: number | null;
}): Promise<{ ok: true; supplier: StockSupplier } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/inventory/suppliers"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ supplier?: StockSupplier; code?: string }>(res);
    if (res.status === 201 && data?.supplier) return { ok: true, supplier: data.supplier };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiInventoryDocuments(limit = 40): Promise<StockDocument[] | null> {
  try {
    const res = await fetch(apiUrl(`/api/inventory/documents?limit=${limit}`), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ documents?: StockDocument[] }>(res);
    return Array.isArray(data?.documents) ? data.documents : null;
  } catch {
    return null;
  }
}

export async function apiInventoryStockAlerts(): Promise<StockDashboardAlert[] | null> {
  try {
    const res = await fetch(apiUrl("/api/inventory/stock-alerts"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ alerts?: StockDashboardAlert[] }>(res);
    return Array.isArray(data?.alerts) ? data.alerts : null;
  } catch {
    return null;
  }
}

export async function apiInventoryToOrder(): Promise<{ lines: StockToOrderLine[]; supplierLeadDaysMax: number | null } | null> {
  try {
    const res = await fetch(apiUrl("/api/inventory/to-order"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ lines?: StockToOrderLine[]; supplierLeadDaysMax?: number | null }>(res);
    if (!data || !Array.isArray(data.lines)) return null;
    return { lines: data.lines, supplierLeadDaysMax: data.supplierLeadDaysMax ?? null };
  } catch {
    return null;
  }
}

export async function apiInventoryReorderPolicies(): Promise<StockReorderPolicyRow[] | null> {
  try {
    const res = await fetch(apiUrl("/api/inventory/reorder-policies"), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ policies?: StockReorderPolicyRow[] }>(res);
    return Array.isArray(data?.policies) ? data.policies : null;
  } catch {
    return null;
  }
}

export async function apiInventoryPutReorderPolicies(body: {
  policies: {
    itemId: string;
    locationId: string;
    minQty: number | null;
    maxQty: number | null;
    reorderPoint: number | null;
  }[];
}): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/inventory/reorder-policies"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ ok?: boolean; code?: string }>(res);
    if (res.status === 200 && data?.ok) return { ok: true };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiInventoryReceipt(body: {
  purchaseOrderId: string;
  toLocationId: string;
  externalRef?: string;
  note?: string;
  lines: { itemId: string; qty: number; unitCostCdf: number }[];
}): Promise<{ ok: true; documentId: string } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/inventory/documents/receipt"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ documentId?: string; code?: string }>(res);
    if (res.status === 201 && data?.documentId) return { ok: true, documentId: data.documentId };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiInventoryTransfer(body: {
  fromLocationId: string;
  toLocationId: string;
  note?: string;
  lines: { itemId: string; qty: number }[];
}): Promise<{ ok: true; documentId: string } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/inventory/documents/transfer"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ documentId?: string; code?: string }>(res);
    if (res.status === 201 && data?.documentId) return { ok: true, documentId: data.documentId };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiInventoryAdjustment(body: {
  locationId: string;
  note?: string;
  lines: { itemId: string; qtyDelta: number }[];
}): Promise<{ ok: true; documentId: string } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/inventory/documents/adjustment"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ documentId?: string; code?: string }>(res);
    if (res.status === 201 && data?.documentId) return { ok: true, documentId: data.documentId };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiInventoryCount(body: {
  locationId: string;
  note?: string;
  lines: { itemId: string; countedQty: number }[];
}): Promise<{ ok: true; documentId: string; adjustments: number } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/inventory/documents/inventory-count"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ documentId?: string; adjustments?: number; code?: string }>(res);
    if (res.status === 201 && data?.documentId != null && typeof data.adjustments === "number") {
      return { ok: true, documentId: data.documentId, adjustments: data.adjustments };
    }
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiListPurchaseOrdersEligibleForReceipt(): Promise<PurchaseOrderEligibleForReceipt[] | null> {
  try {
    const res = await fetch(apiUrl("/api/inventory/purchase-orders/eligible-for-receipt"), {
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = await parseJson<{ purchaseOrders?: PurchaseOrderEligibleForReceipt[] }>(res);
    return Array.isArray(data?.purchaseOrders) ? data.purchaseOrders : null;
  } catch {
    return null;
  }
}

export async function apiListPurchaseOrders(status?: string): Promise<PurchaseOrderListRow[] | null> {
  try {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    const res = await fetch(apiUrl(`/api/inventory/purchase-orders${q}`), { credentials: "include" });
    if (!res.ok) return null;
    const data = await parseJson<{ purchaseOrders?: PurchaseOrderListRow[] }>(res);
    return Array.isArray(data?.purchaseOrders) ? data.purchaseOrders : null;
  } catch {
    return null;
  }
}

export async function apiGetPurchaseOrder(id: string): Promise<PurchaseOrderDetail | null> {
  try {
    const res = await fetch(apiUrl(`/api/inventory/purchase-orders/${encodeURIComponent(id)}`), {
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = await parseJson<{ purchaseOrder?: PurchaseOrderDetail }>(res);
    return data?.purchaseOrder ?? null;
  } catch {
    return null;
  }
}

/** Paiement fournisseur unique (CDF) : le serveur crée la dépense pour le total des lignes et verrouille le bon. */
export async function apiRecordPurchaseOrderSupplierPayment(
  id: string,
  body: { occurredAt: string; sourceAccountId: string; note?: string },
): Promise<
  { ok: true; purchaseOrder: PurchaseOrderDetail; movementId: string } | { ok: false; code: string }
> {
  try {
    const res = await fetch(
      apiUrl(`/api/inventory/purchase-orders/${encodeURIComponent(id)}/supplier-payment`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      },
    );
    const data = await parseJson<{
      purchaseOrder?: PurchaseOrderDetail;
      movementId?: string;
      code?: string;
    }>(res);
    if (res.status === 201 && data?.purchaseOrder && data?.movementId) {
      return { ok: true, purchaseOrder: data.purchaseOrder, movementId: data.movementId };
    }
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiCreatePurchaseOrder(body: {
  supplierId: string;
  /** Non utilisé : le serveur génère `BC-{année}-{séquence}`. */
  externalRef?: string;
  note?: string;
  lines: { itemId: string; qtyOrdered: number; unitCostCdfEst: number }[];
}): Promise<{ ok: true; id: string } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/inventory/purchase-orders"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ id?: string; code?: string }>(res);
    if (res.status === 201 && data?.id) return { ok: true, id: data.id };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiPatchPurchaseOrder(
  id: string,
  body: {
    supplierId?: string;
    externalRef?: string;
    note?: string;
    lines?: { itemId: string; qtyOrdered: number; unitCostCdfEst: number }[];
  },
): Promise<{ ok: true; purchaseOrder: PurchaseOrderDetail } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/inventory/purchase-orders/${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ purchaseOrder?: PurchaseOrderDetail; code?: string }>(res);
    if (res.status === 200 && data?.purchaseOrder) return { ok: true, purchaseOrder: data.purchaseOrder };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiSubmitPurchaseOrder(
  id: string,
): Promise<{ ok: true; purchaseOrder: PurchaseOrderDetail } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/inventory/purchase-orders/${encodeURIComponent(id)}/submit`), {
      method: "POST",
      credentials: "include",
    });
    const data = await parseJson<{ purchaseOrder?: PurchaseOrderDetail; code?: string }>(res);
    if (res.status === 200 && data?.purchaseOrder) return { ok: true, purchaseOrder: data.purchaseOrder };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiApprovePurchaseOrderManager(
  id: string,
): Promise<{ ok: true; purchaseOrder: PurchaseOrderDetail } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/inventory/purchase-orders/${encodeURIComponent(id)}/approve-manager`), {
      method: "POST",
      credentials: "include",
    });
    const data = await parseJson<{ purchaseOrder?: PurchaseOrderDetail; code?: string }>(res);
    if (res.status === 200 && data?.purchaseOrder) return { ok: true, purchaseOrder: data.purchaseOrder };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiApprovePurchaseOrderDg(
  id: string,
): Promise<{ ok: true; purchaseOrder: PurchaseOrderDetail } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/inventory/purchase-orders/${encodeURIComponent(id)}/approve-dg`), {
      method: "POST",
      credentials: "include",
    });
    const data = await parseJson<{ purchaseOrder?: PurchaseOrderDetail; code?: string }>(res);
    if (res.status === 200 && data?.purchaseOrder) return { ok: true, purchaseOrder: data.purchaseOrder };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiReleasePurchaseOrderFinance(
  id: string,
  fundingDetail: string,
): Promise<{ ok: true; purchaseOrder: PurchaseOrderDetail } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/inventory/purchase-orders/${encodeURIComponent(id)}/release-finance`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ fundingDetail }),
    });
    const data = await parseJson<{ purchaseOrder?: PurchaseOrderDetail; code?: string }>(res);
    if (res.status === 200 && data?.purchaseOrder) return { ok: true, purchaseOrder: data.purchaseOrder };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiReleasePurchaseOrderAccounting(
  id: string,
  fundingDetail: string,
): Promise<{ ok: true; purchaseOrder: PurchaseOrderDetail } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/inventory/purchase-orders/${encodeURIComponent(id)}/release-accounting`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ fundingDetail }),
    });
    const data = await parseJson<{ purchaseOrder?: PurchaseOrderDetail; code?: string }>(res);
    if (res.status === 200 && data?.purchaseOrder) return { ok: true, purchaseOrder: data.purchaseOrder };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiRejectPurchaseOrder(
  id: string,
  note?: string,
): Promise<{ ok: true; purchaseOrder: PurchaseOrderDetail } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/inventory/purchase-orders/${encodeURIComponent(id)}/reject`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ note: note ?? "" }),
    });
    const data = await parseJson<{ purchaseOrder?: PurchaseOrderDetail; code?: string }>(res);
    if (res.status === 200 && data?.purchaseOrder) return { ok: true, purchaseOrder: data.purchaseOrder };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiReopenPurchaseOrder(
  id: string,
): Promise<{ ok: true; purchaseOrder: PurchaseOrderDetail } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/inventory/purchase-orders/${encodeURIComponent(id)}/reopen`), {
      method: "POST",
      credentials: "include",
    });
    const data = await parseJson<{ purchaseOrder?: PurchaseOrderDetail; code?: string }>(res);
    if (res.status === 200 && data?.purchaseOrder) return { ok: true, purchaseOrder: data.purchaseOrder };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiGetStockArticleRefs(): Promise<StockArticleRef | null> {
  try {
    const res = await fetch(apiUrl("/api/settings/stock-article-refs"), { credentials: "include" });
    if (!res.ok) return null;
    return await parseJson<StockArticleRef>(res);
  } catch {
    return null;
  }
}

export async function apiPutStockArticleRefs(
  body: StockArticleRef,
): Promise<StockArticleRef | { error: string; code?: string } | null> {
  try {
    const res = await fetch(apiUrl("/api/settings/stock-article-refs"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<StockArticleRef & { error?: string; code?: string }>(res);
    if (res.status === 200) return data as StockArticleRef;
    if (data && "error" in data) return { error: String(data.error), code: data.code };
    return null;
  } catch {
    return null;
  }
}

export async function apiGetStockItemCategories(): Promise<{ categories: StockArticleRefRow[] } | null> {
  try {
    const res = await fetch(apiUrl("/api/settings/stock-item-categories"), { credentials: "include" });
    if (!res.ok) return null;
    return await parseJson<{ categories: StockArticleRefRow[] }>(res);
  } catch {
    return null;
  }
}

export async function apiPutStockItemCategories(body: {
  categories: StockArticleRefRow[];
}): Promise<
  | { categories: StockArticleRefRow[] }
  | { error: string; code?: string }
  | null
> {
  try {
    const res = await fetch(apiUrl("/api/settings/stock-item-categories"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ categories?: StockArticleRefRow[]; error?: string; code?: string }>(res);
    if (res.status === 200 && data?.categories) return { categories: data.categories };
    if (data && "error" in data && data.error) return { error: String(data.error), code: data.code };
    return null;
  } catch {
    return null;
  }
}

export async function apiGetStockItemUnits(): Promise<{ units: StockArticleRefRow[] } | null> {
  try {
    const res = await fetch(apiUrl("/api/settings/stock-item-units"), { credentials: "include" });
    if (!res.ok) return null;
    return await parseJson<{ units: StockArticleRefRow[] }>(res);
  } catch {
    return null;
  }
}

export async function apiPutStockItemUnits(body: {
  units: StockArticleRefRow[];
}): Promise<
  | { units: StockArticleRefRow[] }
  | { error: string; code?: string }
  | null
> {
  try {
    const res = await fetch(apiUrl("/api/settings/stock-item-units"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ units?: StockArticleRefRow[]; error?: string; code?: string }>(res);
    if (res.status === 200 && data?.units) return { units: data.units };
    if (data && "error" in data && data.error) return { error: String(data.error), code: data.code };
    return null;
  } catch {
    return null;
  }
}

export async function apiGetStockItemSubcategories(): Promise<{ subcategories: StockArticleSubcategoryRow[] } | null> {
  try {
    const res = await fetch(apiUrl("/api/settings/stock-item-subcategories"), { credentials: "include" });
    if (!res.ok) return null;
    return await parseJson<{ subcategories: StockArticleSubcategoryRow[] }>(res);
  } catch {
    return null;
  }
}

export async function apiPutStockItemSubcategories(body: {
  subcategories: Omit<StockArticleSubcategoryRow, "categoryLabel">[];
}): Promise<
  | { subcategories: StockArticleSubcategoryRow[] }
  | { error: string; code?: string }
  | null
> {
  try {
    const res = await fetch(apiUrl("/api/settings/stock-item-subcategories"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ subcategories?: StockArticleSubcategoryRow[]; error?: string; code?: string }>(res);
    if (res.status === 200 && data?.subcategories) return { subcategories: data.subcategories };
    if (data && "error" in data && data.error) return { error: String(data.error), code: data.code };
    return null;
  } catch {
    return null;
  }
}

export async function apiGetStockDepots(): Promise<{ depots: StockDepotSetting[] } | null> {
  try {
    const res = await fetch(apiUrl("/api/settings/stock-depots"), { credentials: "include" });
    if (!res.ok) return null;
    return await parseJson<{ depots: StockDepotSetting[] }>(res);
  } catch {
    return null;
  }
}

export async function apiPostStockDepot(body: {
  label: string;
}): Promise<{ ok: true; depot: StockDepotSetting } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl("/api/settings/stock-depots"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ depot?: StockDepotSetting; code?: string }>(res);
    if (res.status === 201 && data?.depot) return { ok: true, depot: data.depot };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}

export async function apiPatchStockDepot(
  id: string,
  body: { label?: string; active?: boolean },
): Promise<{ ok: true; depot: StockDepotSetting } | { ok: false; code: string }> {
  try {
    const res = await fetch(apiUrl(`/api/settings/stock-depots/${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = await parseJson<{ depot?: StockDepotSetting; code?: string }>(res);
    if (res.status === 200 && data?.depot) return { ok: true, depot: data.depot };
    return { ok: false, code: data?.code ?? "error" };
  } catch {
    return { ok: false, code: "network_error" };
  }
}
