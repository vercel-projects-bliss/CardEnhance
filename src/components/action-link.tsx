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
      className="glow-box inline-flex items-center justify-center bg-accent px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </Link>
  );
}
