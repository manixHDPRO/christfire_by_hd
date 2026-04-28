export const BOOKING_CHANNELS = ["direct", "ota", "telephone", "agence", "autre"] as const;
export type BookingChannelCode = (typeof BOOKING_CHANNELS)[number];

export const BOOKING_CHANNEL_LABELS_FR: Record<BookingChannelCode, string> = {
  direct: "Direct",
  ota: "OTA / plateforme",
  telephone: "Téléphone",
  agence: "Agence",
  autre: "Autre",
};

export function normalizeBookingChannel(raw: string | null | undefined): BookingChannelCode {
  const s = (raw ?? "direct").trim().toLowerCase();
  if (BOOKING_CHANNELS.includes(s as BookingChannelCode)) return s as BookingChannelCode;
  return "autre";
}

export function bookingChannelLabelFr(code: string): string {
  const n = normalizeBookingChannel(code);
  return BOOKING_CHANNEL_LABELS_FR[n];
}
