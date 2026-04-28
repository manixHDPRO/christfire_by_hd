import { useCategoryLabels } from "@/contexts/CategoryLabelsContext";
import type { BungalowCategory } from "@/types";

const styles: Record<BungalowCategory, string> = {
  Premium:
    "border-brand-red/60 bg-brand-red/20 text-brand-cream ring-1 ring-brand-red/30",
  Deluxe:
    "border-brand-orange/55 bg-brand-orange/15 text-brand-cream ring-1 ring-brand-orange/25",
  Standard:
    "border-white/20 bg-brand-cream/10 text-brand-cream/95 ring-1 ring-white/10",
};

export function CategoryBadge({ category }: { category: BungalowCategory }) {
  const { labelFor } = useCategoryLabels();
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${styles[category]}`}
    >
      {labelFor(category)}
    </span>
  );
}
