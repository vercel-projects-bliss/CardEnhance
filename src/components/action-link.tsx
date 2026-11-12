import Link from "next/link";
import type { ReactNode } from "react";

type ActionLinkProps = {
  href: string;
  children: ReactNode;
};

export function ActionLink({ href, children }: ActionLinkProps) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-lg bg-accent/10 px-4 py-2 text-sm font-medium text-accent ring-1 ring-inset ring-accent/20 transition-colors hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </Link>
  );
}
