import { KeyRound, Info } from "lucide-react";
import type { StaffProfile } from "../../api/staff";
import { PAGE_GAP, PhoneTitle, phoneButton } from "../../components/phoneUi";
import { roleLabel } from "../../permissions";
import { Group, Row, Secret } from "../workers/WorkerProfilePhone";
import { Avatar } from "./staffKit";
import { shortDate } from "./staffUi";

/**
 * My Profile on a phone: who you are at the top, then your details as settings-style rows. The Emirates ID and passport
 * show only their last four characters until asked, as on the worker profile.
 */
export function MyProfilePhone({ profile, tenure, onChangePassword }: { profile: StaffProfile; tenure: string | null; onChangePassword: () => void }) {
  return (
    <section className={PAGE_GAP}>
      <PhoneTitle title="My Profile" />

      <div className="rounded-3xl border border-line bg-white p-4 shadow-card">
        <div className="flex items-center gap-4">
          <Avatar name={profile.fullName} size="lg" />
          <div className="min-w-0 flex-1">
            <h3 className="text-xl font-bold leading-tight text-ink-900">{profile.fullName}</h3>
            <p className="text-sm text-ink-700">
              {profile.designation}
              {profile.department ? ` · ${profile.department}` : ""}
            </p>
            <p className="mt-0.5 font-mono text-sm text-ink-600">{profile.code}</p>
          </div>
        </div>
        {profile.joinDate && tenure && (
          <p className="mt-4 rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
            With the company <span className="font-bold">{tenure}</span>, since {shortDate(profile.joinDate)}
          </p>
        )}
      </div>

      <Group title="Contact">
        <Row label="Phone" center>{profile.phone}</Row>
        <Row label="Email" center>{profile.email}</Row>
        <Row label="Emergency contact" center>{profile.emergencyContact}</Row>
      </Group>

      <Group title="Identity">
        <Row label="Nationality" center>{profile.nationality}</Row>
        <Secret label="Emirates ID" value={profile.emiratesId} />
        <Secret label="Passport" value={profile.passportNumber} />
      </Group>

      <Group title="Work">
        <Row label="Department" center>{profile.department}</Row>
        <Row label="Work location" center>{profile.workLocation}</Row>
        <Row label="Join date" center>{profile.joinDate ? shortDate(profile.joinDate) : null}</Row>
      </Group>

      <p className="flex items-start gap-2 px-1 text-sm text-ink-700">
        <Info aria-hidden="true" size={16} className="mt-0.5 shrink-0" /> These are your details as HR holds them. To correct anything, ask HR.
      </p>

      <Group title="Sign-in and security">
        <Row label="Username" center>
          <span className="font-mono text-[0.9375rem]">{profile.username}</span>
        </Row>
        <Row label="Access" center>{roleLabel(profile.role)}</Row>
      </Group>
      <button type="button" onClick={onChangePassword} className={phoneButton("secondary", "md", "w-full")}>
        <KeyRound aria-hidden="true" size={18} /> Change password
      </button>
    </section>
  );
}
