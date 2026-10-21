import { useEffect, useRef, useState } from "react";
import { KeyRound, Trash2, UserPlus } from "lucide-react";
import { ApiError } from "../../api/client";
import {
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  updateUser,
  assignableRoles,
  type CreateUserInput,
  type ManagedUser,
} from "../../api/users";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useAuth } from "../../contexts/AuthContext";
import { ActionFailure, LoadError, primaryButtonClass, SuccessRegion } from "../workers/WorkersFeedback";
import { AddUserDialog, ResetPasswordDialog } from "./UserDialogs";

const message = (reason: unknown) => reason instanceof ApiError ? reason.message : "Something went wrong. Please try again.";
const actionClass = "inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50";

export function UserPage() {
  const { user: current } = useAuth();
  const [rows, setRows] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [resetUser, setResetUser] = useState<ManagedUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    listUsers().then((users) => {
      if (!cancelled) { setRows(users); setLoading(false); }
    }).catch((reason) => {
      if (!cancelled) { setLoadError(message(reason)); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [attempt]);

  function clearFeedback() { setError(null); setSuccess(null); }
  function reloadOnConflict(reason: unknown) {
    if (reason instanceof ApiError && [403, 404, 409].includes(reason.status)) setAttempt((value) => value + 1);
  }
  async function mutate(run: () => Promise<ManagedUser>, successMessage: string) {
    if (pending) return;
    setPending(true); clearFeedback();
    try {
      const updated = await run();
      if (mounted.current) {
        setRows((existing) => existing.map((row) => row.id === updated.id ? updated : row));
        setSuccess(successMessage);
      }
    } catch (reason) {
      if (mounted.current) { setError(message(reason)); reloadOnConflict(reason); }
    } finally { if (mounted.current) setPending(false); }
  }
  async function add(input: CreateUserInput) {
    if (pending) return;
    setPending(true); setDialogError(null); setFieldErrors(undefined);
    try {
      const created = await createUser(input);
      if (mounted.current) {
        setRows((existing) => [...existing, created].sort((a, b) => a.username.localeCompare(b.username)));
        setAddOpen(false); setSuccess("User created.");
      }
    } catch (reason) {
      if (mounted.current) {
        setDialogError(message(reason));
        if (reason instanceof ApiError) setFieldErrors(reason.fieldErrors);
      }
    } finally { if (mounted.current) setPending(false); }
  }
  async function reset(password: string) {
    if (!resetUser || pending) return;
    setPending(true); setDialogError(null); setFieldErrors(undefined);
    try {
      await resetUserPassword(resetUser.id, password);
      if (mounted.current) { setResetUser(null); setSuccess("Password reset."); }
    } catch (reason) {
      if (mounted.current) {
        setDialogError(message(reason));
        if (reason instanceof ApiError) setFieldErrors(reason.fieldErrors);
        reloadOnConflict(reason);
      }
    } finally { if (mounted.current) setPending(false); }
  }
  async function remove() {
    if (!deleteTarget || pending) return;
    const id = deleteTarget.id;
    setPending(true); clearFeedback();
    try {
      await deleteUser(id);
      if (mounted.current) { setRows((existing) => existing.filter((row) => row.id !== id)); setSuccess("User deleted."); setDeleteTarget(null); }
    } catch (reason) {
      if (mounted.current) { setError(message(reason)); setDeleteTarget(null); reloadOnConflict(reason); }
    } finally { if (mounted.current) setPending(false); }
  }

  const assignable = assignableRoles(current?.role);
  const busy = pending || addOpen || !!resetUser || !!deleteTarget;
  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h2 className="text-2xl font-bold text-gray-800">User Manager</h2><p className="text-sm text-gray-600">{current?.role === "Administrator" ? "Manage access roles and account status." : "Manage Supervisor accounts."}</p></div>
        <button type="button" disabled={busy} className={`${primaryButtonClass} disabled:opacity-60`}
          onClick={() => { clearFeedback(); setDialogError(null); setFieldErrors(undefined); setAddOpen(true); }}>
          <UserPlus aria-hidden="true" size={16} />Add User
        </button>
      </div>
      <SuccessRegion message={success} />
      {error && <ActionFailure message={error} />}
      {loading ? <p role="status" className="py-8 text-gray-600">Loading users...</p>
        : loadError ? <LoadError message={loadError} onRetry={() => setAttempt((value) => value + 1)} />
        : rows.length === 0 ? <p className="rounded-lg border bg-white p-8 text-center text-gray-600">No users found.</p>
        : <div className="overflow-x-auto md:rounded-lg md:border md:border-gray-200 md:bg-white md:shadow-sm">
          <table className="block w-full text-left text-sm md:table md:min-w-[720px]">
            <thead className="sr-only bg-slate-50 text-slate-700 md:not-sr-only md:table-header-group"><tr className="md:table-row">{["Username", "Role", "Status", "Actions"].map((x) => <th key={x} className="px-4 py-3 font-semibold">{x}</th>)}</tr></thead>
            <tbody className="block space-y-3 md:table-row-group md:space-y-0 md:divide-y md:divide-gray-200">{rows.map((row) => {
              const self = row.id === current?.id;
              return <tr key={row.id} className="block rounded-lg border border-gray-200 bg-white p-3 shadow-sm md:table-row md:rounded-none md:border-0 md:p-0 md:shadow-none">
                <td className="block break-words pb-1 font-semibold text-gray-900 md:table-cell md:px-4 md:py-3 md:font-medium">{row.username}{self && <span className="ml-2 text-xs text-gray-500">You</span>}</td>
                <td data-label="Role" className="flex items-center justify-between gap-3 border-t border-gray-100 py-2 before:content-[attr(data-label)] before:text-xs before:font-semibold before:uppercase before:text-gray-600 md:table-cell md:border-0 md:px-4 md:py-3 md:before:content-none"><select aria-label={`Role for ${row.username}`} value={row.role} disabled={busy || self}
                  className="min-h-11 rounded-lg border border-gray-300 bg-white px-3"
                  onChange={(event) => void mutate(() => updateUser(row.id, { role: event.target.value as ManagedUser["role"], active: row.isActive }), "User role updated.")}>
                  {(assignable.includes(row.role) ? assignable : [row.role, ...assignable]).map((role) => <option key={role}>{role}</option>)}</select></td>
                <td data-label="Status" className="flex items-center justify-between gap-3 border-t border-gray-100 py-2 before:content-[attr(data-label)] before:text-xs before:font-semibold before:uppercase before:text-gray-600 md:table-cell md:border-0 md:px-4 md:py-3 md:before:content-none"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.isActive ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-700"}`}>{row.isActive ? "Active" : "Inactive"}</span></td>
                <td className="block border-t border-gray-100 pt-3 md:table-cell md:border-0 md:px-4 md:py-3"><div className="flex flex-wrap gap-2">
                  {!self && <button type="button" disabled={busy} className={actionClass} aria-label={`${row.isActive ? "Deactivate" : "Activate"} ${row.username}`}
                    onClick={() => void mutate(() => updateUser(row.id, { role: row.role, active: !row.isActive }), row.isActive ? "User deactivated." : "User activated.")}>{row.isActive ? "Deactivate" : "Activate"}</button>}
                  <button type="button" disabled={busy} className={actionClass} aria-label={`Reset password for ${row.username}`}
                    onClick={() => { clearFeedback(); setDialogError(null); setFieldErrors(undefined); setResetUser(row); }}><KeyRound aria-hidden="true" size={15} />Reset password</button>
                  {!self && <button type="button" disabled={busy} className={`${actionClass} text-red-700`} aria-label={`Delete ${row.username}`}
                    onClick={() => { clearFeedback(); setDeleteTarget(row); }}><Trash2 aria-hidden="true" size={15} />Delete</button>}
                </div></td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
      {addOpen && <AddUserDialog open roles={assignable} pending={pending} error={dialogError} fieldErrors={fieldErrors} onSubmit={(input) => void add(input)} onClose={() => setAddOpen(false)} />}
      {!!resetUser && <ResetPasswordDialog user={resetUser} pending={pending} error={dialogError} fieldErrors={fieldErrors} onSubmit={(password) => void reset(password)} onClose={() => setResetUser(null)} />}
      <ConfirmDialog open={!!deleteTarget} title="Delete user" message={deleteTarget ? `Delete ${deleteTarget.username} permanently? This cannot be undone.` : ""}
        confirmLabel="Delete" pending={pending} onConfirm={() => void remove()} onCancel={() => setDeleteTarget(null)} />
    </section>
  );
}
