import { StatusBadge } from "../../ui";

/** Status as an icon, a word and a colour, so it never relies on colour alone. */
export function WorkerStatusBadge({ isActive }: { isActive: boolean }) {
  return isActive ? <StatusBadge tone="success" variant="soft">Active</StatusBadge> : <StatusBadge tone="neutral" variant="soft">Inactive</StatusBadge>;
}
