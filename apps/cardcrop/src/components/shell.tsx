"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getJson } from "@/lib/client/http";
import { WORKSPACES } from "@/lib/workspaces";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [who, setWho] = useState<string>("");

  useEffect(() => {
    getJson<{ user: { method: string; email?: string } | null }>("/api/auth/session")
      .then((data) => {
        if (!data.user) setWho("");
        else setWho(data.user.email || (data.user.method === "password" ? "Password gate" : "Signed in"));
      })
      .catch(() => setWho(""));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="row" style={{ textDecoration: "none" }}>
          <span className="brand-mark" aria-hidden />
          <span>
            <strong className="display" style={{ fontSize: "1.35rem" }}>CardCrop Studio</strong>
            <span className="muted" style={{ display: "block", fontSize: "0.78rem" }}>
              One seller workflow, all your card tools
            </span>
          </span>
        </Link>
        <div>
          <nav className="nav" aria-label="Workspaces">
            {WORKSPACES.map((item) => (
              <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: "0.45rem" }}>
            <span className="muted" style={{ fontSize: "0.78rem" }}>{who}</span>
            <button className="btn-ghost" type="button" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
