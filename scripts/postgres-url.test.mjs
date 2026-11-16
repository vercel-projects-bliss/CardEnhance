import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { projectRoot } from "./with-app-env.mjs";
import { readDatabaseUrl, shouldUsePglite, withExplicitSslMode } from "./postgres-url.mjs";

const SAMPLE = "postgres://card:s3cret@ep-example.us-east-1.aws.neon.tech/neondb";

test("readDatabaseUrl treats missing and whitespace as unset", () => {
  assert.equal(readDatabaseUrl({}), undefined);
  assert.equal(readDatabaseUrl({ DATABASE_URL: "" }), undefined);
  assert.equal(readDatabaseUrl({ DATABASE_URL: "   " }), undefined);
  assert.equal(
    readDatabaseUrl({ DATABASE_URL: `${SAMPLE}?sslmode=require` }),
    `${SAMPLE}?sslmode=require`,
  );
});

test("shouldUsePglite is local-only: off when DATABASE_URL or VERCEL is set", () => {
  assert.equal(shouldUsePglite({}), true);
  assert.equal(shouldUsePglite({ DATABASE_URL: SAMPLE }), false);
  assert.equal(shouldUsePglite({ VERCEL: "1" }), false);
  assert.equal(shouldUsePglite({ VERCEL: "1", DATABASE_URL: SAMPLE }), false);
  assert.equal(shouldUsePglite({ DATABASE_URL: "  " }), true);
});

test("withExplicitSslMode rewrites require/prefer/verify-ca to verify-full", () => {
  assert.equal(withExplicitSslMode(`${SAMPLE}?sslmode=require`), `${SAMPLE}?sslmode=verify-full`);
  assert.equal(withExplicitSslMode(`${SAMPLE}?sslmode=prefer`), `${SAMPLE}?sslmode=verify-full`);
  assert.equal(withExplicitSslMode(`${SAMPLE}?sslmode=verify-ca`), `${SAMPLE}?sslmode=verify-full`);
  assert.equal(
    withExplicitSslMode(`${SAMPLE}?channel_binding=require&sslmode=require`),
    `${SAMPLE}?channel_binding=require&sslmode=verify-full`,
  );
});

test("withExplicitSslMode leaves verify-full/disable/allow and unknown modes alone", () => {
  assert.equal(
    withExplicitSslMode(`${SAMPLE}?sslmode=verify-full`),
    `${SAMPLE}?sslmode=verify-full`,
  );
  assert.equal(withExplicitSslMode(`${SAMPLE}?sslmode=disable`), `${SAMPLE}?sslmode=disable`);
  assert.equal(withExplicitSslMode(`${SAMPLE}?sslmode=allow`), `${SAMPLE}?sslmode=allow`);
  assert.equal(
    withExplicitSslMode(`${SAMPLE}?sslmode=custom-future`),
    `${SAMPLE}?sslmode=custom-future`,
  );
});

test("withExplicitSslMode adds verify-full when sslmode is missing", () => {
  assert.equal(withExplicitSslMode(SAMPLE), `${SAMPLE}?sslmode=verify-full`);
  assert.equal(
    withExplicitSslMode(`${SAMPLE}?connect_timeout=10`),
    `${SAMPLE}?connect_timeout=10&sslmode=verify-full`,
  );
});

test("withExplicitSslMode does not rewrite userinfo (password encoding stays put)", () => {
  const url = "postgres://u:p%3Fss%40word@localhost/db?sslmode=require";
  assert.equal(
    withExplicitSslMode(url),
    "postgres://u:p%3Fss%40word@localhost/db?sslmode=verify-full",
  );
});

test("vite.config keeps the createSsrRpc Nitro workaround", () => {
  const source = readFileSync(join(projectRoot(), "vite.config.ts"), "utf8");
  assert.match(source, /inlineDynamicImports:\s*true/);
  assert.match(source, /createSsrRpc/);
});

test("rewriting sslmode=require does not emit the pg SECURITY WARNING", async () => {
  const execFileAsync = promisify(execFile);
  const script = `
    import { parse } from "pg-connection-string";
    import { withExplicitSslMode } from ${JSON.stringify(join(projectRoot(), "scripts/postgres-url.mjs"))};
    const warnings = [];
    process.on("warning", (w) => warnings.push(String(w.message ?? w)));
    parse(withExplicitSslMode(${JSON.stringify(`${SAMPLE}?sslmode=require`)}));
    await new Promise((r) => setImmediate(r));
    const hit = warnings.some((m) => /sslmode|verify-full/i.test(m));
    if (hit) {
      console.error(warnings.join("\\n"));
      process.exit(2);
    }
  `;
  await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: projectRoot(),
  });
});
