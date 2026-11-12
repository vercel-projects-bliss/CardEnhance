import { createServer } from "node:http";

const shutdown = new AbortController();
const port = 1234;

process.on("SIGTERM", () => shutdown.abort());

const server = createServer((req, res) => {
  const ok = req.url === "/health";
  res.statusCode = ok ? 200 : 404;
  res.setHeader("content-type", "text/plain");
  res.end(ok ? "ok\n" : "not found\n");
});

server.listen(port, "0.0.0.0", () => {
  const region = process.env.VERCEL_REGION ?? "unknown";
  console.log(`heartbeat listening on ${port} region=${region}`);
});

const tick = () => {
  if (shutdown.signal.aborted) return;
  const region = process.env.VERCEL_REGION ?? "unknown";
  console.log(`heartbeat ok ${new Date().toISOString()} region=${region}`);
};

tick();
const interval = setInterval(tick, 60_000);

shutdown.signal.addEventListener("abort", () => {
  clearInterval(interval);
  console.log("heartbeat received SIGTERM, shutting down");
  server.close(() => process.exit(0));
});
