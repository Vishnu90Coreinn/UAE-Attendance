import { useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import type { Role } from "../../api/auth";
import { USER_ROLES, type CreateUserInput, type ManagedUser } from "../../api/users";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";

const buttonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60";
const passwordHint = "Use 10 to 128 characters. The password cannot be the same as the username.";

function validatePassword(password: string, username: string) {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (password.length > 128) return "Password must be at most 128 characters.";
  if (password.toLocaleLowerCase() === username.trim().toLocaleLowerCase())
    return "Password must not be the same as the username.";
  return undefined;
}

export function AddUserDialog({ open, pending, error, fieldErrors, onClose, onSubmit }: {
  open: boolean;
  pending: boolean;
  error: string | null;
  fieldErrors?: Record<string, string[]>;
  onClose: () => void;
  onSubmit: (input: CreateUserInput) => void;
}) {
  const first = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("Viewer");
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  function submit(event: FormEvent) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!username.trim()) errors.username = "Username is required.";
    const passwordError = validatePassword(password, username);
    if (passwordError) errors.password = passwordError;
    setLocalErrors(errors);
    if (!Object.keys(errors).length) onSubmit({ username: username.trim(), password, role });
  }
  return (
    <Dialog open={open} title="Add User" onClose={pending ? () => {} : onClose} initialFocusRef={first}>
      <form onSubmit={submit} className="mt-4 space-y-4">
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <TextField label="Username" value={username} maxLength={50} disabled={pending} inputRef={first}
          error={localErrors.username ?? fieldErrors?.username?.[0]}
          onChange={(e) => { setUsername(e.target.value); setLocalErrors((x) => ({ ...x, username: "" })); }} />
        <TextField label="Password" type="password" value={password} maxLength={128} disabled={pending}
          hint={passwordHint} error={localErrors.password ?? fieldErrors?.password?.[0]}
          onChange={(e) => { setPassword(e.target.value); setLocalErrors((x) => ({ ...x, password: "" })); }} />
        <label className="block text-sm font-medium text-gray-800">Role
          <select aria-label="Role" value={role} disabled={pending} onChange={(e) => setRole(e.target.value as Role)}
            className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-base">
            {USER_ROLES.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <button type="button" disabled={pending} onClick={onClose} className={`${buttonClass} border border-gray-300 bg-white text-gray-800`}>Cancel</button>
          <button type="submit" disabled={pending} className={`${buttonClass} bg-blue-600 text-white`}>
            {pending && <Loader2 aria-hidden="true" size={16} className="animate-spin" />}{pending ? "Creating..." : "Create user"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ResetPasswordDialog({ user, pending, error, fieldErrors, onClose, onSubmit }: {
  user: ManagedUser | null;
  pending: boolean;
  error: string | null;
  fieldErrors?: Record<string, string[]>;
  onClose: () => void;
  onSubmit: (password: string) => void;
}) {
  const first = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string>();
  function submit(event: FormEvent) {
    event.preventDefault();
    const validation = validatePassword(password, user?.username ?? "");
    setLocalError(validation);
    if (!validation) onSubmit(password);
  }
  return (
    <Dialog open={!!user} title="Reset password" onClose={pending ? () => {} : onClose} initialFocusRef={first}>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <p className="text-sm text-gray-600">Set a new password for <strong>{user?.username}</strong>.</p>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <TextField label="New password" type="password" value={password} maxLength={128} disabled={pending}
          inputRef={first} hint={passwordHint} error={localError ?? fieldErrors?.password?.[0]}
          onChange={(e) => { setPassword(e.target.value); setLocalError(undefined); }} />
        <div className="flex flex-wrap justify-end gap-3 pt-2">
          <button type="button" disabled={pending} onClick={onClose} className={`${buttonClass} border border-gray-300 bg-white text-gray-800`}>Cancel</button>
          <button type="submit" disabled={pending} className={`${buttonClass} bg-blue-600 text-white`}>
            {pending && <Loader2 aria-hidden="true" size={16} className="animate-spin" />}{pending ? "Resetting..." : "Reset password"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
