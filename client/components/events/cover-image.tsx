import { LogoMark } from "@/components/ui/logo";
import type { ImageVariants } from "@/lib/api/events";
import { cn } from "@/lib/utils";

/**
 * Event cover with responsive variants (the API already serves 400/800/1600 px WebP),
 * so a plain <img srcSet> is enough; no image optimizer needed.
 */
export function CoverImage({
  image,
  alt,
  sizes = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw",
  priority,
  className,
  label,
}: {
  image: ImageVariants | null;
  alt: string;
  sizes?: string;
  /** above-the-fold image: load eagerly with high priority */
  priority?: boolean;
  className?: string;
  /** shown on the placeholder when there's no cover */
  label?: string;
}) {
  if (!image) {
    return (
      <div className={cn("relative grid aspect-[16/9] place-items-center overflow-hidden bg-ink text-paper", className)}>
        <LogoMark className="size-10 -rotate-6 opacity-90" />
        {label && (
          <span className="absolute bottom-3 left-4 font-mono text-[11px] uppercase tracking-[0.08em] text-paper/50">
            {label}
          </span>
        )}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- variants are pre-sized by the API
    <img
      src={image.md}
      srcSet={`${image.sm} 400w, ${image.md} 800w, ${image.lg} 1600w`}
      sizes={sizes}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      className={cn("aspect-[16/9] w-full bg-ink/[0.06] object-cover", className)}
    />
  );
}
