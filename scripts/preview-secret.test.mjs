import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("preview client secret is not baked into source", () => {
  const source = readFileSync(join(root, "src/lib/auth/preview.ts"), "utf8");
  assert.match(source, /GROK_PREVIEW_CLIENT_SECRET/);
  assert.doesNotMatch(
    source,
    /["'`][0-9a-f]{64}["'`]/i,
    "must not embed a 64-char hex client secret",
  );
});
