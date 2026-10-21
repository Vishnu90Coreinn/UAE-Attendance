import { useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Loader2, Lock, LogIn } from "lucide-react";
import { COMPANY_NAME } from "../../branding";
import { ApiError } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";

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

const inputClass =
  "mt-1 block min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base text-gray-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600";

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
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-100 px-4 py-8 text-gray-800">
      <div className="flex flex-col items-center gap-4">
        <img src="/icons/icon-192.png" alt="" width={72} height={72} className="size-[72px] rounded-2xl bg-white shadow-sm" />
        <h1 className="max-w-md text-center text-lg font-bold leading-tight text-slate-900">{COMPANY_NAME}</h1>
      </div>

      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <Lock aria-hidden="true" size={20} />
          </span>
          <h2 className="text-2xl font-bold text-gray-800">Sign in</h2>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-800">
              Username
            </label>
            <input
              id="username"
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
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-800">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className={inputClass}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-base font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-70"
          >
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
          </button>
        </form>
      </div>
    </div>
  );
}
