import { useAuth } from "@/auth/AuthContext";
import { apiListPurchaseOrders } from "@/lib/api";
import {
  playPurchaseOrderSubmittedChime,
  shouldPlayRemoteSubmitSound,
} from "@/lib/notificationSounds";
import { userHasAnyPermission } from "@/lib/permissions";
import { useEffect, useRef } from "react";

const PO_READ = [
  "logistics.inventory",
  "logistics.po_approve_manager",
  "logistics.po_approve_dg",
  "logistics.po_release_finance",
  "logistics.po_release_accounting",
] as const;
const PO_APPROVER = ["logistics.po_approve_manager", "logistics.po_approve_dg"] as const;

const POLL_MS = 28_000;

/**
 * Pour les profils qui peuvent viser un BC : son quand le **nombre** de BC « soumis » augmente
 * (soumission faite par un autre utilisateur / autre onglet). Les soumissions locales
 * passent par `suppressRemotePurchaseOrderSubmitSoundForMs` pour éviter un double signal.
 */
export function usePurchaseOrderSubmittedNotifierForApprovers(): void {
  const { user } = useAuth();
  const lastCountRef = useRef<number | null>(null);

  const active =
    userHasAnyPermission(user, PO_READ) && userHasAnyPermission(user, PO_APPROVER);

  useEffect(() => {
    if (!active) {
      lastCountRef.current = null;
      return;
    }
    let cancelled = false;
    void (async () => {
      const rows = await apiListPurchaseOrders("submitted");
      if (cancelled || rows === null) return;
      lastCountRef.current = rows.length;
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      void (async () => {
        const rows = await apiListPurchaseOrders("submitted");
        if (rows === null) return;
        const n = rows.length;
        const prev = lastCountRef.current;
        if (prev !== null && n > prev && shouldPlayRemoteSubmitSound()) {
          playPurchaseOrderSubmittedChime();
        }
        lastCountRef.current = n;
      })();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [active]);
}
