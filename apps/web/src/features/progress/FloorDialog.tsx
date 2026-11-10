import { useRef, useState, type FormEvent } from "react";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { Button, Select, Textarea } from "../../ui";
import {
  ALIGNMENT_OPTIONS,
  COMPLETION_OPTIONS,
  WIR_OPTIONS,
  type Alignment,
  type Completion,
  type SiteFloor,
  type WirStatus,
} from "../../api/siteProgress";

const EMPTY: SiteFloor = { floor: "", frames: 0, glass: 0, shutters: 0, alignment: "NotComplete", completion: "InProgress", wirStatus: "Pending", remarks: "" };

interface FloorDialogProps {
  open: boolean;
  /** The floor being edited; omit to add a new one. */
  floor?: SiteFloor;
  /** Names already used by the other floors, so a duplicate is caught before saving. */
  takenNames: string[];
  onSave: (floor: SiteFloor) => void;
  onClose: () => void;
}

/** Adds or edits one floor of the report. Nothing is stored until the whole report is saved. */
export function FloorDialog({ open, floor, takenNames, onSave, onClose }: FloorDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={floor ? "Edit floor" : "Add floor"}>
      <FloorForm floor={floor} takenNames={takenNames} onSave={onSave} onClose={onClose} />
    </Dialog>
  );
}

function wholeNumber(text: string): number | null {
  if (!/^\d{1,7}$/.test(text.trim())) return null;
  return Number(text);
}

function FloorForm({ floor, takenNames, onSave, onClose }: Omit<FloorDialogProps, "open">) {
  const initial = floor ?? EMPTY;
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial.floor);
  const [frames, setFrames] = useState(String(initial.frames));
  const [glass, setGlass] = useState(String(initial.glass));
  const [shutters, setShutters] = useState(String(initial.shutters));
  const [alignment, setAlignment] = useState<Alignment>(initial.alignment);
  const [completion, setCompletion] = useState<Completion>(initial.completion);
  const [wir, setWir] = useState<WirStatus>(initial.wirStatus);
  const [remarks, setRemarks] = useState(initial.remarks);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    const trimmed = name.trim();
    if (trimmed === "") next.floor = "Enter the floor name.";
    else if (trimmed.length > 60) next.floor = "Floor name must be 60 characters or fewer.";
    else if (takenNames.some((n) => n.toLowerCase() === trimmed.toLowerCase())) next.floor = "This floor is already in the report.";
    const framesValue = wholeNumber(frames);
    const glassValue = wholeNumber(glass);
    const shuttersValue = wholeNumber(shutters);
    if (framesValue === null) next.frames = "Enter a whole number of 0 or more.";
    if (glassValue === null) next.glass = "Enter a whole number of 0 or more.";
    if (shuttersValue === null) next.shutters = "Enter a whole number of 0 or more.";
    if (remarks.trim().length > 500) next.remarks = "Remarks must be 500 characters or fewer.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    onSave({
      floor: trimmed,
      frames: framesValue!,
      glass: glassValue!,
      shutters: shuttersValue!,
      alignment,
      completion,
      wirStatus: wir,
      remarks: remarks.trim(),
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <TextField
        label="Floor designation / ID"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.floor}
        placeholder="e.g. 3rd Floor / L03"
        maxLength={80}
        inputRef={nameRef}
        autoFocus
      />
      <div className="grid grid-cols-3 gap-3">
        <TextField label="Aluminium frames" inputMode="numeric" value={frames} onChange={(e) => setFrames(e.target.value)} error={errors.frames} />
        <TextField label="Fixed glass" inputMode="numeric" value={glass} onChange={(e) => setGlass(e.target.value)} error={errors.glass} />
        <TextField label="Shutters" inputMode="numeric" value={shutters} onChange={(e) => setShutters(e.target.value)} error={errors.shutters} />
      </div>
      <Select label="Alignment status" value={alignment} onChange={(e) => setAlignment(e.target.value as Alignment)}>
        {ALIGNMENT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <Select label="Floor completion status" value={completion} onChange={(e) => setCompletion(e.target.value as Completion)}>
        {COMPLETION_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <Select label="WIR (Work Inspection Request) status" value={wir} onChange={(e) => setWir(e.target.value as WirStatus)}>
        {WIR_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <Textarea
        label="Site remarks and notes"
        rows={3}
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
        error={errors.remarks}
        placeholder="Issues, delays or inspection comments"
      />
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">{floor ? "Update floor" : "Add floor"}</Button>
      </div>
    </form>
  );
}
