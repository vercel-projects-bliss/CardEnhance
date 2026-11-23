"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { postJson } from "@/lib/client/http";

type Options = { password: boolean; neon: boolean };

export function LoginPanel() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/suite";
  const [options, setOptions] = useState<Options | null>(null);
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [neonPassword, setNeonPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/options")
      .then((response) => response.json())
      .then((data: Options) => setOptions(data))
      .catch(() => setError("Could not read auth options"));
  }, []);

  async function passwordLogin(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await postJson("/api/auth/login", { password: password.trim() });
      router.replace(next.startsWith("/") ? next : "/suite");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function neonAuth(mode: "sign-in" | "sign-up") {
    setBusy(true);
    setError("");
    try {
      const { createAuthClient } = await import("@neondatabase/auth/next");
      const client = createAuthClient();
      const result =
        mode === "sign-up"
          ? await client.signUp.email({ email, password: neonPassword, name: name || email })
          : await client.signIn.email({ email, password: neonPassword });
      if (result.error) {
        setError(result.error.message || "Sign-in failed");
        return;
      }
      router.replace("/suite");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="main" style={{ width: "min(720px, calc(100% - 2rem))" }}>
      <h1 style={{ fontSize: "3rem", margin: "0.2rem 0 0.4rem" }}>CardCrop Studio</h1>
      {error ? <p className="error">{error}</p> : null}
      {options && !options.password && !options.neon ? (
        <p className="error">Sign-in is not available right now.</p>
      ) : null}
      {options?.password ? (
        <form className="panel" onSubmit={passwordLogin} style={{ marginTop: "1rem" }}>
          <label className="field">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button className="btn" type="submit" disabled={busy} style={{ marginTop: "0.8rem" }}>
            Enter studio
          </button>
        </form>
      ) : null}
      {options?.neon ? (
        <div className="panel" style={{ marginTop: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>Email sign-in</h2>
          <div className="grid-2">
            <label className="field">
              Name (sign up)
              <input value={name} onChange={(event) => setName(event.target.value)} type="text" />
            </label>
            <label className="field">
              Email
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
            </label>
          </div>
          <label className="field" style={{ marginTop: "0.6rem" }}>
            Password
            <input
              value={neonPassword}
              onChange={(event) => setNeonPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
          <div className="row" style={{ marginTop: "0.8rem" }}>
            <button className="btn" type="button" disabled={busy} onClick={() => neonAuth("sign-in")}>
              Sign in
            </button>
            <button className="btn-ghost" type="button" disabled={busy} onClick={() => neonAuth("sign-up")}>
              Create account
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
