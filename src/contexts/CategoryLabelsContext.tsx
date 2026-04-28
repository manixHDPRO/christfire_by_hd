import { bungalowCategoriesSeed } from "@/data/mock";
import { apiGetBungalowCategories } from "@/lib/api";
import type { BungalowCategory } from "@/types";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const ORDER: BungalowCategory[] = ["Premium", "Deluxe", "Standard"];

function labelsFromSeed(): Record<BungalowCategory, string> {
  const m = { Premium: "Premium", Deluxe: "Deluxe", Standard: "Standard" } as Record<BungalowCategory, string>;
  for (const row of bungalowCategoriesSeed) {
    m[row.key] = row.label;
  }
  return m;
}

const defaultLabels: Record<BungalowCategory, string> = {
  Premium: "Premium",
  Deluxe: "Deluxe",
  Standard: "Standard",
};

type CategoryLabelsContextValue = {
  labelFor: (key: BungalowCategory) => string;
  refreshCategoryLabels: () => Promise<void>;
};

const CategoryLabelsContext = createContext<CategoryLabelsContextValue | null>(null);

export function CategoryLabelsProvider({ children }: { children: ReactNode }) {
  const [labels, setLabels] = useState<Record<BungalowCategory, string>>(defaultLabels);

  const refreshCategoryLabels = useCallback(async () => {
    const rows = await apiGetBungalowCategories();
    if (!rows?.length) {
      setLabels(labelsFromSeed());
      return;
    }
    const next = { ...defaultLabels };
    for (const row of rows) {
      next[row.key] = row.label;
    }
    setLabels(next);
  }, []);

  useEffect(() => {
    void refreshCategoryLabels();
  }, [refreshCategoryLabels]);

  const value = useMemo<CategoryLabelsContextValue>(
    () => ({
      labelFor: (key) => labels[key] ?? key,
      refreshCategoryLabels,
    }),
    [labels, refreshCategoryLabels],
  );

  return <CategoryLabelsContext.Provider value={value}>{children}</CategoryLabelsContext.Provider>;
}

export function useCategoryLabels(): CategoryLabelsContextValue {
  const ctx = useContext(CategoryLabelsContext);
  if (!ctx) {
    return {
      labelFor: (key) => key,
      refreshCategoryLabels: async () => {},
    };
  }
  return ctx;
}

export { ORDER as BUNGALOW_CATEGORY_ORDER };
