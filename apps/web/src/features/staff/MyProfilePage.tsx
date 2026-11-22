import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { getMyProfile, type StaffProfile } from "../../api/staff";
import { Button, Card, CardHeader, LoadingState, PageHeader } from "../../ui";
import { roleLabel } from "../../permissions";
import { ChangePasswordDialog } from "../auth/ChangePasswordDialog";
import { LoadError } from "../workers/WorkersFeedback";
import { Avatar } from "./staffKit";
import { errorText, shortDate } from "./staffUi";

function tenure(joinDate: string): string {
  const [y, m, d] = joinDate.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 1) return "Joined this month";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years ? `${years} year${years === 1 ? "" : "s"}` : null, rest ? `${rest} month${rest === 1 ? "" : "s"}` : null]
    .filter(Boolean)
    .join(" ");
}

function Detail({ label, value, mono = false }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-600">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm ${mono ? "font-mono" : ""} ${value ? "text-ink-900" : "text-ink-500"}`}>{value || "Not recorded"}</dd>
    </div>
  );
}

/** The employee's own record. Read-only: HR keeps these details in the Worker Directory. */
export function MyProfilePage() {
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMyProfile()
      .then((p) => !cancelled && setProfile(p))
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <LoadError message={error} onRetry={() => window.location.reload()} />;
  if (!profile) return <LoadingState label="Loading..." />;

  return (
    <section>
      <PageHeader title="My Profile" description="Your details as HR holds them. To correct anything, ask HR." />

      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-5 p-6">
          <Avatar name={profile.fullName} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-xl font-semibold text-ink-900">{profile.fullName}</p>
            <p className="text-sm text-ink-700">
              {profile.designation}
              {profile.department ? ` · ${profile.department}` : ""}
            </p>
            <p className="mt-1 font-mono text-xs text-ink-600">{profile.code}</p>
          </div>
          {profile.joinDate && (
            <div className="text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-600">With the company</p>
              <p className="text-lg font-semibold text-ink-900">{tenure(profile.joinDate)}</p>
              <p className="text-xs text-ink-600">since {shortDate(profile.joinDate)}</p>
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Personal" />
          <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
            <Detail label="Nationality" value={profile.nationality} />
            <Detail label="Emirates ID" value={profile.emiratesId} mono />
            <Detail label="Passport number" value={profile.passportNumber} mono />
            <Detail label="Phone" value={profile.phone} />
            <Detail label="Email" value={profile.email} />
            <Detail label="Emergency contact" value={profile.emergencyContact} />
          </dl>
        </Card>

        <Card>
          <CardHeader title="Work" />
          <dl className="grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
            <Detail label="Employee ID" value={profile.code} mono />
            <Detail label="Designation" value={profile.designation} />
            <Detail label="Department" value={profile.department} />
            <Detail label="Work location" value={profile.workLocation} />
            <Detail label="Join date" value={profile.joinDate ? shortDate(profile.joinDate) : null} />
          </dl>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Sign-in and security" description="The account you use to sign in to this app." />
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Detail label="Username" value={profile.username} mono />
            <Detail label="Access" value={roleLabel(profile.role)} />
          </dl>
          <Button variant="secondary" icon={KeyRound} onClick={() => setPasswordOpen(true)}>
            Change password
          </Button>
        </div>
      </Card>

      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </section>
  );
}
