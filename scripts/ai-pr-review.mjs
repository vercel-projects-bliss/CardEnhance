// @ts-check
/**
 * GitHub Actions PR reviewer: Grok (xAI) first, OpenAI GPT only if xAI fails.
 * Never logs secret values.
 */

import { pathToFileURL } from "node:url";

export const COMMENT_MARKER = "<!-- grok-pr-review -->";
export const MAX_DIFF_CHARS = 80_000;
export const MAX_REVIEW_CHARS = 8_000;
export const XAI_MODEL = "grok-4-fast";
export const OPENAI_MODEL = "gpt-4.1-mini";

/**
 * @param {string | undefined} value
 */
export function hasSecret(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function secretsPresent(env = process.env) {
  return hasSecret(env.XAI_API_KEY) || hasSecret(env.OPENAI_API_KEY);
}

/**
 * @param {string} diff
 * @param {number} [max]
 */
export function capDiff(diff, max = MAX_DIFF_CHARS) {
  if (diff.length <= max) return { text: diff, truncated: false };
  return {
    text: `${diff.slice(0, max)}\n\n[diff truncated at ${max} characters]`,
    truncated: true,
  };
}

/**
 * @param {string} review
 * @param {string} provider
 */
export function formatComment(review, provider) {
  const clipped =
    review.length > MAX_REVIEW_CHARS
      ? `${review.slice(0, MAX_REVIEW_CHARS)}\n\n[review truncated]`
      : review;
  return `${COMMENT_MARKER}
## AI PR review (${provider})

${clipped.trim()}
`;
}

/**
 * @param {{ status: number, body: string }} err
 */
export function summarizeHttpError(err) {
  const snippet = err.body.replace(/\s+/g, " ").slice(0, 180);
  return `HTTP ${err.status}${snippet ? `: ${snippet}` : ""}`;
}

/**
 * @param {string} url
 * @param {string} apiKey
 * @param {string} model
 * @param {{ role: string, content: string }[]} messages
 * @param {number} maxTokens
 */
export async function createChatCompletion(url, apiKey, model, messages, maxTokens) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`chat completion failed`);
    Object.assign(error, { status: response.status, body });
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    const error = new Error("chat completion returned non-JSON");
    Object.assign(error, { status: response.status, body });
    throw error;
  }
  const text = parsed?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    const error = new Error("chat completion returned empty content");
    Object.assign(error, { status: response.status, body: "" });
    throw error;
  }
  return text.trim();
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown, token: string }} options
 */
export async function githubRequest(path, { method = "GET", body, token }) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub ${method} ${path} failed: HTTP ${response.status}`);
  }
  return text ? JSON.parse(text) : null;
}

/**
 * @param {string} title
 * @param {string} diff
 */
export function reviewMessages(title, diff) {
  return [
    {
      role: "system",
      content:
        "You are a concise PR reviewer. Report only concrete bugs, regressions, or security issues in the diff. Skip style nits, praise, and secrets. If nothing important is wrong, say so in one short paragraph. Use GitHub markdown. Do not invent files that are not in the diff.",
    },
    {
      role: "user",
      content: `Pull request title: ${title}\n\nDiff:\n\`\`\`diff\n${diff}\n\`\`\``,
    },
  ];
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {{ role: string, content: string }[]} messages
 * @returns {Promise<{ text: string, provider: string }>}
 */
export async function reviewWithFallback(env, messages) {
  if (hasSecret(env.XAI_API_KEY)) {
    try {
      const text = await createChatCompletion(
        "https://api.x.ai/v1/chat/completions",
        env.XAI_API_KEY ?? "",
        XAI_MODEL,
        messages,
        1200,
      );
      return { text, provider: `Grok / ${XAI_MODEL}` };
    } catch (err) {
      const detail =
        err && typeof err === "object" && "status" in err
          ? summarizeHttpError(/** @type {{ status: number, body: string }} */ (err))
          : "request failed";
      console.warn(`::warning::xAI review failed (${detail}). Falling back to OpenAI.`);
      if (!hasSecret(env.OPENAI_API_KEY)) throw err;
    }
  }

  if (!hasSecret(env.OPENAI_API_KEY)) {
    throw new Error("no review provider available");
  }

  const text = await createChatCompletion(
    "https://api.openai.com/v1/chat/completions",
    env.OPENAI_API_KEY ?? "",
    OPENAI_MODEL,
    messages,
    800,
  );
  return { text, provider: `GPT fallback / ${OPENAI_MODEL}` };
}

/**
 * @param {{ repo: string, pr: number, token: string, body: string }} args
 */
export async function upsertPrComment({ repo, pr, token, body }) {
  const comments = await githubRequest(`/repos/${repo}/issues/${pr}/comments?per_page=100`, {
    token,
  });
  const existing = Array.isArray(comments)
    ? comments.find(
        (comment) =>
          typeof comment?.body === "string" && comment.body.includes(COMMENT_MARKER),
      )
    : undefined;

  if (existing?.id) {
    await githubRequest(`/repos/${repo}/issues/comments/${existing.id}`, {
      method: "PATCH",
      token,
      body: { body },
    });
    return "updated";
  }

  await githubRequest(`/repos/${repo}/issues/${pr}/comments`, {
    method: "POST",
    token,
    body: { body },
  });
  return "created";
}

async function main() {
  const env = process.env;
  if (!secretsPresent(env)) {
    console.log(
      "::notice::Skipping AI PR review: neither XAI_API_KEY nor OPENAI_API_KEY is set.",
    );
    return;
  }

  const repo = env.GITHUB_REPOSITORY;
  const pr = Number(env.PR_NUMBER);
  const token = env.GITHUB_TOKEN;
  if (!repo || !Number.isInteger(pr) || pr < 1 || !token) {
    throw new Error("GITHUB_REPOSITORY, PR_NUMBER, and GITHUB_TOKEN are required");
  }

  const diffRes = await fetch(`https://api.github.com/repos/${repo}/pulls/${pr}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.diff",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!diffRes.ok) {
    throw new Error(`failed to fetch PR diff: HTTP ${diffRes.status}`);
  }
  const { text: diff } = capDiff(await diffRes.text());
  const title = env.PR_TITLE?.trim() || `PR #${pr}`;
  const { text, provider } = await reviewWithFallback(env, reviewMessages(title, diff));
  const action = await upsertPrComment({
    repo,
    pr,
    token,
    body: formatComment(text, provider),
  });
  console.log(`Posted AI PR review via ${provider} (${action} comment).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : "AI PR review failed";
    console.error(`::error::${message}`);
    process.exit(1);
  });
}
