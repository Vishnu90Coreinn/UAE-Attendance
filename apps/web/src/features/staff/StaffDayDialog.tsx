import { useEffect, useState } from "react";
import { Ban, MapPin, Plus } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { addManualPunch, getSelfie, getStaffDetail, voidPunch, type Punch, type StaffDayDetail } from "../../api/staff";
import { Button, Input, Select } from "../../ui";
import { ActionFailure } from "../workers/WorkersFeedback";
import { DayFlags, errorText, hoursText, longDate, StaffStatusBadge } from "./staffUi";

/** A selfie, fetched with the sign-in token and shown from a temporary blob URL. */
function Selfie({ punch }: { punch: Punch }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!punch.hasSelfie) return;
    let cancelled = false;
    let created: string | null = null;
    getSelfie(punch.id)
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setUrl(created);
      })
      .catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [punch.id, punch.hasSelfie]);
  if (!punch.hasSelfie || missing) {
    return <div className="flex size-24 items-center justify-center rounded-lg border border-dashed border-ink-300 text-center text-xs text-ink-600">{punch.source === "Manual" ? "Added by hand" : "No photo"}</div>;
  }
  return url ? (
    <img src={url} alt={`Selfie at ${punch.time.slice(0, 5)}`} className="size-24 rounded-lg border border-line object-cover" />
  ) : (
    <div role="status" className="size-24 animate-pulse rounded-lg bg-ink-100"><span className="sr-only">Loading selfie</span></div>
  );
}

function mapUrl(p: Punch): string | null {
  if (p.latitude == null || p.longitude == null) return null;
  return `https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=17/${p.latitude}/${p.longitude}`;
}

interface Props {
  workerId: number;
  date: string;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}

export function StaffDayDialog({ workerId, date, canEdit, onClose, onChanged }: Props) {
  const [detail, setDetail] = useState<StaffDayDetail | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [kind, setKind] = useState<"In" | "Out">("In");
  const [time, setTime] = useState("09:00");
  const [reason, setReason] = useState("");
  const [voiding, setVoiding] = useState<Punch | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getStaffDetail(workerId, date)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setFailure(errorText(e)));
    return () => {
      cancelled = true;
    };
  }, [workerId, date]);

  async function run(action: () => Promise<StaffDayDetail>) {
    setBusy(true);
    setFailure(null);
    try {
      setDetail(await action());
      onChanged();
      setReason("");
      setVoiding(null);
      setVoidReason("");
    } catch (e) {
      setFailure(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const row = detail?.row;
  return (
    <Dialog open onClose={onClose} title={row ? `${row.name}` : "Attendance"} size="wide">
      <p className="mt-1 text-sm text-ink-600">{longDate(date)}{row ? ` · ${row.code}` : ""}</p>
      {failure && <div className="mt-3"><ActionFailure message={failure} /></div>}
      {!detail ? (
        !failure && <p role="status" className="py-8 text-center text-ink-600">Loading...</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <StaffStatusBadge status={detail.row.day.status} />
            <DayFlags day={detail.row.day} />
            <span className="text-sm text-ink-700">{hoursText(detail.row.day.hours)} worked</span>
          </div>

          <ul className="mt-4 space-y-3">
            {detail.punches.length === 0 && <li className="text-sm text-ink-600">No sign-ins recorded on this day.</li>}
            {detail.punches.map((p) => {
              const map = mapUrl(p);
              return (
                <li key={p.id} className={`flex flex-wrap gap-4 rounded-lg border border-line p-3 ${p.isVoided ? "opacity-60" : ""}`}>
                  <Selfie punch={p} />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-semibold text-ink-900">
                      {p.kind === "In" ? "Signed in" : "Signed out"} at {p.time.slice(0, 5)}
                      {p.isVoided && <span className="ml-2 text-xs font-normal text-red-800">Voided: {p.voidReason}</span>}
                    </p>
                    <p className="text-ink-600">{p.source === "Manual" ? `Added by ${p.createdBy}: ${p.reason}` : `By the employee`}</p>
                    {p.outsideOffice && <p className="text-amber-800">Outside the office area{p.distanceMeters != null ? ` (${Math.round(p.distanceMeters)} m away)` : p.latitude == null ? " (no location)" : ""}</p>}
                    {map && (
                      <a href={map} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-brand-700 underline">
                        <MapPin aria-hidden="true" size={14} /> View on map
                      </a>
                    )}
                    {canEdit && !p.isVoided && (
                      <button type="button" onClick={() => setVoiding(p)} className="mt-1 ml-3 inline-flex items-center gap-1 text-red-800 underline">
                        <Ban aria-hidden="true" size={14} /> Void
                      </button>
                    )}
                  </div>
                  {map && (
                    <iframe
                      title={`Map for ${p.kind === "In" ? "sign-in" : "sign-out"} at ${p.time.slice(0, 5)}`}
                      loading="lazy"
                      className="h-24 w-40 rounded-lg border border-line"
                      src={`https://www.openstreetmap.org/export/embed.html?bbox=${p.longitude! - 0.002}%2C${p.latitude! - 0.0015}%2C${p.longitude! + 0.002}%2C${p.latitude! + 0.0015}&layer=mapnik&marker=${p.latitude}%2C${p.longitude}`}
                    />
                  )}
                </li>
              );
            })}
          </ul>

          {voiding && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
              <Input label={`Reason for voiding the ${voiding.kind === "In" ? "sign-in" : "sign-out"} at ${voiding.time.slice(0, 5)}`} value={voidReason} maxLength={300} onChange={(e) => setVoidReason(e.target.value)} />
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setVoiding(null)}>Keep it</Button>
                <Button variant="danger" disabled={busy || !voidReason.trim()} onClick={() => void run(() => voidPunch(voiding.id, voidReason))}>Void record</Button>
              </div>
            </div>
          )}

          {canEdit && (
            <div className="mt-5 border-t border-line pt-4">
              <h3 className="text-sm font-semibold text-ink-800">Add a missing record</h3>
              <p className="text-xs text-ink-600">For a forgotten sign-out or a missed sign-in. A reason is required and the change is logged.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <Select label="Type" value={kind} onChange={(e) => setKind(e.target.value as "In" | "Out")}>
                  <option value="In">Sign in</option>
                  <option value="Out">Sign out</option>
                </Select>
                <Input label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                <div className="sm:col-span-2"><Input label="Reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
              </div>
              <div className="mt-3 flex justify-end">
                <Button icon={Plus} disabled={busy || !reason.trim() || !time} onClick={() => void run(() => addManualPunch({ workerId, date, time, kind, reason }))}>Add record</Button>
              </div>
            </div>
          )}
        </>
      )}
      <div className="mt-5 flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
    </Dialog>
  );
}
