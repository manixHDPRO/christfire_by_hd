import { OrbitalSidebar } from "@/components/nav/OrbitalSidebar";
import { CommandPalette } from "@/components/nav/CommandPalette";
import { usePurchaseOrderSubmittedNotifierForApprovers } from "@/hooks/usePurchaseOrderSubmittedNotifierForApprovers";
import { motion } from "framer-motion";
import { Outlet } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";

export function AppShell() {
  usePurchaseOrderSubmittedNotifierForApprovers();
  const [cmdOpen, setCmdOpen] = useState(false);

  const toggleCmd = useCallback(() => setCmdOpen((o) => !o), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggleCmd();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCmd]);

  return (
    <div className="app-mesh min-h-screen text-stone-900 dark:text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-brand-red/10 blur-[100px] dark:bg-brand-red/10" />
        <div className="absolute bottom-0 right-0 h-[28rem] w-[28rem] rounded-full bg-brand-orange/15 blur-[120px] dark:bg-brand-orange/5" />
      </div>

      <OrbitalSidebar onOpenCommand={() => setCmdOpen(true)} />
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />

      <motion.main
        className="relative min-h-screen pl-[4.5rem] md:pl-[5.25rem]"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <div className="mx-auto max-w-[1400px] px-4 py-8 md:px-8 md:py-10">
          <Outlet />
        </div>
      </motion.main>
    </div>
  );
}
