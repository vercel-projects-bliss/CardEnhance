export type NavItem = {
  href: string;
  label: string;
  icon:
    | "dashboard"
    | "studio"
    | "library"
    | "audit"
    | "assistant"
    | "settings";
};

export const primaryNav: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/studio", label: "Studio", icon: "studio" },
  { href: "/library", label: "Library", icon: "library" },
  { href: "/audit", label: "Audit", icon: "audit" },
  { href: "/assistant", label: "Assistant", icon: "assistant" },
];

export const settingsNav: NavItem = {
  href: "/settings",
  label: "Settings",
  icon: "settings",
};

export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}
