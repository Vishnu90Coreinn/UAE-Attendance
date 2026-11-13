import { useEffect, useRef, useState } from "react";
import { LoadingState, PageHeader, RowMenu, StatusBadge, inputClass, type RowMenuItem } from "../../ui";
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
import { isReadOnly, roleLabel } from "../../permissions";
import { ActionFailure, LoadError, primaryButtonClass, SuccessRegion } from "../workers/WorkersFeedback";
import { AddUserDialog, ResetPasswordDialog } from "./UserDialogs";

const message = (reason: unknown) => reason instanceof ApiError ? reason.message : "Something went wrong. Please try again.";
const actionClass = "inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-ink-300 bg-white px-3 text-sm font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50 max-md:only:col-span-2";

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
  const [roleChange, setRoleChange] = useState<{ row: ManagedUser; role: ManagedUser["role"] } | null>(null);
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

  const menuFor = (row: ManagedUser, self: boolean): RowMenuItem[] => [
    { label: "Reset password", icon: KeyRound, disabled: busy, onSelect: () => { clearFeedback(); setDialogError(null); setFieldErrors(undefined); setResetUser(row); } },
    ...(self ? [] : [{ label: "Delete", icon: Trash2, danger: true, disabled: busy, onSelect: () => { clearFeedback(); setDeleteTarget(row); } }]),
  ];
  const assignable = assignableRoles(current?.role);
  const readOnly = isReadOnly(current?.role);
  const busy = pending || addOpen || !!resetUser || !!deleteTarget || !!roleChange;
  return (
    <section className="min-w-0 space-y-4">
      <PageHeader
        title="User Manager"
        description={readOnly ? "Accounts and their roles, for viewing only." : current?.role === "Administrator" ? "Manage access roles and account status." : "Manage HR, Supervisor and Partner accounts."}
        actions={
          readOnly ? undefined : <button type="button" disabled={busy} className={`${primaryButtonClass} disabled:opacity-60`}
            onClick={() => { clearFeedback(); setDialogError(null); setFieldErrors(undefined); setAddOpen(true); }}>
            <UserPlus aria-hidden="true" size={16} />Add User
          </button>
        }
      />
      <SuccessRegion message={success} />
      {error && <ActionFailure message={error} />}
      {loading ? <LoadingState label="Loading users..." />
        : loadError ? <LoadError message={loadError} onRetry={() => setAttempt((value) => value + 1)} />
        : rows.length === 0 ? <p className="rounded-lg border bg-white p-8 text-center text-ink-600">No users found.</p>
        : <div className="overflow-x-auto md:rounded-lg md:border md:border-line md:bg-white md:shadow-sm">
          <table className="block w-full text-left text-sm md:table md:min-w-[720px]">
            <thead className="sr-only border-b border-line bg-ink-50 text-xs uppercase tracking-wide text-ink-600 md:not-sr-only md:table-header-group"><tr className="md:table-row">{(readOnly ? ["Username", "Role", "Status"] : ["Username", "Role", "Status", "Actions"]).map((x) => <th key={x} className="px-4 py-3 font-semibold">{x}</th>)}</tr></thead>
            <tbody className="block space-y-3 md:table-row-group md:space-y-0 md:divide-y md:divide-line">{rows.map((row) => {
              const self = row.id === current?.id;
              return <tr key={row.id} className="block rounded-card border border-line bg-white p-3 shadow-card md:table-row md:rounded-none md:border-0 md:p-0 md:shadow-none">
                <td className="block break-words pb-1 font-semibold text-ink-900 md:table-cell md:px-4 md:py-3 md:font-medium">{row.username}{self && <span className="ml-2 text-xs text-ink-500">You</span>}</td>
                <td data-label="Role" className="flex items-center justify-between gap-3 border-t border-line py-2 before:content-[attr(data-label)] before:text-xs before:font-semibold before:uppercase before:text-ink-600 md:table-cell md:border-0 md:px-4 md:py-3 md:before:content-none"><select aria-label={`Role for ${row.username}`} value={row.role} disabled={busy || self || readOnly}
                  className={inputClass}
                  onChange={(event) => { clearFeedback(); setRoleChange({ row, role: event.target.value as ManagedUser["role"] }); }}>
                  {(assignable.includes(row.role) ? assignable : [row.role, ...assignable]).map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></td>
                <td data-label="Status" className="flex items-center justify-between gap-3 border-t border-line py-2 before:content-[attr(data-label)] before:text-xs before:font-semibold before:uppercase before:text-ink-600 md:table-cell md:border-0 md:px-4 md:py-3 md:before:content-none"><StatusBadge tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusBadge></td>
                {!readOnly && <td className="block border-t border-line pt-3 md:table-cell md:border-0 md:px-4 md:py-3"><div className="flex items-center gap-2 md:justify-end">
                  {!self && <button type="button" disabled={busy} className={`${actionClass} max-md:flex-1`} aria-label={`${row.isActive ? "Deactivate" : "Activate"} ${row.username}`}
                    onClick={() => void mutate(() => updateUser(row.id, { role: row.role, active: !row.isActive }), row.isActive ? "User deactivated." : "User activated.")}>{row.isActive ? "Deactivate" : "Activate"}</button>}
                  <RowMenu label={`More actions for ${row.username}`} items={menuFor(row, self)} className="max-md:ml-auto" />
                </div></td>}
              </tr>;
            })}</tbody>
          </table>
        </div>}
      {addOpen && <AddUserDialog open roles={assignable} pending={pending} error={dialogError} fieldErrors={fieldErrors} onSubmit={(input) => void add(input)} onClose={() => setAddOpen(false)} />}
      {!!resetUser && <ResetPasswordDialog user={resetUser} pending={pending} error={dialogError} fieldErrors={fieldErrors} onSubmit={(password) => void reset(password)} onClose={() => setResetUser(null)} />}
      <ConfirmDialog open={!!roleChange} title="Change role"
        message={roleChange ? `Change ${roleChange.row.username} from ${roleLabel(roleChange.row.role)} to ${roleLabel(roleChange.role)}? Their access changes the next time they sign in.` : ""}
        confirmLabel="Change role" confirmIcon={undefined} pending={pending}
        onConfirm={() => { const change = roleChange; setRoleChange(null); if (change) void mutate(() => updateUser(change.row.id, { role: change.role, active: change.row.isActive }), "User role updated."); }}
        onCancel={() => setRoleChange(null)} />
      <ConfirmDialog open={!!deleteTarget} title="Delete user" message={deleteTarget ? `Delete ${deleteTarget.username} permanently? This cannot be undone.` : ""}
        confirmLabel="Delete" pending={pending} onConfirm={() => void remove()} onCancel={() => setDeleteTarget(null)} />
    </section>
  );
}
