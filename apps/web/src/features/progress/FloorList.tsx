import { Pencil, Trash2 } from "lucide-react";
import type { SiteFloor } from "../../api/siteProgress";
import { Card, IconButton, Table, TableScroll, THead, Td, Th, TRow } from "../../ui";
import { AlignmentBadge, CompletionBadge, WirBadge } from "./FloorStatus";

export interface FloorRow {
  floor: SiteFloor;
  /** Position in the full (unfiltered) report, used by the edit and delete actions. */
  index: number;
}

interface FloorListProps {
  rows: FloorRow[];
  desktop: boolean;
  canEdit: boolean;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
}

function Actions({ row, canEdit, onEdit, onDelete }: { row: FloorRow } & Pick<FloorListProps, "canEdit" | "onEdit" | "onDelete">) {
  if (!canEdit) return null;
  return (
    <div className="flex items-center justify-end gap-1">
      <IconButton icon={Pencil} label={`Edit ${row.floor.floor}`} onClick={() => onEdit(row.index)} />
      <IconButton icon={Trash2} tone="danger" label={`Delete ${row.floor.floor}`} onClick={() => onDelete(row.index)} />
    </div>
  );
}

/** The floors: a table on desktop and tablet, one card per floor on a phone. */
export function FloorList({ rows, desktop, canEdit, onEdit, onDelete }: FloorListProps) {
  if (!desktop) {
    return (
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.floor.floor}>
            <Card className="p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 break-words text-base font-semibold text-ink-900">{row.floor.floor}</h3>
                <Actions row={row} canEdit={canEdit} onEdit={onEdit} onDelete={onDelete} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs font-semibold uppercase text-ink-600">Aluminium frames</dt>
                  <dd className="text-lg font-semibold tabular-nums">{row.floor.frames}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-ink-600">Fixed glass</dt>
                  <dd className="text-lg font-semibold tabular-nums">{row.floor.glass}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase text-ink-600">Shutters</dt>
                  <dd className="text-lg font-semibold tabular-nums">{row.floor.shutters}</dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <AlignmentBadge status={row.floor.alignment} />
                <CompletionBadge status={row.floor.completion} />
                <WirBadge status={row.floor.wirStatus} />
              </div>
              {row.floor.remarks && <p className="mt-3 break-words text-sm text-ink-700">{row.floor.remarks}</p>}
            </Card>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Card>
      <TableScroll>
        <Table>
          <THead>
            <tr>
              <Th>Floor</Th>
              <Th align="right">Aluminium frames</Th>
              <Th align="right">Fixed glass</Th>
              <Th align="right">Shutters</Th>
              <Th>Alignment</Th>
              <Th>Completion</Th>
              <Th>WIR status</Th>
              <Th>Site remarks</Th>
              {canEdit && (
                <Th align="right" className="print:hidden">
                  <span className="sr-only">Actions</span>
                </Th>
              )}
            </tr>
          </THead>
          <tbody>
            {rows.map((row) => (
              <TRow key={row.floor.floor}>
                <Td className="font-medium text-ink-900">{row.floor.floor}</Td>
                <Td numeric>{row.floor.frames}</Td>
                <Td numeric>{row.floor.glass}</Td>
                <Td numeric>{row.floor.shutters}</Td>
                <Td>
                  <AlignmentBadge status={row.floor.alignment} />
                </Td>
                <Td>
                  <CompletionBadge status={row.floor.completion} />
                </Td>
                <Td>
                  <WirBadge status={row.floor.wirStatus} />
                </Td>
                <Td className="max-w-xs break-words text-ink-700">{row.floor.remarks || "-"}</Td>
                {canEdit && (
                  <Td className="print:hidden">
                    <Actions row={row} canEdit={canEdit} onEdit={onEdit} onDelete={onDelete} />
                  </Td>
                )}
              </TRow>
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </Card>
  );
}
