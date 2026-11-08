"use client";

import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/utils";

// Same look as <Field>: label on top, error/hint below.

interface WrapperProps {
  label: string;
  error?: string;
  hint?: React.ReactNode;
  labelAside?: React.ReactNode;
  id: string;
  children: React.ReactNode;
}

function FieldWrapper({ label, error, hint, labelAside, id, children }: WrapperProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        {labelAside}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[12.5px] text-red-600">
          {error}
        </p>
      ) : hint ? (
        <div id={`${id}-hint`} className="text-[12.5px] text-muted">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

const control = (error?: string) =>
  cn(
    "w-full rounded-lg border bg-card px-3.5 text-[15px] text-ink placeholder:text-ink/30 transition-[border-color,box-shadow] duration-150 focus:outline-none",
    error
      ? "border-red-500 focus:shadow-[0_0_0_3px_rgb(239_68_68/0.15)]"
      : "border-line hover:border-ink/25 focus:border-ink focus:shadow-[0_0_0_3px_rgb(255_90_31/0.18)]",
  );

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> &
  Omit<WrapperProps, "id" | "children"> & { ref?: React.Ref<HTMLTextAreaElement> };

export function Textarea({ label, error, hint, labelAside, id, className, rows = 4, ref, ...props }: TextareaProps) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <FieldWrapper label={label} error={error} hint={hint} labelAside={labelAside} id={inputId}>
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        className={cn(control(error), "resize-y py-2.5 leading-relaxed", className)}
        {...props}
      />
    </FieldWrapper>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> &
  Omit<WrapperProps, "id" | "children"> & {
    options: { value: string; label: string; disabled?: boolean }[];
    placeholder?: string;
    ref?: React.Ref<HTMLSelectElement>;
  };

/** Native <select> (best on mobile and for accessibility), styled to match. */
export function Select({ label, error, hint, labelAside, id, className, options, placeholder, ref, ...props }: SelectProps) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <FieldWrapper label={label} error={error} hint={hint} labelAside={labelAside} id={inputId}>
      <div className="relative">
        <select
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          className={cn(control(error), "h-11 appearance-none pr-10", className)}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
      </div>
    </FieldWrapper>
  );
}
