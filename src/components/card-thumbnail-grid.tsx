type CardThumbnailGridProps = {
  label: string;
  message: string;
  count?: number;
};

export function CardThumbnailGrid({
  label,
  message,
  count = 10,
}: CardThumbnailGridProps) {
  return (
    <section aria-label={label}>
      <p className="mb-4 text-sm leading-relaxed text-ink-muted">{message}</p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: count }, (_, index) => (
          <li
            key={index}
            className="relative aspect-[2.5/3.5] overflow-hidden rounded-xl border border-border bg-surface-raised"
            aria-hidden="true"
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-white/[0.04] to-transparent" />
          </li>
        ))}
      </ul>
    </section>
  );
}
