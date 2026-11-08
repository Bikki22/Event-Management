"use client";

import type { IDetectedBarcode, IScannerError } from "@yudiel/react-qr-scanner";
import { ArrowLeft, Camera, CameraOff, Check, Keyboard, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useDoorEvents, useDoorStats, useScanner } from "@/hooks/use-check-in";
import { normalizeCode, type ScanOutcome } from "@/lib/api/checkin";
import { cn } from "@/lib/utils";

// camera code touches `navigator` on import: browser only
const Scanner = dynamic(() => import("@yudiel/react-qr-scanner").then((m) => m.Scanner), {
  ssr: false,
  loading: () => <CameraPlaceholder icon={<LoaderCircle className="size-7 animate-spin" />} text="Starting camera…" />,
});

/** Admitted results clear themselves so the line keeps moving; rejections wait for a tap. */
const AUTO_DISMISS_MS = 2200;

const time = (iso: string) => new Intl.DateTimeFormat("en-NP", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));

export function ScannerScreen({ eventId }: { eventId: string }) {
  const events = useDoorEvents();
  const event = events.data?.find((e) => e.eventId === eventId);
  const stats = useDoorStats(eventId);
  const { scan, busy, current, dismiss, recent } = useScanner(eventId);
  const [cameraError, setCameraError] = useState<IScannerError | null>(null);
  const [cameraOn, setCameraOn] = useState(true);

  // auto-dismiss a green result
  useEffect(() => {
    if (current?.kind !== "admitted") return;
    const t = window.setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [current, dismiss]);

  const onScan = (codes: IDetectedBarcode[]) => {
    const raw = codes[0]?.rawValue;
    if (!raw || current || busy) return;
    const code = normalizeCode(raw);
    if (code) void scan(code);
  };

  const noAccess = stats.isError && !stats.data;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 pb-10 pt-4">
      <header className="flex items-center gap-3">
        <Link href="/check-in" aria-label="Back to events" className="grid size-11 shrink-0 place-items-center rounded-xl bg-paper/[0.07] transition hover:bg-paper/[0.12]">
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold tracking-[-0.015em]">{event?.title ?? "Check-in"}</p>
          <p className="text-[12.5px] text-paper/50">Door check-in</p>
        </div>
        <Counter checkedIn={stats.data?.checkedIn} issued={stats.data?.issued} />
      </header>

      {noAccess ? (
        <div className="mt-10 rounded-2xl bg-red-500/15 px-5 py-6 text-center">
          <p className="text-[17px] font-semibold text-red-100">You can&apos;t scan for this event</p>
          <p className="mt-1.5 text-[14.5px] text-red-100/70">Ask the organizer to add you as door staff.</p>
        </div>
      ) : (
        <>
          {/* camera + result */}
          <div className="relative mt-4 aspect-square w-full overflow-hidden rounded-3xl bg-black">
            {cameraError ? (
              <CameraPlaceholder icon={<CameraOff className="size-7" />} text={cameraMessage(cameraError)} />
            ) : !cameraOn ? (
              <CameraPlaceholder icon={<CameraOff className="size-7" />} text="Camera off. Type codes below, or turn it back on." />
            ) : (
              <Scanner
                onScan={onScan}
                onError={setCameraError}
                formats={["qr_code"]}
                paused={!!current || busy}
                sound={false}
                constraints={{ facingMode: "environment" }}
                components={{ finder: true, torch: true }}
                styles={{ container: { width: "100%", height: "100%" }, video: { objectFit: "cover" } }}
              />
            )}

            {busy && !current && (
              <div className="absolute inset-0 grid place-items-center bg-black/50">
                <LoaderCircle className="size-10 animate-spin text-paper" />
              </div>
            )}

            <AnimatePresence>{current && <ResultPanel key={current.code + current.kind} outcome={current} onDismiss={dismiss} />}</AnimatePresence>
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => {
                setCameraError(null);
                setCameraOn((on) => !on);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-[13.5px] text-paper/60 transition hover:bg-paper/[0.07] hover:text-paper"
            >
              {cameraOn && !cameraError ? <CameraOff className="size-4" /> : <Camera className="size-4" />}
              {cameraOn && !cameraError ? "Turn camera off" : "Turn camera on"}
            </button>
          </div>

          <ManualEntry disabled={busy} onSubmit={(code) => void scan(code, { manual: true })} />
          <RecentScans items={recent} />
        </>
      )}
    </div>
  );
}

function Counter({ checkedIn, issued }: { checkedIn?: number; issued?: number }) {
  return (
    <div className="shrink-0 rounded-xl bg-paper/[0.07] px-3 py-1.5 text-right" aria-live="polite">
      <p className="font-mono text-[17px] font-semibold leading-tight tabular-nums">
        {checkedIn ?? "–"}
        <span className="text-paper/40">/{issued ?? "–"}</span>
      </p>
      <p className="text-[10.5px] uppercase tracking-[0.08em] text-paper/45">in</p>
    </div>
  );
}

function CameraPlaceholder({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 px-8 text-center text-paper/60">
      {icon}
      <p className="text-[14.5px] leading-relaxed">{text}</p>
    </div>
  );
}

function cameraMessage(e: IScannerError): string {
  switch (e.kind) {
    case "permission-denied":
      return "Camera access is blocked. Allow it in the browser's site settings, or type codes below.";
    case "insecure-context":
      return "The camera only works over https (or on localhost). Open this page over https, or type codes below.";
    case "no-camera":
      return "No camera found on this device. Type codes below.";
    case "in-use":
      return "Another app is using the camera. Close it and turn the camera on again.";
    default:
      return "The camera couldn't start. Type codes below, or try turning it on again.";
  }
}

/** Full-cover result: huge colour block readable from arm's length in a dark room. */
function ResultPanel({ outcome, onDismiss }: { outcome: ScanOutcome; onDismiss: () => void }) {
  const ok = outcome.kind === "admitted";
  const warn = outcome.kind === "error";
  const bg = ok ? "bg-green-600" : warn ? "bg-amber-500" : "bg-red-600";
  const Icon = ok ? Check : warn ? TriangleAlert : X;

  let title: string;
  let lines: string[];
  switch (outcome.kind) {
    case "admitted":
      title = "Admitted";
      lines = [outcome.ticket.holderName, outcome.ticket.ticketType];
      break;
    case "already":
      title = "Already used";
      lines = [
        outcome.holderName ?? "",
        outcome.checkedInAt ? `Scanned at ${time(outcome.checkedInAt)}${outcome.checkedInBy ? ` by ${outcome.checkedInBy}` : ""}` : "This ticket was scanned before.",
      ].filter(Boolean);
      break;
    default:
      title = outcome.title;
      lines = [outcome.detail];
  }

  return (
    <motion.button
      type="button"
      onClick={onDismiss}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className={cn("absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white", bg)}
      role="alert"
      aria-label={`${title}. Tap to scan the next ticket.`}
    >
      <span className="grid size-24 place-items-center rounded-full bg-white/20">
        <Icon className="size-14" strokeWidth={3} />
      </span>
      <p className="mt-5 text-[34px] font-bold leading-none tracking-[-0.03em]">{title}</p>
      {lines.map((l, i) => (
        <p key={i} className={cn("mt-2 max-w-xs", i === 0 ? "text-[20px] font-semibold" : "text-[15.5px] text-white/85")}>
          {l}
        </p>
      ))}
      <p className="mt-4 font-mono text-[12px] tracking-wide text-white/70">{outcome.code}</p>
      <p className="absolute bottom-5 text-[13px] font-medium text-white/80">{ok ? "Next scan in a moment…" : "Tap to scan the next ticket"}</p>
    </motion.button>
  );
}

function ManualEntry({ disabled, onSubmit }: { disabled: boolean; onSubmit: (code: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <form
      className="mt-4"
      onSubmit={(e) => {
        e.preventDefault();
        const code = normalizeCode(value);
        if (!code) return setError("Ticket codes look like TKT- followed by 16 letters and digits.");
        setError(null);
        setValue("");
        onSubmit(code);
        inputRef.current?.blur(); // hide the phone keyboard so the result is visible
      }}
    >
      <label htmlFor="manual-code" className="mb-2 flex items-center gap-2 text-[13px] font-medium text-paper/60">
        <Keyboard className="size-4" /> Type a code instead
      </label>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          id="manual-code"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="TKT-XXXXXXXXXXXXXXXX"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-14 min-w-0 flex-1 rounded-xl border border-paper/15 bg-paper/[0.06] px-4 font-mono text-[16px] uppercase tracking-wide text-paper placeholder:text-paper/25 focus:border-paper/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="h-14 shrink-0 rounded-xl bg-paper px-5 text-[15px] font-semibold text-ink transition active:scale-[0.98] disabled:opacity-40"
        >
          Check in
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}

function RecentScans({ items }: { items: (ScanOutcome & { at: number })[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-2 font-mono text-[11.5px] uppercase tracking-[0.08em] text-paper/45">Recent scans</h2>
      <ul className="divide-y divide-paper/[0.08] rounded-2xl bg-paper/[0.05]">
        {items.map((s) => {
          const ok = s.kind === "admitted";
          const name = s.kind === "admitted" ? s.ticket.holderName : s.kind === "already" ? (s.holderName ?? "Already used") : s.title;
          const sub = s.kind === "admitted" ? s.ticket.ticketType : s.kind === "already" ? "Already used" : s.kind === "error" ? "Not checked in" : "Rejected";
          return (
            <li key={`${s.code}-${s.at}`} className="flex items-center gap-3 px-4 py-3">
              <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", ok ? "bg-green-600" : s.kind === "error" ? "bg-amber-500" : "bg-red-600")}>
                {ok ? <Check className="size-4" strokeWidth={3} /> : <X className="size-4" strokeWidth={3} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px] font-medium">{name}</p>
                <p className="truncate text-[12.5px] text-paper/50">
                  {sub} · <span className="font-mono">{s.code.slice(-6)}</span>
                </p>
              </div>
              <span className="shrink-0 text-[12px] text-paper/40">{time(new Date(s.at).toISOString())}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
