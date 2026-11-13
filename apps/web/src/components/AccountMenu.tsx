import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, KeyRound, LogOut } from "lucide-react";
import type { CurrentUser } from "../api/auth";
import { cx } from "../ui";
import { roleLabel } from "../permissions";

interface AccountMenuProps {
  user: CurrentUser;
  onChangePassword: () => void;
  onSignOut: () => void;
}

const itemClass =
  "flex min-h-11 w-full items-center gap-2.5 px-3 text-left text-sm font-medium text-ink-800 hover:bg-ink-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 md:min-h-10";

/** The signed-in person's avatar. Opens their name and role with Change password and Sign out, keeping the top bar quiet. */
export function AccountMenu({ user, onChangePassword, onSignOut }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  function choose(action: () => void) {
    setOpen(false);
    // Focus goes back to the avatar first, so a dialog opened by the action returns focus there when it closes.
    buttonRef.current?.focus();
    action();
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${user.username}`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg px-1.5 hover:bg-ink-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        <span aria-hidden="true" className="inline-flex size-9 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold uppercase text-white">
          {user.username.slice(0, 1)}
        </span>
        <span aria-hidden="true" className="hidden text-left leading-tight lg:block">
          <span className="block text-sm font-medium text-ink-900">{user.username}</span>
          <span className="block text-xs text-ink-500">{roleLabel(user.role)}</span>
        </span>
        <ChevronDown aria-hidden="true" size={14} className={cx("hidden text-ink-500 transition-transform lg:block", open && "rotate-180")} />
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label="Account" className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-card border border-line bg-white shadow-pop">
          <div className="border-b border-line px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-ink-900">{user.username}</p>
            <p className="text-xs text-ink-600">{roleLabel(user.role)}</p>
          </div>
          <div className="py-1">
            <button type="button" role="menuitem" className={itemClass} onClick={() => choose(onChangePassword)}>
              <KeyRound aria-hidden="true" size={16} />
              Change password
            </button>
            <button type="button" role="menuitem" className={itemClass} onClick={() => choose(onSignOut)}>
              <LogOut aria-hidden="true" size={16} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
