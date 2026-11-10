import { CheckCheck, CheckCircle2, CircleDashed, Clock, Loader, Send, XCircle } from "lucide-react";
import { StatusBadge } from "../../ui";
import { alignmentLabel, completionLabel, wirLabel, type Alignment, type Completion, type WirStatus } from "../../api/siteProgress";

/** Status is always an icon and a word together, never colour alone. */
export function WirBadge({ status }: { status: WirStatus }) {
  switch (status) {
    case "Approved":
      return <StatusBadge tone="success">{wirLabel(status)}</StatusBadge>;
    case "ApprovedWithComments":
      return (
        <StatusBadge tone="success" icon={CheckCheck}>
          {wirLabel(status)}
        </StatusBadge>
      );
    case "Submitted":
      return (
        <StatusBadge tone="info" icon={Send}>
          {wirLabel(status)}
        </StatusBadge>
      );
    case "Rejected":
      return (
        <StatusBadge tone="danger" icon={XCircle}>
          {wirLabel(status)}
        </StatusBadge>
      );
    default:
      return (
        <StatusBadge tone="warning" icon={Clock}>
          {wirLabel(status)}
        </StatusBadge>
      );
  }
}

export function AlignmentBadge({ status }: { status: Alignment }) {
  if (status === "Complete")
    return (
      <StatusBadge tone="success" icon={CheckCircle2}>
        {alignmentLabel(status)}
      </StatusBadge>
    );
  if (status === "UnderProcess")
    return (
      <StatusBadge tone="info" icon={Loader}>
        {alignmentLabel(status)}
      </StatusBadge>
    );
  return (
    <StatusBadge tone="neutral" icon={CircleDashed}>
      {alignmentLabel(status)}
    </StatusBadge>
  );
}

export function CompletionBadge({ status }: { status: Completion }) {
  if (status === "Completed")
    return (
      <StatusBadge tone="success" icon={CheckCircle2}>
        {completionLabel(status)}
      </StatusBadge>
    );
  if (status === "InProgress")
    return (
      <StatusBadge tone="info" icon={Loader}>
        {completionLabel(status)}
      </StatusBadge>
    );
  return (
    <StatusBadge tone="neutral" icon={CircleDashed}>
      {completionLabel(status)}
    </StatusBadge>
  );
}
