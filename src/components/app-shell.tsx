"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useId,
  useState,
  type ComponentType,
} from "react";
import {
  Images,
  LayoutDashboard,
  ListChecks,
  Menu,
  MessageSquare,
  ScanLine,
  Settings,
  X,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import {
  isNavActive,
  primaryNav,
  settingsNav,
  type NavItem,
} from "@/lib/nav";

const ICONS: Record<
  NavItem["icon"],
  ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  dashboard: LayoutDashboard,
  studio: ScanLine,
  library: Images,
  audit: ListChecks,
  assistant: MessageSquare,
  settings: Settings,
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="flex min-h-dvh bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:text-ink focus:outline-none focus:ring-2 focus:ring-accent"
      >
        Skip to content
      </a>

      {/* Desktop column stretches with the page so a tall layout never leaves a void under the nav. */}
      <div className="relative hidden w-64 shrink-0 border-r border-border bg-surface lg:block">
        <aside className="sticky top-0 flex h-dvh flex-col">
          <Suspense fallback={<SidebarContent pathname="" />}>
            <SidebarWithPathname />
          </Suspense>
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur-md lg:hidden">
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls={drawerId}
            onClick={() => setOpen((value) => !value)}
          >
            <Menu className="h-5 w-5" strokeWidth={1.75} />
          </button>
          <BrandMark compact />
        </header>

        <main
          id="main"
          className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8"
        >
          {children}
        </main>
      </div>

      {open ? (
        <div className="lg:hidden">
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/60"
            aria-label="Close menu"
            onClick={close}
          />
          <aside
            id={drawerId}
            className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface shadow-2xl"
            aria-modal="true"
            role="dialog"
            aria-label="Navigation"
          >
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <BrandMark compact />
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="Close menu"
                onClick={close}
              >
                <X className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>
            <Suspense fallback={<SidebarContent pathname="" onNavigate={close} />}>
              <SidebarWithPathname onNavigate={close} />
            </Suspense>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function SidebarWithPathname({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return <SidebarContent pathname={pathname} onNavigate={onNavigate} />;
}

function SidebarContent({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="hidden px-5 pb-2 pt-6 lg:block">
        <Link
          href="/"
          className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onClick={onNavigate}
        >
          <BrandMark />
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pt-4 lg:pt-5" aria-label="Main">
        <ul className="flex flex-col gap-1">
          {primaryNav.map((item) => (
            <li key={item.href}>
              <NavLink item={item} pathname={pathname} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-auto border-t border-border px-3 py-3">
        <NavLink item={settingsNav} pathname={pathname} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const Icon = ICONS[item.icon];
  const active = isNavActive(pathname, item.href);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "glow-box flex items-center gap-3 px-3 py-2 text-sm font-medium text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          : "flex items-center gap-3 border border-transparent px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:border-border hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      }
    >
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
      {item.label}
    </Link>
  );
}
