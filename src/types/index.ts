export type BungalowCategory = "Premium" | "Deluxe" | "Standard";
export type BungalowStatus = "Disponible" | "Réservé" | "Occupé" | "Maintenance" | "Hors service";

/** État ménage du logement (indépendant du statut locatif). */
export type HousekeepingStatus = "Propre" | "À nettoyer" | "En cours" | "Contrôlé";
export type ReservationStatus =
  | "En attente paiement"
  | "Confirmé"
  | "En cours"
  | "Terminé"
  | "No-show";
export type PaymentStatus = "En attente" | "Partiel" | "Payé" | "Remboursé";

/** Moyen d’encaissement enregistré dans le journal des paiements (SQLite / API). */
export type ReservationPaymentMethod = "Espèces" | "Carte" | "Virement" | "Autre";

/** Devise de saisie d’un encaissement (montant du séjour / droit d’entrée reste comptabilisé en USD). */
export type PaymentCurrencyCode = "USD" | "CDF";

/** Individuel : un bungalow ; groupe : plusieurs bungalows + effectif renseigné. */
export type ReservationKind = "individual" | "group";

/** Canal d’acquisition (rapports / pilotage). */
export type BookingChannel = "direct" | "ota" | "telephone" | "agence" | "autre";

/** Vente au comptoir / service salle (CDF), sans réservation bungalow. */
export interface CounterSale {
  id: string;
  /** Référence facture (`CF-AAAAMMJJ-NNNN`, date sans tirets) — commune au bon cuisine et au journal de caisse. */
  invoiceRef?: string;
  /** Montant encaissé en francs congolais (entier). */
  amountCdf: number;
  method: string;
  /** Libellé court ou récap. articles. */
  label: string;
  note: string;
  clientId: string | null;
  clientName: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
  pointOfSaleId: string | null;
  pointOfSaleLabel: string | null;
  /** Table (service salle), si renseignée. */
  diningTableId?: string | null;
  diningTableCode?: string | null;
  diningTableLabel?: string | null;
  /** Nombre de lignes article (zéro = vente montant libre). */
  linesCount?: number;
}

export interface CounterSaleLine {
  id: string;
  itemId: string;
  qty: number;
  unitPriceUsdCents: number;
  lineTotalCdf: number;
  label: string;
}

/** Détail vente avec lignes (GET /api/counter-sales/:id). */
export interface CounterSaleDetail extends CounterSale {
  lines: CounterSaleLine[];
}

export interface CounterSaleMenuItem {
  id: string;
  code: string;
  label: string;
  unit: string;
  unitLabel: string;
  salePriceUsdCents: number;
  unitPriceCdf: number;
  /** Boissons stockées au point de vente (sous-cat. logistique) : contrôle de quantité locale. */
  requiresPosStock?: boolean;
  /** Solde mouvements de stock pour l’emplacement lié à la caisse/terrasse (si applies). */
  qtyAtSaleLocation?: number;
}

/** Liste des tables pour une caisse (service salle). */
export interface CounterDiningTableOption {
  id: string;
  code: string;
  label: string;
  seats: number;
  sortOrder: number;
}

/** Plan de salle (tables + onglets ouverts service salle). */
export type FloorBoardCell =
  | {
      tableId: string;
      code: string;
      label: string;
      seats: number;
      sortOrder: number;
      vacant: true;
    }
  | {
      tableId: string;
      code: string;
      label: string;
      seats: number;
      sortOrder: number;
      vacant: false;
      tabId: string | null;
      canEdit: boolean;
      openedByName?: string;
      lineCount?: number;
      totalCdf?: number;
    };

/** Détail addition en cours pour une table (GET /api/floor-tabs/:id). */
export interface FloorServiceTabDetail {
  id: string;
  /** Référence facture (`CF-AAAAMMJJ-NNNN`) — identique après encaisse sur la vente caisse et sur le bon PDF. */
  invoiceRef: string;
  pointOfSaleId: string;
  diningTableId: string;
  tableCode: string;
  tableLabel: string;
  openedByUserId: string;
  /** Nom affiché du serveur qui a ouvert l’addition (caisse / ticket). */
  openedByName?: string;
  openedAt: string;
  note: string;
  lines: {
    itemId: string;
    qty: number;
    label: string;
    unitPriceUsdCents: number;
    lineTotalCdf: number;
  }[];
  totalCdf: number;
}

/** Synthèse ventes comptoir par caisse et par jour (trésorerie). */
export interface TreasuryCounterRollupRow {
  pointOfSaleId: string | null;
  pointOfSaleLabel: string | null;
  day: string;
  totalCdf: number;
  cashCdf: number;
  nonCashCdf: number;
  saleCount: number;
}

/** Rapport journalier déposé par une caisse (fond + comptage vs ventes système). */
export interface TreasuryRegisterReport {
  id: string;
  pointOfSaleId: string;
  pointOfSaleLabel: string | null;
  reportDate: string;
  openingFloatCdf: number;
  countedCashCdf: number;
  notesCashier: string;
  submittedByUserId: string | null;
  submittedByName: string | null;
  submittedAt: string;
  /** En attente de validation trésorerie, ou validé (comptabilisé au livre de caisse si montant > 0). */
  status: "submitted" | "validated";
  validatedAt: string | null;
  validatedByUserId: string | null;
  validatedByName: string | null;
  cashBookMovementId: string | null;
  notesTreasury: string;
  /** Total espèces enregistré dans les ventes comptoir pour cette caisse et ce jour. */
  systemCashSalesCdf: number;
  /** Fond de caisse + ventes espèces système. */
  expectedCashCdf: number;
  /** Écart : comptage physique − attendu. */
  varianceCdf: number;
}

/** Rapport journalier caisse réception (USD) : réservations + droits d’entrée visiteur en espèces. */
export interface ReceptionRegisterReport {
  id: string;
  reportDate: string;
  /** Utilisateur propriétaire du rapport (clôture individuelle). */
  reportOwnerUserId: string;
  openingFloatUsd: number;
  countedCashUsd: number;
  notesCashier: string;
  submittedByUserId: string | null;
  submittedByName: string | null;
  submittedAt: string;
  status: "submitted" | "validated";
  validatedAt: string | null;
  validatedByUserId: string | null;
  validatedByName: string | null;
  cashBookMovementId: string | null;
  notesTreasury: string;
  /** Total espèces USD enregistrées (paiements séjour + journal visiteur) pour ce jour. */
  systemCashSalesUsd: number;
  expectedCashUsd: number;
  varianceUsd: number;
}

/** Aperçu situation journalière caisse réception (avant enregistrement de la clôture). */
export interface ReceptionCashRegisterSituation {
  businessDate: string;
  /** Espèces USD (équivalent) enregistrées sur les séjours, à votre nom. */
  reservationPaymentsCashUsd: number;
  /** Espèces USD enregistrées sur les droits d’entrée visiteur, à votre nom. */
  visitorEntryCashUsd: number;
  /** Somme : base du calcul « attendu caisse » avec le fond d’ouverture. */
  systemCashSalesUsd: number;
  /** Fond d’ouverture fixé par la trésorerie à l’ouverture de journée (USD). */
  treasuryOpeningFloatUsd?: number;
}

/** Aperçu situation journalière caisse comptoir (avant enregistrement du rapport). */
export interface CounterCashRegisterSituation {
  businessDate: string;
  pointOfSaleId: string;
  pointOfSaleLabel: string;
  /** Espèces CDF enregistrées par vous sur cette caisse et ce jour. */
  systemCashSalesCdf: number;
  /** Total toutes méthodes (CDF) pour vous sur cette caisse et ce jour. */
  totalSalesCdf: number;
  /** Nombre de ventes comptoir enregistrées (toutes méthodes). */
  saleCount: number;
  /** Fond d’ouverture fixé par la trésorerie pour cette caisse ; null si le caissier le saisit lui-même. */
  treasuryOpeningFloatCdf?: number | null;
}

/** Journée d’exploitation caisse (ouverture par la trésorerie, fuseau serveur / local SQLite). */
export interface TreasuryCashDayToday {
  businessDate: string;
  opened: boolean;
  openedAt: string | null;
  openedByName: string | null;
  /** Présent lorsque la journée est ouverte : fond réception (USD) saisi à l’ouverture. */
  receptionOpeningFloatUsd?: number;
  /** Fonds comptoir (CDF) enregistrés par la trésorerie à l’ouverture, par caisse. */
  counterTreasuryOpenings?: { pointOfSaleId: string; pointOfSaleLabel: string; openingFloatCdf: number }[];
}

export interface TreasuryOverviewPayload {
  from: string;
  to: string;
  counterRollup: TreasuryCounterRollupRow[];
  registerReports: TreasuryRegisterReport[];
  receptionRegisterReports: ReceptionRegisterReport[];
  /** Présent si le serveur est à jour ; sinon les clients peuvent consulter `/cash-day-status`. */
  cashDayToday?: TreasuryCashDayToday;
}

/** Livre de caisse central (dépenses, dépôts banque, soldes). */
export type FinanceCashMovementCategory =
  | "expense"
  | "bank_deposit"
  | "bank_withdrawal"
  | "adjustment_in"
  | "adjustment_out";

export interface FinanceCashAccount {
  id: string;
  code: string;
  label: string;
  kind: "physical" | "bank";
  currency: "CDF" | "USD";
  sortOrder: number;
  balance: number;
}

export interface FinanceCashMovement {
  id: string;
  category: FinanceCashMovementCategory;
  occurredAt: string;
  sourceAccountId: string | null;
  targetAccountId: string | null;
  amount: number;
  currency: string;
  label: string;
  note: string;
  createdAt: string;
  createdByUserId: string | null;
  sourceAccountLabel: string | null;
  targetAccountLabel: string | null;
  createdByName: string | null;
}

/** Ligne du journal des encaissements (données réelles via GET /api/payments). */
export interface ReservationPaymentLedgerRow {
  id: string;
  reservationId: string;
  /** Montant saisi dans `currency` (entier USD ou CDF). */
  amount: number;
  /** Devise de saisie ; défaut USD pour les lignes historiques. */
  currency?: PaymentCurrencyCode;
  /** Crédit USD appliqué au solde réservation (après conversion CDF si besoin). */
  amountUsdEquivalent?: number;
  method: string;
  note: string;
  createdAt: string;
  clientName: string;
  bungalowCode: string;
  stayStart: string;
  stayEnd: string;
  reservationTotal: number;
  reservationStatus: ReservationStatus;
  /** Cumul encaissé sur la réservation après cette opération (historique cohérent). */
  reservationAmountPaid: number;
}

export interface Bungalow {
  id: string;
  code: string;
  label: string;
  category: BungalowCategory;
  /** Si défini (≥ 0), prix / nuit utilisé pour les nouvelles réservations à la place du tarif grille de la catégorie. */
  pricePerNightUsd?: number | null;
  rooms: 1 | 2;
  capacity: 1 | 2 | 3;
  description: string;
  image: string;
  amenities: string[];
  status: BungalowStatus;
  /** Ménage / préparation chambre — défaut côté affichage : Propre si absent (API ancienne). */
  housekeepingStatus?: HousekeepingStatus;
  createdAt?: string;
  updatedAt?: string;
}

/** Définition d’un profil client (table `client_profile_types`, gérée en paramètres admin). */
export interface ClientProfileType {
  code: string;
  label: string;
  hint: string;
  emailOptional: boolean;
  /** Si vrai : chaque client de ce profil a un droit d’entrée (USD) sur la fiche ; le montant de référence est dans Paramètres → Tarification. */
  appliesEntryFee: boolean;
  sortOrder: number;
}

/** Codes historiques utilisés par les données mock. */
export type ClientProfileKind = "hebergement" | "passage" | "mixte";

/** Composition du visiteur (profils avec droit d’entrée). */
export type VisitorVisitKind = "individual" | "group" | "family";

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
  /** Code profil (ex. `hebergement`, `passage`, ou tout code défini en base). */
  clientProfile: string;
  /** Droit d’entrée en dollars US (profils avec frais d’entrée). Sinon 0. */
  entryFeeUsd: number;
  /** Part du droit d’entrée déjà encaissée (USD). */
  entryFeePaidUsd?: number;
  /** Type de visite (profil avec droit d’entrée). */
  visitorVisitKind?: VisitorVisitKind | null;
  /** Nombre d’adultes (groupe ou famille uniquement). */
  visitorAdultsCount?: number | null;
  /** Nombre de mineurs (groupe ou famille uniquement). */
  visitorMinorsCount?: number | null;
  /** Synthèse effectif (1 = individuel, adultes + mineurs sinon) ; conservé pour données anciennes sans kind. */
  visitorPartyCount?: number | null;
  /** Date de création fiche (ISO), pour pièces / facturation visiteur. */
  createdAt?: string;
  /** Dernière modification (ISO). */
  updatedAt?: string;
}

export interface Reservation {
  id: string;
  clientId: string;
  bungalowId: string;
  /** Tous les bungalows (si absent, on utilise `bungalowId` seul). */
  bungalowIds?: string[];
  reservationKind?: ReservationKind;
  /** Canal de réservation (défaut : direct). */
  bookingChannel?: BookingChannel;
  start: string;
  end: string;
  status: ReservationStatus;
  /** Montant total du séjour */
  amount: number;
  /** Somme déjà encaissée (acompte ou total) */
  amountPaid: number;
  /** Pénalité USD si le client ne s’est pas présenté dans le délai après le début (paramétrable admin). */
  latePenaltyUsd?: number;
  /**
   * Nombre de personnes (réservation **groupe** uniquement, ≥ 2).
   * Pour une réservation individuelle, l’API renvoie 1 et l’UI ne l’affiche pas.
   */
  guestCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Ligne du journal d’audit (admin). */
export interface AuditLogEntry {
  id: string;
  at: string;
  action: "create" | "update" | "delete";
  entityType: string;
  entityId: string;
  summary: string;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
}

/** Ticket maintenance technique (bungalow, priorité, pièces jointes, fil d’événements). */
export type MaintenanceTicketCategory = "panne" | "clim" | "plomberie" | "electricite" | "autre";
export type MaintenanceTicketPriority = "basse" | "normale" | "haute" | "urgente";
export type MaintenanceTicketStatus = "ouvert" | "en_cours" | "resolu" | "annule";
export type MaintenanceTicketEventKind =
  | "created"
  | "comment"
  | "status"
  | "priority"
  | "attachment"
  | "edit";

export interface MaintenanceTicket {
  id: string;
  bungalowId: string;
  bungalowCode?: string;
  category: MaintenanceTicketCategory;
  title: string;
  description: string;
  priority: MaintenanceTicketPriority;
  status: MaintenanceTicketStatus;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
}

export interface MaintenanceTicketEvent {
  id: string;
  ticketId: string;
  kind: MaintenanceTicketEventKind;
  body: string;
  meta: Record<string, unknown>;
  createdAt: string;
  userId: string | null;
  userName: string | null;
}

export interface MaintenanceTicketAttachment {
  id: string;
  ticketId: string;
  fileName: string;
  mimeType: string;
  byteLength: number;
  createdAt: string;
  createdByUserId: string | null;
}

/** Délai max après le début du séjour (1–5 j) et montant de pénalité si non occupé. */
export interface OccupancyRules {
  graceDays: number;
  penaltyUsd: number;
}

/** Ligne du journal d’encaissement droit d’entrée visiteur (`visitor_entry_payment_ledger`). */
export interface VisitorEntryPaymentLedgerRow {
  id: string;
  clientId: string;
  /** Crédit USD sur le droit d’entrée. */
  amountUsd: number;
  /** Montant saisi (USD ou CDF selon `currency`). */
  amountNominal?: number;
  currency?: PaymentCurrencyCode;
  method: string;
  note: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  /** Réservation, ou `visitor-{clientId}` pour le droit d’entrée visiteur. */
  reservationId: string;
  clientId: string;
  number: string;
  total: number;
  payment: PaymentStatus;
  issuedAt: string;
  /** Nature de la ligne (facturation). */
  lineLabel?: string;
}

/** Libellé d’un rôle (table `app_user_roles`, configurable par l’administrateur). */
export type UserRole = string;

/** Entrée du catalogue des droits (API `/api/user-roles/permission-catalog`). */
export interface PermissionCatalogEntry {
  code: string;
  labelFr: string;
  sortOrder: number;
  groupFr: string;
}

/** Définition d’un rôle utilisateur (Paramètres → Rôles). */
export interface AppUserRole {
  id: string;
  label: string;
  sortOrder: number;
  isSystem: boolean;
  isAppAdmin: boolean;
  canManageAppUsers: boolean;
  allowNonAdminInvite: boolean;
  /** Droits effectifs (admin application = liste complète). */
  permissions: string[];
}

export interface SystemUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  /** Dernière connexion réussie (ISO), si enregistrée. */
  lastLoginAt?: string | null;
  totpEnabled?: boolean;
  /** Caisses comptoir assignées (API utilisateurs). */
  pointOfSaleIds?: string[];
}

/** Session applicative (appareil / navigateur). */
export interface AuthSessionInfo {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string;
  ip: string;
  isCurrent: boolean;
}

/** Session active — vue administrateur (tous les utilisateurs). */
export interface AdminActiveSession {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userRole: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string;
  ip: string;
}

/** Invitation utilisateur en attente d’acceptation (lien sécurisé). */
export interface UserInvitationPending {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  expiresAt: string;
  createdAt: string;
}

/** Utilisateur authentifié (session applicative, sans secrets). */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isAppAdmin: boolean;
  canManageAppUsers: boolean;
  /** Codes de permission effectifs pour l’interface (admin = tous). */
  permissions: string[];
  lastLoginAt?: string | null;
  totpEnabled?: boolean;
}

/** Clôture comptable enregistrée (GET /api/night-audit/closures). */
export interface AccountingDayClosure {
  businessDate: string;
  closedAt: string;
  closedByUserId: string | null;
  closedByName: string | null;
  notes: string;
  expectedCashUsd: number;
  expectedCashCdf: number;
  countedCashUsd: number | null;
  countedCashCdf: number | null;
  fxCdfPerUsdSnapshot: number;
  varianceCashUsd: number | null;
  varianceCashCdf: number | null;
}

/** Synthèse journalière pour audit / rapprochement caisse. */
export interface NightAuditSummary {
  businessDate: string;
  fxCdfPerUsd: number;
  closure: AccountingDayClosure | null;
  expectedCashUsd: number;
  expectedCashCdf: number;
  reservationPayments: {
    count: number;
    totalUsd: number;
    byMethod: Record<string, number>;
    cashUsd: number;
    lines: Array<{
      id: string;
      reservationId: string;
      amountUsd: number;
      /** Montant saisi (USD ou CDF). */
      amountNominal: number;
      currency: PaymentCurrencyCode;
      method: string;
      note: string;
      createdAt: string;
      clientName: string;
      bungalowCode: string;
    }>;
  };
  visitorEntryPayments: {
    count: number;
    totalUsd: number;
    byMethod: Record<string, number>;
    cashUsd: number;
    lines: Array<{
      id: string;
      clientId: string;
      amountUsd: number;
      amountNominal: number;
      currency: PaymentCurrencyCode;
      method: string;
      note: string;
      createdAt: string;
      clientName: string;
    }>;
  };
  counterSales: {
    count: number;
    totalCdf: number;
    byMethod: Record<string, number>;
    cashCdf: number;
    lines: Array<{
      id: string;
      amountCdf: number;
      method: string;
      label: string;
      note: string;
      createdAt: string;
      clientName: string | null;
      pointOfSaleLabel: string | null;
    }>;
  };
}

export interface CategoryRate {
  category: BungalowCategory;
  /** Prix par nuit en dollars US ($) */
  pricePerNightUSD: number;
}

/** Réponse GET /api/reports/kpis — indicateurs de pilotage hébergement. */
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

/** Ligne référentiel catégories (SQLite + mock) : clé métier fixe + libellé affiché. */
export interface BungalowCategoryRow {
  key: BungalowCategory;
  /** Libellé « Catégorie » affiché dans l’app (modifiable en base). */
  label: string;
}

/** Workflow opérationnel check-in / check-out (au-delà du statut réservation). */
export interface OperationalWorkflow {
  reservationId: string;
  /** Code pays ISO 3166-1 alpha-2 pour le jeu de documents légaux. */
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
  updatedAt: string;
}

/** Ligne liste accueil séjour (réservation + workflow fusionné). */
export interface OperationalWorkflowListItem {
  reservationId: string;
  clientId: string;
  clientName: string;
  bungalowCodes: string;
  start: string;
  end: string;
  status: ReservationStatus;
  workflow: OperationalWorkflow;
  hasPersistedWorkflow: boolean;
}

/** Catégories « métier » articles stock (codes référentiels en base). */
export type StockItemCategory =
  | "general"
  | "restauration"
  | "minibar"
  | "linge"
  | "hygiene_entretien"
  | "consommables_chambre";

/** GET /api/inventory/article-refs — catégories, unités et sous-catégories actives. */
export interface InventoryArticleRefs {
  categories: { code: string; label: string; sortOrder: number }[];
  units: { code: string; label: string; sortOrder: number }[];
  subcategories: { code: string; categoryCode: string; label: string; sortOrder: number }[];
}

export interface StockLocation {
  id: string;
  code: string;
  label: string;
  kind: "depot" | "consumption";
  sortOrder: number;
  active: boolean;
}

/** GET /api/settings/stock-depots — lieux de stockage type dépôt (réceptions, inventaires). */
export interface StockDepotSetting {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  active: boolean;
}

/** Point de vente / terrasse (caisse comptoir) pour configuration des tables salle. */
export interface TerracePointOfSaleOption {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  active: boolean;
}

/** Table de salle rattachée à une terrasse (point de vente). */
export interface DiningTerraceTableSetting {
  id: string;
  pointOfSaleId: string;
  code: string;
  label: string;
  seats: number;
  sortOrder: number;
  active: boolean;
}

export interface StockItem {
  id: string;
  code: string;
  label: string;
  unit: string;
  unitQty: number;
  unitLabel?: string;
  category: string;
  categoryLabel?: string;
  /** Code sous-catégorie (référentiel Paramètres) ; vide si aucune. */
  subcategory?: string;
  subcategoryLabel?: string | null;
  active: boolean;
  avgCostCdf: number;
  /** Prix de vente public en centimes USD (250 = 2,50 USD). Hors CMP achat (CDF). */
  salePriceUsdCents: number;
  createdAt: string;
}

export interface StockSupplier {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  /** Adresse physique (siège, entrepôt, etc.). */
  address: string;
  leadTimeDays?: number | null;
  active: boolean;
  createdAt: string;
}

export interface StockBalanceRow {
  itemId: string;
  locationId: string;
  qty: number;
  itemCode: string;
  itemLabel: string;
  itemUnit: string;
  avgCostCdf: number;
  locationCode: string;
  locationLabel: string;
  locationKind: string;
}

export interface StockDocumentMovement {
  itemId: string;
  itemCode: string;
  itemLabel: string;
  locationId: string;
  locationLabel: string;
  qtyDelta: number;
  unitCostCdf: number;
  ledgerKind: string;
}

export interface StockDocument {
  id: string;
  docType: string;
  supplierId: string | null;
  supplierName: string | null;
  fromLocationId: string | null;
  fromLocationLabel: string | null;
  toLocationId: string | null;
  toLocationLabel: string | null;
  externalRef: string;
  note: string;
  createdAt: string;
  createdByUserId: string | null;
  createdByName: string | null;
  purchaseOrderId: string | null;
  purchaseOrderExternalRef: string | null;
  movements: StockDocumentMovement[];
}

export interface PurchaseOrderListRow {
  id: string;
  status: string;
  externalRef: string;
  createdAt: string;
  submittedAt: string | null;
  supplierName: string;
  managerApprovedAt: string | null;
  dgApprovedAt: string | null;
  financeReleasedAt: string | null;
  accountingReleasedAt: string | null;
  /** Si renseigné : un paiement fournisseur unique a été enregistré au livre de caisse (CDF). */
  supplierPaymentRecordedAt: string | null;
  estimatedTotalCdf: number;
}

export interface PurchaseOrderLineDetail {
  id: string;
  itemId: string;
  itemCode: string;
  itemLabel: string;
  itemUnit: string;
  qtyOrdered: number;
  qtyReceived: number;
  qtyRemaining: number;
  unitCostCdfEst: number;
  sortOrder: number;
}

export interface PurchaseOrderDetail {
  id: string;
  supplierId: string;
  supplierName: string;
  status: string;
  note: string;
  externalRef: string;
  createdAt: string;
  createdByUserId: string | null;
  submittedAt: string | null;
  managerApprovedByUserId: string | null;
  managerApprovedAt: string | null;
  managerApprovedByName: string | null;
  dgApprovedByUserId: string | null;
  dgApprovedAt: string | null;
  dgApprovedByName: string | null;
  financeReleasedByUserId: string | null;
  financeReleasedAt: string | null;
  financeFundingDetail: string;
  financeReleasedByName: string | null;
  accountingReleasedByUserId: string | null;
  accountingReleasedAt: string | null;
  accountingFundingDetail: string;
  accountingReleasedByName: string | null;
  rejectedByUserId: string | null;
  rejectedAt: string | null;
  rejectionNote: string;
  rejectedByName: string | null;
  createdByName: string | null;
  estimatedTotalCdf: number;
  /** Date d’enregistrement du paiement fournisseur unique (livre de caisse, CDF = total des lignes). */
  supplierPaymentRecordedAt: string | null;
  supplierPaymentMovementId: string | null;
  lines: PurchaseOrderLineDetail[];
}

/** Bon approuvé avec lignes restant à réceptionner (GET eligible-for-receipt). */
export interface PurchaseOrderEligibleForReceipt {
  id: string;
  externalRef: string;
  supplierId: string;
  supplierName: string;
  estimatedTotalCdf: number;
  lines: PurchaseOrderLineDetail[];
}

export interface StockArticleRefRow {
  code: string;
  label: string;
  sortOrder: number;
  active: boolean;
}

export interface StockArticleRef {
  categories: StockArticleRefRow[];
  units: StockArticleRefRow[];
}

/** Sous-catégorie d’article (rattachée à une catégorie parente). */
export interface StockArticleSubcategoryRow {
  code: string;
  categoryCode: string;
  categoryLabel: string;
  label: string;
  sortOrder: number;
  active: boolean;
}

export interface StockDashboardAlert {
  kind: string;
  severity: string;
  itemId: string;
  locationId: string;
  itemCode: string;
  itemLabel: string;
  locationLabel: string;
  qty: number;
  minQty: number | null;
  maxQty: number | null;
  reorderPoint: number | null;
  message: string;
}

export interface StockToOrderLine {
  itemId: string;
  locationId: string;
  itemCode: string;
  itemLabel: string;
  itemUnit: string;
  locationLabel: string;
  qty: number;
  minQty: number | null;
  maxQty: number | null;
  reorderPoint: number | null;
  triggerLevel: number;
  suggestedQty: number;
  supplierLeadDaysMax: number | null;
}

/** GET /api/inventory/reorder-policies — seuils min / max / point de commande par article et lieu. */
export interface StockReorderPolicyRow {
  itemId: string;
  locationId: string;
  minQty: number | null;
  maxQty: number | null;
  reorderPoint: number | null;
  itemCode: string;
  itemLabel: string;
  locationCode: string;
  locationLabel: string;
}
