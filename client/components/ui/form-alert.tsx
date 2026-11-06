"use client";

import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

export function FormAlert({
  message,
  tone = "error",
  children,
}: {
  message?: string | null;
  tone?: "error" | "success";
  children?: React.ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.div
          key={message}
          role={tone === "error" ? "alert" : "status"}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div
            className={cn(
              "rounded-lg border-l-[3px] px-3.5 py-2.5 text-[13.5px] leading-snug",
              tone === "error" ? "border-red-500 bg-red-50 text-red-800" : "border-emerald-600 bg-emerald-50 text-emerald-900",
            )}
          >
            {message}
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
