export async function dispatchNotice(text: string) {
  const slack = process.env.SLACK_BOT_TOKEN?.trim() || "";
  const channel = process.env.SLACK_CHANNEL?.trim();
  const telegram = process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
  const chat = process.env.TELEGRAM_CHAT_ID?.trim();
  const result = { slack: "skipped", telegram: "skipped" };

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

  if (telegram && chat) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${telegram}/sendMessage`, {
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
