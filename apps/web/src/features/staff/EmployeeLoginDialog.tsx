import { useEffect, useState } from "react";
import { KeyRound, Unlink } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import type { Worker } from "../../api/workers";
import {
  createEmployeeLogin, linkEmployeeLogin, listLinkableUsers, removeEmployeeLogin, type LinkableUser,
} from "../../api/staff";
import { Button, Input, Select } from "../../ui";
import { ActionFailure } from "../workers/WorkersFeedback";
import { errorText } from "./staffUi";

interface Props {
  worker: Worker;
  /** Only a Manager or Administrator creates new accounts; HR can link an existing one. */
  canCreate: boolean;
  /** Only a Manager or Administrator removes a login. */
  canRemove: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}

/** Gives an office employee a login, or links an existing account (an HR user, for example) to them. */
export function EmployeeLoginDialog({ worker, canCreate, canRemove, onClose, onDone }: Props) {
  const [mode, setMode] = useState<"new" | "link">(canCreate ? "new" : "link");
  const [users, setUsers] = useState<LinkableUser[]>([]);
  const [linkId, setLinkId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (worker.userId) return;
    void listLinkableUsers().then(setUsers).catch(() => undefined);
  }, [worker.userId]);

  async function run(action: () => Promise<unknown>, message: string) {
    setPending(true);
    setFailure(null);
    try {
      await action();
      onDone(message);
    } catch (e) {
      setFailure(errorText(e));
      setPending(false);
    }
  }

  if (worker.userId) {
    return (
      <Dialog open onClose={onClose} title="Employee login">
        <p className="mt-2 text-sm text-ink-700">
          {worker.fullName} signs in as <strong>{worker.username}</strong>.
        </p>
        {failure && <div className="mt-3"><ActionFailure message={failure} /></div>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {canRemove && (
            <Button variant="danger" icon={Unlink} disabled={pending} onClick={() => void run(() => removeEmployeeLogin(worker.id), "Login unlinked.")}>
              Unlink login
            </Button>
          )}
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} title="Give a login">
      <p className="mt-1 text-sm text-ink-600">{worker.fullName} uses this login to sign in, sign out and request leave.</p>
      {canCreate && (
        <div className="mt-4 flex gap-2" role="group" aria-label="Login type">
          <Button size="sm" variant={mode === "new" ? "primary" : "secondary"} onClick={() => setMode("new")}>New login</Button>
          <Button size="sm" variant={mode === "link" ? "primary" : "secondary"} onClick={() => setMode("link")}>Existing account</Button>
        </div>
      )}
      <div className="mt-4 space-y-3">
        {mode === "new" ? (
          <>
            <Input label="Username" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
            <Input label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 10 characters." />
          </>
        ) : (
          <Select label="Account" value={linkId} onChange={(e) => setLinkId(e.target.value)} hint="For example an HR account that also signs in to the office.">
            <option value="">Choose an account</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.username} ({u.role === "Viewer" ? "Partner" : u.role})</option>)}
          </Select>
        )}
      </div>
      {failure && <div className="mt-3"><ActionFailure message={failure} /></div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
        {mode === "new" ? (
          <Button icon={KeyRound} disabled={pending || !username.trim() || !password} onClick={() => void run(() => createEmployeeLogin(worker.id, username.trim(), password), "Login created.")}>Create login</Button>
        ) : (
          <Button icon={KeyRound} disabled={pending || !linkId} onClick={() => void run(() => linkEmployeeLogin(worker.id, Number(linkId)), "Account linked.")}>Link account</Button>
        )}
      </div>
    </Dialog>
  );
}
