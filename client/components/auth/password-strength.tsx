"use client";

import { motion } from "motion/react";
import { passwordScore } from "@/lib/validation/auth";

const labels = ["Too short", "Weak", "Okay", "Good", "Strong"];
const colors = ["#ef4444", "#f97316", "#eab308", "#16a34a", "#16a34a"];

export function PasswordStrength({ password }: { password: string }) {
  if (!password) {
    return <p className="text-[12.5px] text-muted">At least 8 characters.</p>;
  }
  const score = password.length < 8 ? 0 : passwordScore(password);

  return (
    <div className="flex items-center gap-3 pt-0.5" aria-live="polite">
      <div className="flex flex-1 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-line">
            <motion.div
              className="h-full"
              initial={false}
              animate={{ width: i <= Math.max(score, 1) ? "100%" : "0%", backgroundColor: colors[score] }}
              transition={{ duration: 0.25 }}
            />
          </div>
        ))}
      </div>
      <span className="w-16 text-right text-[12px] text-muted">{labels[score]}</span>
    </div>
  );
}
