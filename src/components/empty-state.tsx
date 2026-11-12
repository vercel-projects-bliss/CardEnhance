import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
};

export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: EmptyStateProps) {
  return (
    <section
      className={
        compact
          ? "flex flex-col items-center justify-center rounded-2xl border border-border bg-surface px-6 py-8 text-center sm:px-8"
          : "flex min-h-64 flex-col items-center justify-center rounded-2xl border border-border bg-surface px-6 py-16 text-center sm:min-h-72 sm:px-8"
      }
    >
      <h2 className="text-base font-medium text-ink">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  );
}
