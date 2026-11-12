import { useState, type FormEvent } from "react";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { ApiError } from "../../api/client";
import { createProject, updateProject, type SiteProject } from "../../api/siteProgress";
import { Button } from "../../ui";

interface ProjectDialogProps {
  open: boolean;
  /** The project being renamed or deactivated; omit to create one. */
  project?: SiteProject;
  onDone: (project: SiteProject) => void;
  onClose: () => void;
}

/** Managers create, rename and deactivate projects. A deactivated project keeps its reports but takes no new ones. */
export function ProjectDialog({ open, project, onDone, onClose }: ProjectDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={project ? "Edit project" : "New project"}>
      <ProjectForm project={project} onDone={onDone} onClose={onClose} />
    </Dialog>
  );
}

function ProjectForm({ project, onDone, onClose }: Omit<ProjectDialogProps, "open">) {
  const [name, setName] = useState(project?.name ?? "");
  const [isActive, setIsActive] = useState(project?.isActive ?? true);
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === "") {
      setError("Enter the project name.");
      return;
    }
    setError(undefined);
    setFailure(null);
    setPending(true);
    try {
      const saved = project ? await updateProject(project.id, name.trim(), isActive) : await createProject(name.trim());
      onDone(saved);
    } catch (caught) {
      if (caught instanceof ApiError && caught.fieldErrors?.name) setError(caught.fieldErrors.name[0]);
      else setFailure(caught instanceof ApiError ? caught.message : "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <TextField label="Project name" value={name} onChange={(e) => setName(e.target.value)} error={error} maxLength={120} autoFocus />
      {project && (
        <label className="flex min-h-11 items-center gap-3 text-sm text-ink-800">
          <input type="checkbox" className="size-5" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active (inactive projects take no new reports)
        </label>
      )}
      {failure && (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {project ? "Save project" : "Create project"}
        </Button>
      </div>
    </form>
  );
}
