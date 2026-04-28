/** Codes d’échec renvoyés par `apiLogin` / le contexte d’authentification. */
export type LoginFailureCode =
  | "invalid_credentials"
  | "inactive"
  | "network_error"
  | "2fa_required"
  | "invalid_totp";
