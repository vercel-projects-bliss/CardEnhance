export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        className="flex h-8 w-8 items-center justify-center border border-accent bg-background"
        aria-hidden="true"
      >
        <span className="block h-[18px] w-[13px] border border-accent/90" />
      </span>
      <span
        className={
          compact
            ? "glow-text text-[15px] font-semibold tracking-tight"
            : "glow-text text-sm font-semibold tracking-tight"
        }
      >
        CardEnhance
      </span>
    </span>
  );
}
