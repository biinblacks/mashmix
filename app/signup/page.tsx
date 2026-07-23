"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard` },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setDone(true);
    setLoading(false);
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-ink)] px-6 text-center">
        <div>
          <h1 className="font-display text-2xl font-bold text-[var(--color-paper)]">Check your email</h1>
          <p className="mt-3 max-w-sm text-sm text-[var(--color-paper)]/60">
            We sent a confirmation link to {email}. Click it to activate your account.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-ink)] px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="font-display text-lg font-bold text-[var(--color-paper)]">
          MASHMIX
        </Link>
        <h1 className="mt-8 font-display text-2xl font-bold text-[var(--color-paper)]">Create your account</h1>

        <form onSubmit={handleSignup} className="mt-8 space-y-4">
          <div>
            <label className="text-sm text-[var(--color-paper)]/60">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white/[0.03] px-4 py-2.5 text-[var(--color-paper)] outline-none focus:border-[var(--color-violet)]"
            />
          </div>
          <div>
            <label className="text-sm text-[var(--color-paper)]/60">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white/[0.03] px-4 py-2.5 text-[var(--color-paper)] outline-none focus:border-[var(--color-violet)]"
            />
          </div>

          {error && <p className="text-sm text-[var(--color-magenta)]">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-gradient-to-r from-[var(--color-magenta)] to-[var(--color-violet)] py-2.5 font-display text-sm font-semibold text-[var(--color-paper)] disabled:opacity-50"
          >
            {loading ? "Creating account…" : "Sign up"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--color-paper)]/50">
          Already have an account?{" "}
          <Link href="/login" className="text-[var(--color-paper)] underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
