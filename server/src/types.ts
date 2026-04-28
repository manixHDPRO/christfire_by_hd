/** Libellé d’un rôle défini dans `app_user_roles` (liste dynamique). */
export type UserRole = string;

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  /** Dernière connexion réussie (mot de passe /2FA), ISO. */
  lastLoginAt?: string | null;
  totpEnabled?: boolean;
  /** Points de vente comptoir assignés (caisse buvette / boutique). */
  pointOfSaleIds?: string[];
};

export type JwtPayload = {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
  /** Identifiant de session serveur (révocation). */
  sid?: string;
};
