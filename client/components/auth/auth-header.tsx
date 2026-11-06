export function AuthHeader({ title, subtitle }: { title: React.ReactNode; subtitle?: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.035em] text-ink">{title}</h1>
      {subtitle && <p className="mt-2 text-[15px] leading-relaxed text-muted">{subtitle}</p>}
    </div>
  );
}

/** Staggered entrance for form rows. */
export const stagger = {
  container: { hidden: {}, show: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } } },
  item: {
    hidden: { opacity: 0, y: 6 },
    show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const } },
  },
};
