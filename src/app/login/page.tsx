"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Mode = "login" | "register";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Server error (${res.status})`);
      }
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <header className="page-header">
        <h1>{mode === "login" ? "Sign in" : "Create account"}</h1>
        <Link href="/" className="muted">
          ← Home
        </Link>
      </header>

      <form
        onSubmit={onSubmit}
        data-testid="auth-form"
        style={{ maxWidth: 380, margin: "0 auto" }}
      >
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="email" className="muted" style={{ display: "block" }}>
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            data-testid="auth-email"
            autoComplete="email"
            style={{
              width: "100%",
              padding: "8px 10px",
              marginTop: 4,
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 14,
            }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label htmlFor="password" className="muted" style={{ display: "block" }}>
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            data-testid="auth-password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            style={{
              width: "100%",
              padding: "8px 10px",
              marginTop: 4,
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 14,
            }}
          />
        </div>

        {error ? (
          <div
            className="notice"
            role="alert"
            data-testid="auth-error"
            style={{ marginBottom: 12 }}
          >
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          data-testid="auth-submit"
          disabled={busy}
          className="continue-cta"
          style={{
            border: "none",
            cursor: busy ? "wait" : "pointer",
            padding: "10px 16px",
            fontSize: 14,
          }}
        >
          {busy
            ? "Working…"
            : mode === "login"
              ? "Sign in →"
              : "Create account →"}
        </button>

        <div style={{ marginTop: 16 }} className="muted">
          {mode === "login" ? (
            <>
              No account yet?{" "}
              <button
                type="button"
                data-testid="toggle-register"
                onClick={() => {
                  setMode("register");
                  setError(null);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--accent)",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Register →
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                type="button"
                data-testid="toggle-login"
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--accent)",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Sign in →
              </button>
            </>
          )}
        </div>
      </form>
    </main>
  );
}