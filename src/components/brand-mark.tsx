export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 ring-1 ring-accent/25"
        aria-hidden="true"
      >
        <span className="block h-[18px] w-[13px] rounded-[3px] border border-accent/80 bg-accent/15" />
      </span>
      <span
        className={
          compact
            ? "text-[15px] font-semibold tracking-tight text-ink"
            : "text-sm font-semibold tracking-tight text-ink"
        }
      >
        CardEnhance
      </span>
    </span>
  );
}
