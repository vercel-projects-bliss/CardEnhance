"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { getJson, postJson } from "@/lib/client/http";
import { cardCanvasSize } from "@/lib/geometry/card-canvas";
import { WORKSPACES } from "@/lib/workspaces";

const REFERENCE = [
  [2132, 2544, 2239, 3135],
  [1916, 2984, 2239, 3134],
  [1714, 2342, 1800, 2520],
  [2120, 3078, 2309, 3232],
] as const;

type CardRow = {
  id: string;
  filename: string;
  player: string | null;
  workspace: string | null;
  output_width: number | null;
  output_height: number | null;
  blob_url: string | null;
  created_at: string;
};

export function SuiteHome() {
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [cardError, setCardError] = useState("");
  const [statuses, setStatuses] = useState<Record<string, string> | null>(null);
  const [statusError, setStatusError] = useState("");
  const [health, setHealth] = useState<string>("");
  const [serverCheck, setServerCheck] = useState<string>("");

  useEffect(() => {
    getJson<{ cards: CardRow[] }>("/api/cards")
      .then((data) => setCards(data.cards))
      .catch((error: Error) => setCardError(error.message));
    getJson<{ statuses: Record<string, string> }>("/api/connectors")
      .then((data) => setStatuses(data.statuses))
      .catch((error: Error) => setStatusError(error.message));
    getJson<{ configured: boolean; ready: boolean; detail?: string }>("/api/health")
      .then((data) => {
        setHealth(data.ready ? "GPU restore ready" : data.configured ? data.detail || "GPU configured, not ready" : "RESTORATION_API_URL unset");
      })
      .catch((error: Error) => setHealth(error.message));
    postJson<{ width: number; height: number }>("/api/export", { width: 2132, height: 2544 })
      .then((data) => setServerCheck(`Server agrees: 2132×2544 → ${data.width}×${data.height}`))
      .catch((error: Error) => setServerCheck(error.message));
  }, []);

  return (
    <Shell>
      <p className="kicker">Card Suite Unified</p>
      <h1 style={{ fontSize: "2.7rem", marginBottom: "0.3rem" }}>One studio for the whole card.</h1>
      <p className="muted" style={{ maxWidth: "44rem" }}>
        Detect, rectify, OCR, restore, imagine, and export from the three source apps, behind a login
        gate. Paid routes call Replicate, xAI, Neon, Vercel Blob, and the GPU proxy only after you sign in.
      </p>
      <div className="grid-6" style={{ marginTop: "1rem" }}>
        {WORKSPACES.filter((item) => item.href !== "/suite").map((item) => (
          <Link key={item.href} href={item.href} className="card" style={{ textDecoration: "none" }}>
            <span className="kicker">{item.kicker}</span>
            <strong className="display" style={{ fontSize: "1.35rem" }}>{item.label}</strong>
            <span className="muted">{item.detail}</span>
          </Link>
        ))}
      </div>

      <section className="panel" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Padding only, no crop, no stretch, centered</h2>
        <p className="muted">
          Width binds when <code>w × 7 ≥ h × 5</code>. That side becomes <code>max(ceil(side × 21/20), side + 10)</code>.
          The other side is half-up <code>× 7/5</code> or <code>× 5/7</code> in integer arithmetic. The bitmap stays at scale 1,
          centered, on white, with at least 5 px of margin.
        </p>
        <p>{serverCheck}</p>
        <table className="table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Required</th>
              <th>This build</th>
              <th>Binds</th>
            </tr>
          </thead>
          <tbody>
            {REFERENCE.map(([w, h, ow, oh]) => {
              const canvas = cardCanvasSize(w, h);
              const match = canvas.width === ow && canvas.height === oh;
              return (
                <tr key={`${w}x${h}`}>
                  <td>{w}×{h}</td>
                  <td>{ow}×{oh}</td>
                  <td className={match ? "ok" : "error"}>{canvas.width}×{canvas.height}</td>
                  <td>{canvas.binding}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="grid-2" style={{ marginTop: "1rem" }}>
        <section className="panel">
          <h2 style={{ marginTop: 0 }}>Library</h2>
          {cardError ? <p className="error">{cardError}</p> : null}
          {cards && cards.length === 0 ? <p className="muted">No cards stored for this account yet.</p> : null}
          {cards && cards.length > 0 ? (
            <table className="table">
              <thead>
                <tr><th>File</th><th>Player</th><th>Workspace</th><th>Export</th></tr>
              </thead>
              <tbody>
                {cards.map((card) => (
                  <tr key={card.id}>
                    <td>{card.blob_url ? <a href={card.blob_url}>{card.filename}</a> : card.filename}</td>
                    <td>{card.player || "—"}</td>
                    <td>{card.workspace || "—"}</td>
                    <td>{card.output_width && card.output_height ? `${card.output_width}×${card.output_height}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
        <section className="panel">
          <h2 style={{ marginTop: 0 }}>Connectors</h2>
          <p className="muted">{health}</p>
          {statusError ? <p className="error">{statusError}</p> : null}
          {statuses ? (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {Object.entries(statuses).map(([name, status]) => (
                <li key={name} className="row" style={{ justifyContent: "space-between", padding: "0.25rem 0" }}>
                  <span>{name}</span>
                  <span className={status === "connected" ? "ok" : status === "error" ? "error" : "muted"}>{status}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </Shell>
  );
}
