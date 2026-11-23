export const WORKSPACES = [
  { href: "/", label: "Seller workspace", kicker: "Scan to listing", detail: "Import, detect, OCR, pair fronts and backs, review, and export." },
  {
    href: "/suite",
    label: "Card Suite Unified",
    kicker: "Hub",
    detail: "Library, connector status, and the shared 5:7 export formula.",
  },
  {
    href: "/auto-enhance",
    label: "AI Card Auto-Enhancer",
    kicker: "Restore",
    detail: "Adaptive deskew, dust, and tone, then optional Replicate upscale or GPU restore.",
  },
  {
    href: "/batch",
    label: "Card Batch Workbench",
    kicker: "Bulk",
    detail: "Open the unified seller workspace for bulk scans and listing-data export.",
  },
  {
    href: "/editor",
    label: "Single Card Editor",
    kicker: "One card",
    detail: "Contour crop, perspective, rotate, tone, vision OCR, and padding-only export.",
  },
  {
    href: "/create",
    label: "Create & Edit Images",
    kicker: "Imagine",
    detail: "Generate or edit with xAI or Replicate, then fit the result to a trading card.",
  },
  {
    href: "/assistant",
    label: "Card Assistant",
    kicker: "Ask",
    detail: "xAI chat grounded in the card identity the other workspaces just read.",
  },
] as const;

export type WorkspaceHref = (typeof WORKSPACES)[number]["href"];
