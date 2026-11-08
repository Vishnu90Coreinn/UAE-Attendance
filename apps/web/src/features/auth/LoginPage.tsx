import { useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Loader2, LogIn } from "lucide-react";
import { COMPANY_NAME } from "../../branding";
import { ApiError } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { Button, Field } from "../../ui";

interface FromLocation {
  pathname: string;
  search?: string;
  hash?: string;
}

/** Where to go after signing in: the page ProtectedRoute bounced the user from, else the home page. */
function destinationFrom(state: unknown): string {
  const from = (state as { from?: FromLocation } | null)?.from;
  if (from && typeof from.pathname === "string" && from.pathname !== "/login") {
    return `${from.pathname}${from.search ?? ""}${from.hash ?? ""}`;
  }
  return "/";
}

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const usernameRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destination = destinationFrom(location.state);

  if (status === "signedIn") {
    return <Navigate to={destination} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await login(username.trim(), password);
      navigate(destination, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
      setPending(false);
      usernameRef.current?.focus();
    }
  }

  return (
    <div className="grid min-h-screen bg-canvas text-ink-900 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-white lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 size-[28rem] rounded-full border border-white/10"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-40 -left-20 size-[34rem] rounded-full border border-white/10"
        />
        <img src="/icons/icon-192.png" alt="" width={56} height={56} className="size-14 rounded-xl bg-white p-1" />
        <div className="relative max-w-md">
          <p className="text-sm font-medium uppercase tracking-widest text-brand-300">HR &amp; Payroll</p>
          <p className="mt-3 text-3xl font-semibold leading-snug tracking-tight">
            Workers, attendance, leave and payroll in one place.
          </p>
        </div>
        <p className="text-sm text-brand-200/70">{COMPANY_NAME}</p>
      </aside>

      <main className="flex flex-col items-center justify-center gap-6 px-4 py-10">
        <div className="flex flex-col items-center gap-3 lg:hidden">
          <img src="/icons/icon-192.png" alt="" width={64} height={64} className="size-16 rounded-2xl border border-line bg-white" />
          <h1 className="max-w-md text-center text-base font-semibold leading-tight">{COMPANY_NAME}</h1>
        </div>

        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-ink-600">Use the username and password given to you by your administrator.</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Field label="Username">
              {(p) => (
                <input
                  {...p}
                  name="username"
                  type="text"
                  ref={usernameRef}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  required
                />
              )}
            </Field>
            <Field label="Password">
              {(p) => (
                <input
                  {...p}
                  name="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              )}
            </Field>

            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}

            <Button type="submit" disabled={pending} aria-busy={pending} className="w-full">
              {pending ? (
                <>
                  <Loader2 aria-hidden="true" size={16} className="animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <LogIn aria-hidden="true" size={16} />
                  Sign in
                </>
              )}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
