"use client";

import { useState } from "react";
import { Shell } from "@/components/shell";
import { postJson } from "@/lib/client/http";
import { recallCard, type RememberedCard } from "@/lib/client/memory";

type Turn = { role: "user" | "assistant"; content: string };

export function Assistant() {
  const [card, setCard] = useState<RememberedCard | null>(null);
  const [includeCard, setIncludeCard] = useState(true);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    const next = [...turns, { role: "user" as const, content }];
    setTurns(next);
    setDraft("");
    setBusy(true);
    setError("");
    try {
      const attached = includeCard ? card ?? recallCard() : null;
      if (attached && attached !== card) setCard(attached);
      const reply = await postJson<{ text: string; model: string }>("/api/assistant", {
        messages: next,
        card: attached ?? undefined,
      });
      setTurns([...next, { role: "assistant", content: reply.text }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assistant failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <p className="kicker">Card Assistant</p>
      <h1>Ask about the card in front of you.</h1>
      <p className="muted">
        Replies come from xAI ({"XAI_API_KEY"}, model XAI_MODEL or grok-4.5). The assistant is told not to invent names or prices.
      </p>
      {error ? <p className="error">{error}</p> : null}
      <div className="panel" style={{ marginBottom: "0.8rem" }}>
        <label className="row">
          <input type="checkbox" checked={includeCard} onChange={(event) => setIncludeCard(event.target.checked)} />
          Include the last identity stored by OCR
        </label>
        <button className="btn-ghost" type="button" onClick={() => setCard(recallCard())}>
          Show last read card
        </button>
        <p className="muted">
          {card
            ? `${card.filename || "Card"}: ${card.identity.player || "no player"} ${card.identity.year || ""} ${card.identity.set || ""}`
            : "No identity in this browser session yet. Read a card in the editor, batch, or auto-enhancer."}
        </p>
      </div>
      <div className="chat">
        {turns.map((turn, index) => (
          <div key={`${turn.role}-${index}`} className={`bubble ${turn.role}`}>
            {turn.content}
          </div>
        ))}
      </div>
      <form onSubmit={(event) => void send(event)} className="panel" style={{ marginTop: "0.8rem" }}>
        <label className="field">
          Message
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a sold listing title from the printed text only." />
        </label>
        <button className="btn" type="submit" disabled={busy || !draft.trim()} style={{ marginTop: "0.7rem" }}>
          {busy ? "Waiting on xAI…" : "Send"}
        </button>
      </form>
    </Shell>
  );
}
