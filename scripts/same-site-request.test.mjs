import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isSameSiteRequestAllowed,
  originMatchesHost,
} from "./same-site-request.mjs";

test("originMatchesHost compares Origin host to Host", () => {
  assert.equal(originMatchesHost("https://app.example", "app.example"), true);
  assert.equal(originMatchesHost("https://evil.example", "app.example"), false);
  assert.equal(originMatchesHost(null, "app.example"), false);
  assert.equal(originMatchesHost("https://app.example", null), false);
});

test("GET allows missing Sec-Fetch-Site (SSR / non-browser)", () => {
  assert.equal(isSameSiteRequestAllowed({ method: "GET" }), true);
  assert.equal(
    isSameSiteRequestAllowed({ method: "GET", secFetchSite: "same-origin" }),
    true,
  );
});

test("POST without Fetch Metadata or Origin is rejected", () => {
  assert.equal(isSameSiteRequestAllowed({ method: "POST" }), false);
  assert.equal(
    isSameSiteRequestAllowed({ method: "POST", secFetchSite: "cross-site" }),
    false,
  );
  assert.equal(
    isSameSiteRequestAllowed({
      method: "POST",
      secFetchSite: "same-site",
      origin: "https://sibling.grok.me",
      host: "app.grok.me",
    }),
    false,
  );
});

test("POST same-origin Fetch Metadata is allowed", () => {
  assert.equal(
    isSameSiteRequestAllowed({ method: "POST", secFetchSite: "same-origin" }),
    true,
  );
});

test("POST with matching Origin is allowed when Fetch Metadata is absent", () => {
  assert.equal(
    isSameSiteRequestAllowed({
      method: "POST",
      origin: "https://app.example",
      host: "app.example",
    }),
    true,
  );
});
