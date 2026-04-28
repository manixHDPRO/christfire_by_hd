import type { AuthUser } from "@/types";

export function userHasPermission(user: AuthUser | null | undefined, code: string): boolean {
  if (!user) return false;
  if (user.isAppAdmin) return true;
  return user.permissions?.includes(code) ?? false;
}

export function userHasAnyPermission(
  user: AuthUser | null | undefined,
  codes: readonly string[],
): boolean {
  return codes.some((c) => userHasPermission(user, c));
}
