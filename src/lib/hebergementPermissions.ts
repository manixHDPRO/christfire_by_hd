/** Droits requis par entrée du menu « Hébergement » (navigation, palette, garde de route). */
export const HEBERGEMENT_ROUTE_PERMS: Readonly<Record<string, readonly string[]>> = {
  "/bungalows": ["lodging.bungalows"],
  "/menage": ["lodging.housekeeping", "lodging.bungalows"],
  "/maintenance": ["lodging.maintenance"],
  "/reservations": ["lodging.reservations"],
  "/accueil-sejour": ["lodging.stay_reception"],
  /** Encaissements réservations + droit d’entrée visiteur (même logique que Finance → Paiement). */
  "/caisse-reception": [
    "lodging.reception_cash",
    "lodging.reservations",
    "lodging.stay_reception",
    "finance.payments",
  ],
};
