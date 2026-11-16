import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertSecretsWritable,
  canPersistSecrets,
  SECRETS_VERCEL_MESSAGE,
} from "./secrets-persist.mjs";

test("secret files may be written locally", () => {
  assert.equal(canPersistSecrets({}), true);
  assert.doesNotThrow(() => assertSecretsWritable({}));
});

test("secret files must not be written on Vercel", () => {
  assert.equal(canPersistSecrets({ VERCEL: "1" }), false);
  assert.throws(
    () => assertSecretsWritable({ VERCEL: "1" }),
    (err) => err instanceof Error && err.message === SECRETS_VERCEL_MESSAGE,
  );
});
