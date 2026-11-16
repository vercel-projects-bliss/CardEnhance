import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMMENT_MARKER,
  capDiff,
  formatComment,
  hasSecret,
  secretsPresent,
  summarizeHttpError,
} from "./ai-pr-review.mjs";

test("secretsPresent is false when both keys are missing", () => {
  assert.equal(secretsPresent({}), false);
  assert.equal(secretsPresent({ XAI_API_KEY: "", OPENAI_API_KEY: "  " }), false);
});

test("secretsPresent is true when either key is set", () => {
  assert.equal(secretsPresent({ XAI_API_KEY: "xai-test" }), true);
  assert.equal(secretsPresent({ OPENAI_API_KEY: "sk-test" }), true);
  assert.equal(hasSecret(undefined), false);
});

test("capDiff leaves short diffs intact", () => {
  const { text, truncated } = capDiff("hello");
  assert.equal(truncated, false);
  assert.equal(text, "hello");
});

test("capDiff truncates long diffs", () => {
  const { text, truncated } = capDiff("abcdefghij", 4);
  assert.equal(truncated, true);
  assert.match(text, /^abcd/);
  assert.match(text, /truncated at 4 characters/);
});

test("formatComment includes marker and provider", () => {
  const body = formatComment("Looks fine.", "Grok / grok-4-fast");
  assert.match(body, new RegExp(COMMENT_MARKER));
  assert.match(body, /Grok \/ grok-4-fast/);
  assert.match(body, /Looks fine\./);
});

test("summarizeHttpError never dumps a long body", () => {
  const summary = summarizeHttpError({
    status: 401,
    body: `{"error":"${"x".repeat(500)}"}`,
  });
  assert.match(summary, /^HTTP 401/);
  assert.ok(summary.length < 220);
});
