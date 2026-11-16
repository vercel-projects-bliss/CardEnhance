import { createServerFn } from "@tanstack/react-start";
import { csrfMiddleware } from "@/lib/auth/csrf-middleware";
import { getSql } from "@/lib/db";

function slackToken() {
  return process.env.SLACK_BOT_TOKEN?.trim() || "";
}

function telegramToken() {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
}

async function dispatch(text: string) {
  const { applySecrets } = await import("./secrets-io");
  await applySecrets();
  const slack = slackToken();
  const channel = process.env.SLACK_CHANNEL?.trim();
  const tg = telegramToken();
  const chat = process.env.TELEGRAM_CHAT_ID?.trim();
  const result = { slack: "skipped" as string, telegram: "skipped" as string };

  if (slack && channel) {
    try {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${slack}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel, text }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      result.slack = body.ok ? "sent" : `error:${body.error ?? res.status}`;
    } catch (err) {
      result.slack = err instanceof Error ? `error:${err.message}` : "error";
    }
  }

  if (tg && chat) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${tg}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text }),
      });
      const body = (await res.json()) as { ok?: boolean; description?: string };
      result.telegram = body.ok ? "sent" : `error:${body.description ?? res.status}`;
    } catch (err) {
      result.telegram = err instanceof Error ? `error:${err.message}` : "error";
    }
  }

  return result;
}

export const notifyCardProcessed = createServerFn({ method: "POST" })
  .middleware([csrfMiddleware])
  .validator((input: { cardName: string; detector?: string; engine?: string }) => input)
  .handler(async ({ data }) => {
    const text = `Card processed: ${data.cardName}${data.detector ? ` (${data.detector})` : ""}`;
    return dispatch(text);
  });

export const testNotify = createServerFn({ method: "POST" })
  .middleware([csrfMiddleware])
  .validator((input: { cardName: string }) => input)
  .handler(async ({ data }) => {
    const name = data.cardName.trim();
    if (!name) return { slack: "error:name required", telegram: "error:name required" };
    const result = await dispatch(`CardEnhance test: ${name}`);
    const sql = await getSql();
    await sql`
      insert into audit_logs (action, entity_type, entity_id, metadata)
      values (
        ${"notify.tested"},
        ${"notify"},
        ${name},
        ${JSON.stringify({ player: name, slack: result.slack, telegram: result.telegram })}::jsonb
      )
    `;
    return result;
  });
