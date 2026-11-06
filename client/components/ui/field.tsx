"use client";

import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: React.ReactNode;
  /** Rendered on the right side of the label row (e.g. "Forgot password?"). */
  labelAside?: React.ReactNode;
  trailing?: React.ReactNode;
  ref?: React.Ref<HTMLInputElement>;
}

export function Field({ label, error, hint, labelAside, trailing, className, id, ref, ...props }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={inputId} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        {labelAside}
      </div>

      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={[error && errorId, hint && hintId].filter(Boolean).join(" ") || undefined}
          className={cn(
            "h-11 w-full rounded-lg border bg-card px-3.5 text-[15px] text-ink placeholder:text-ink/30",
            "transition-[border-color,box-shadow] duration-150 focus:outline-none",
            error
              ? "border-red-500 focus:shadow-[0_0_0_3px_rgb(239_68_68/0.15)]"
              : "border-line hover:border-ink/25 focus:border-ink focus:shadow-[0_0_0_3px_rgb(255_90_31/0.18)]",
            trailing && "pr-11",
            className,
          )}
          {...props}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>

      <AnimatePresence initial={false} mode="wait">
        {error ? (
          <motion.p
            key="error"
            id={errorId}
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="text-[12.5px] text-red-600"
          >
            {error}
          </motion.p>
        ) : hint ? (
          <motion.div key="hint" id={hintId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {hint}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function PasswordField(props: Omit<FieldProps, "type" | "trailing">) {
  const [visible, setVisible] = useState(false);
  return (
    <Field
      {...props}
      type={visible ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {visible ? "Hide" : "Show"}
        </button>
      }
    />
  );
}
