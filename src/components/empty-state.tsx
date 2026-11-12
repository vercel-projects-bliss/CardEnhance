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
          ? "panel flex flex-col items-center justify-center px-6 py-7 text-center"
          : "panel flex flex-col items-center justify-center px-6 py-12 text-center"
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
