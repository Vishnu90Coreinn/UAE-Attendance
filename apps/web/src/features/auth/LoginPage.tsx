import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { CalendarCheck, Eye, EyeOff, Loader2, LogIn, ShieldCheck, Users, Wallet, type LucideIcon } from "lucide-react";
import { COMPANY_NAME, SHORT_NAME } from "../../branding";
import { ApiError } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { Button, Field } from "../../ui";

interface FromLocation {
  pathname: string;
  search?: string;
  hash?: string;
}

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Users, title: "Worker directory", text: "Profiles, documents and photos for every employee." },
  { icon: CalendarCheck, title: "Attendance & leave", text: "Daily hours, overtime and leave tracked accurately." },
  { icon: Wallet, title: "Monthly payroll", text: "Finalised reports and PDF exports, ready to print." },
];

/**
 * A phone brings up the keyboard the moment a field is focused, hiding the form it is meant to help with, so the
 * username field is only focused automatically with a mouse or trackpad.
 */
function shouldAutoFocus(): boolean {
  return typeof window.matchMedia !== "function" || !window.matchMedia("(pointer: coarse)").matches;
}

/** The text shown for a failed sign-in; a server error says so plainly rather than "Request failed (502)". */
function failureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.status >= 500
      ? "The server is not responding right now. Wait a moment and try again."
      : error.message;
  }
  return "Something went wrong. Please try again.";
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
  useEffect(() => {
    document.title = `Sign in · ${SHORT_NAME}`;
  }, []);
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const usernameRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoFocus] = useState(shouldAutoFocus);

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
      setError(failureMessage(e));
      setPending(false);
      usernameRef.current?.focus();
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-canvas text-ink-900 max-sm:bg-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(var(--color-brand-200)_1px,transparent_1px)] [background-size:24px_24px] opacity-50 [mask-image:radial-gradient(ellipse_80%_70%_at_50%_40%,black,transparent)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-40 -top-40 size-[34rem] rounded-full bg-brand-100/70 blur-3xl anim-drift"
      />

      {/* On a phone the brand is a solid teal block the sign-in sheet slides up over; from a tablet up it is a plain bar. */}
      <header className="anim-rise relative border-b border-line bg-white/80 backdrop-blur max-sm:overflow-hidden max-sm:border-0 max-sm:bg-brand-800 max-sm:pb-16 max-sm:pt-[env(safe-area-inset-top)]">
        {/* A curtain-wall facade: the company glazes buildings, so the sign-in opens onto one. Phone only. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 sm:hidden [background-image:linear-gradient(to_right,rgb(255_255_255/0.1)_2px,transparent_2px),linear-gradient(to_bottom,rgb(255_255_255/0.1)_2px,transparent_2px),linear-gradient(112deg,transparent_34%,rgb(255_255_255/0.06)_34%,rgb(255_255_255/0.06)_50%,transparent_50%)] [background-size:48px_64px,48px_64px,100%_100%]"
        >
          <span className="absolute left-12 top-16 h-16 w-12 bg-brand-200/15" />
          <span className="absolute left-[18rem] top-0 h-16 w-12 bg-brand-200/20" />
          <span className="absolute left-[18rem] top-32 h-16 w-12 bg-brand-200/12" />
          <span className="absolute left-0 top-48 h-16 w-12 bg-brand-200/12" />
          {/* One window with the light on. */}
          <span className="absolute left-60 top-16 h-16 w-12 bg-amber-300/70" />
        </div>
        <div className="relative mx-auto flex max-w-6xl items-center gap-4 px-4 py-4 max-sm:flex-col max-sm:gap-4 max-sm:px-6 max-sm:pb-0 max-sm:pt-10 max-sm:text-center sm:px-8">
          <img
            src="/icons/icon-192.png"
            alt=""
            width={72}
            height={72}
            className="size-14 shrink-0 rounded-2xl border border-line bg-white p-1 shadow-card max-sm:size-[4.5rem] max-sm:border-white/30 max-sm:shadow-pop"
          />
          <h1 className="min-w-0 text-base font-semibold leading-snug tracking-tight text-brand-900 max-sm:text-lg max-sm:text-white sm:text-xl">
            {COMPANY_NAME}
          </h1>
        </div>
      </header>

      <main className="relative mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-4 py-10 max-sm:-mt-8 max-sm:items-stretch max-sm:px-0 max-sm:py-0 sm:px-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16">
        <section className="anim-rise hidden lg:block [--delay:120ms]">
          <p className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-brand-700">
            <ShieldCheck aria-hidden="true" size={14} />
            HR &amp; Payroll System
          </p>
          <p className="mt-5 font-display text-5xl font-semibold leading-[1.1] tracking-tight text-brand-900">
            Everything your workforce needs, in one place.
          </p>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-600">
            Manage workers, record daily attendance and leave, and finalise monthly payroll with confidence.
          </p>
          <ul className="mt-10 grid max-w-xl gap-4">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li
                key={title}
                className="flex items-start gap-4 rounded-xl border border-line bg-white p-4 shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-pop"
              >
                <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <Icon aria-hidden="true" size={22} />
                </span>
                <span>
                  <span className="block text-base font-semibold text-ink-900">{title}</span>
                  <span className="block text-sm leading-relaxed text-ink-600">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="anim-rise mx-auto w-full max-w-md rounded-2xl [--delay:240ms] border border-line bg-white p-8 shadow-pop max-sm:rounded-b-none max-sm:rounded-t-3xl max-sm:border-0 max-sm:px-6 max-sm:pb-[calc(2rem+env(safe-area-inset-bottom))] max-sm:pt-8 max-sm:shadow-[0_-8px_30px_rgba(15,23,42,0.12)] sm:p-10">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1.5 text-sm text-ink-600">Use the username and password given to you by your administrator.</p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-5">
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
                  autoCorrect="off"
                  enterKeyHint="next"
                  spellCheck={false}
                  autoFocus={autoFocus}
                  required
                  className={`${p.className} max-sm:min-h-14`}
                />
              )}
            </Field>
            <Field label="Password">
              {(p) => (
                <div className="relative">
                  <input
                    {...p}
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    enterKeyHint="go"
                    required
                    className={`${p.className} pr-14 max-sm:min-h-14`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide characters" : "Show characters"}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 inline-flex w-14 items-center justify-center rounded-r-lg text-ink-500 hover:text-ink-800 sm:w-11"
                  >
                    {showPassword ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
                  </button>
                </div>
              )}
            </Field>

            {error && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}

            <Button type="submit" disabled={pending} aria-busy={pending} className="w-full transition duration-150 hover:-translate-y-px active:translate-y-0 active:scale-[0.99] max-sm:min-h-14 max-sm:rounded-xl max-sm:text-base">
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

          <p className="mt-6 flex items-center gap-2 border-t border-line pt-5 text-xs text-ink-600">
            <ShieldCheck aria-hidden="true" size={16} className="shrink-0 text-brand-500" />
            Forgotten your password? Ask your administrator to reset it.
          </p>
        </div>
      </main>

      <footer className="relative border-t border-line bg-white/80 py-4 text-center text-xs text-ink-500 max-sm:border-0 max-sm:bg-white max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))] max-sm:pt-0">
        &copy; {new Date().getFullYear()} {COMPANY_NAME}. All rights reserved.
      </footer>
    </div>
  );
}
