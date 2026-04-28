import type { BookingChannel } from "@/types";

export const BOOKING_CHANNEL_OPTIONS: readonly { value: BookingChannel; label: string }[] = [
  { value: "direct", label: "Direct" },
  { value: "ota", label: "OTA / plateforme" },
  { value: "telephone", label: "Téléphone" },
  { value: "agence", label: "Agence" },
  { value: "autre", label: "Autre" },
] as const;

export function bookingChannelLabel(code: string | undefined | null): string {
  const c = (code ?? "direct") as BookingChannel;
  return BOOKING_CHANNEL_OPTIONS.find((o) => o.value === c)?.label ?? code ?? "Direct";
}
