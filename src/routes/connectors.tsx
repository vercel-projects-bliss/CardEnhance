import { useState, type DragEvent, type FormEvent } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { PageShell } from "@/components/studio/app-nav";
import { PageError, PagePending } from "@/components/studio/page-states";
import { errorMessage } from "@/lib/error-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/sonner";
import { checkConnectors, type ConnectorStatus } from "@/lib/connectors/status";
import { listSecrets, saveSecrets } from "@/lib/connectors/secrets";
import { listStoredCards } from "@/lib/connectors/persist";
import { testNotify } from "@/lib/connectors/notify";
import { probeR2 } from "@/lib/connectors/r2";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/connectors")({
  loader: async () => {
    const [status, cards, secrets] = await Promise.all([checkConnectors(), listStoredCards(), listSecrets()]);
    return { status, count: cards.length, secrets };
  },
  pendingComponent: () => (
    <PageShell current="/connectors">
      <PagePending label="Checking connectors" />
    </PageShell>
  ),
  errorComponent: ({ error }) => (
    <PageShell current="/connectors">
      <PageError message={errorMessage(error)} />
    </PageShell>
  ),
  component: ConnectorsPage,
});

const LABELS: { key: string; title: string; detail: string }[] = [
  { key: "xai", title: "xAI", detail: "Optional Grok vision. Upload XAI_API_KEY." },
  { key: "neon", title: "Database", detail: "Neon DATABASE_URL, else local PGLite." },
  { key: "pricecharting", title: "PriceCharting", detail: "No key. OCR identity → sold comps." },
  { key: "ebay", title: "eBay", detail: "Sold/live search links. HTML sold scrape is WAF-blocked unless Cloudflare tunnel is up." },
  { key: "cloudflare", title: "Cloudflare", detail: "Optional price tunnel Worker. Paste CLOUDFLARE_TUNNEL_URL after wrangler deploy." },
  { key: "r2", title: "Cloudflare R2", detail: "Durable originals. Needs R2_ACCOUNT_ID, access keys, and R2_BUCKET." },
  { key: "huggingface", title: "Hugging Face", detail: "Optional PaddleOCR-VL. Upload HF_TOKEN." },
  { key: "slack", title: "Slack", detail: "SLACK_BOT_TOKEN + SLACK_CHANNEL." },
  { key: "telegram", title: "Telegram", detail: "TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID." },
];

function ConnectorsPage() {
  const { status, count, secrets } = Route.useLoaderData();
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ slack: string; telegram: string } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState("");
  const [rows, setRows] = useState(secrets);
  const [over, setOver] = useState(false);

  const transfer = async (nextValues: Record<string, string>, nextPaste: string) => {
    setSaving(true);
    setError(null);
    try {
      const next = await saveSecrets({ data: { values: nextValues, paste: nextPaste } });
      setRows(next);
      setValues({});
      setPaste("");
      const stored = next.filter((row) => row.set).length;
      toast.success(`Transferred ${stored} key${stored === 1 ? "" : "s"} into this workspace`);
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const ingestFiles = async (files: FileList | File[]) => {
    const texts: string[] = [];
    for (const file of Array.from(files)) {
      texts.push(await file.text());
    }
    const blob = texts.join("\n");
    if (!blob.trim()) {
      setError("That file was empty.");
      return;
    }
    await transfer({}, blob);
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) await ingestFiles(e.dataTransfer.files);
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    await transfer(values, paste);
  };

  const onTest = async (e: FormEvent) => {
    e.preventDefault();
    const cardName = name.trim();
    if (!cardName) {
      setError("Enter a card name to send.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const next = await testNotify({ data: { cardName } });
      setResult(next);
      toast.success(`Slack ${next.slack} · Telegram ${next.telegram}`);
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Notify failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <PageShell current="/connectors">
      <Toaster position="top-right" />
      <div>
        <h1 className="font-display text-2xl">Connectors</h1>
        <p className="text-sm text-muted">
          Upload keys here. They are written into this workspace and applied immediately. They are not committed. {count}{" "}
          cards in{" "}
          <Link to="/library" className="text-accent hover:underline">
            library
          </Link>
          .
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {LABELS.map((item) => (
          <li key={item.key} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium">{item.title}</h2>
              <StatusBadge value={status[item.key] ?? "disconnected"} />
            </div>
            <p className="mt-2 text-sm text-muted">{item.detail}</p>
          </li>
        ))}
      </ul>

      <form onSubmit={onSave} className="space-y-4 rounded-2xl border border-border bg-surface p-4 sm:p-6">
        <div>
          <h2 className="font-display text-xl">Upload keys</h2>
          <p className="text-sm text-muted">
            Drop a <code>.env</code>, JSON, or text file, fill fields, or paste KEY=value. Blank keeps the current value.
            Enter <code>-</code> to clear.
          </p>
        </div>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={cn(
            "flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center",
            over ? "border-accent bg-accent/10" : "border-border bg-elevated",
          )}
        >
          <Upload className="size-6 text-accent" />
          <span className="text-sm font-medium">Drop .env / JSON / txt here</span>
          <span className="text-xs text-muted">or click to choose a file</span>
          <input
            type="file"
            accept=".env,.json,.txt,text/plain,application/json"
            className="sr-only"
            onChange={(e) => {
              if (e.target.files?.length) void ingestFiles(e.target.files);
              e.currentTarget.value = "";
            }}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.key} className="space-y-2">
              <Label htmlFor={row.key}>
                {row.label}
                {row.set ? (
                  <span className="ml-2 font-mono text-xs text-accent">{row.hint}</span>
                ) : (
                  <span className="ml-2 text-xs text-muted">empty</span>
                )}
              </Label>
              <input
                id={row.key}
                name={row.key}
                autoComplete="off"
                spellCheck={false}
                type={row.kind === "secret" ? "password" : "text"}
                value={values[row.key] ?? ""}
                placeholder={row.where}
                onChange={(e) => setValues((prev) => ({ ...prev, [row.key]: e.target.value }))}
                className="h-11 w-full rounded-xl border border-border bg-elevated px-3 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="paste-block">Paste KEY=value</Label>
          <textarea
            id="paste-block"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={8}
            spellCheck={false}
            className="w-full rounded-xl border border-border bg-elevated px-3 py-2 font-mono text-xs text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={`R2_ACCOUNT_ID=\nR2_ACCESS_KEY_ID=\nR2_SECRET_ACCESS_KEY=\nR2_BUCKET=\nR2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com\nR2_PUBLIC_BASE=`}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={saving}>
          {saving ? "Transferring" : "Transfer into workspace"}
        </Button>
      </form>

      <form onSubmit={onTest} className="space-y-4 rounded-2xl border border-border bg-surface p-4 sm:p-6">
        <div>
          <h2 className="font-display text-xl">Test notification</h2>
          <p className="text-sm text-muted">Writes an audit row. Slack/Telegram send only after those tokens are transferred.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="notify-name">Card name</Label>
          <input
            id="notify-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-11 w-full rounded-xl border border-border bg-elevated px-3 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {result ? (
          <p className="text-sm text-muted">
            Slack: {result.slack} · Telegram: {result.telegram}
          </p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Sending" : "Send test"}
        </Button>
      </form>

      <R2Probe />
    </PageShell>
  );
}

function R2Probe() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  return (
    <form
      className="space-y-4 rounded-2xl border border-border bg-surface p-4 sm:p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setMessage(null);
        try {
          const result = await probeR2();
          if (!result.ok) {
            setMessage(result.error);
            return;
          }
          setMessage(`Wrote and read ${result.key}`);
          await router.invalidate();
        } catch (err) {
          setMessage(err instanceof Error ? err.message : "R2 probe failed");
        } finally {
          setPending(false);
        }
      }}
    >
      <div>
        <h2 className="font-display text-xl">Test R2</h2>
        <p className="text-sm text-muted">HEAD the bucket, PUT a health object, GET it back using the S3 API (`region: auto`, path-style). Skips if keys are empty.</p>
      </div>
      {message ? <p className="text-sm text-muted">{message}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Probing" : "Probe R2"}
      </Button>
    </form>
  );
}

function StatusBadge({ value }: { value: ConnectorStatus }) {
  if (value === "connected") return <Badge className="bg-accent/15 text-accent">{value}</Badge>;
  if (value === "pglite") return <Badge variant="outline">{value}</Badge>;
  if (value === "error") return <Badge variant="destructive">{value}</Badge>;
  return <Badge variant="outline">{value}</Badge>;
}
