import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProjectListItem, ProjectModeType as ProjectMode } from "@smudge/shared";
import { api } from "../api/client";
import { NewProjectDialog } from "../components/NewProjectDialog";
import { STRINGS } from "../strings";

export function HomePage() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectListItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function loadProjects() {
      try {
        const data = await api.projects.list();
        if (!cancelled) setProjects(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : STRINGS.error.loadFailed);
        }
      }
    }

    loadProjects();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(title: string, mode: ProjectMode) {
    try {
      const project = await api.projects.create({ title, mode });
      setDialogOpen(false);
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : STRINGS.error.createFailed);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api.projects.delete(deleteTarget.id);
      setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : STRINGS.error.deleteFailed);
      setDeleteTarget(null);
    }
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-2xl font-serif text-text-primary">{STRINGS.app.name}</h1>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8" aria-label={STRINGS.a11y.mainContent}>
        {error && (
          <div role="alert" className="mb-4 rounded bg-status-error/10 px-4 py-3 text-status-error text-sm">
            {error}
          </div>
        )}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-text-primary">Projects</h2>
          <button
            onClick={() => setDialogOpen(true)}
            className="rounded bg-accent px-4 py-2 text-text-inverse hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            {STRINGS.project.createNew}
          </button>
        </div>

        {projects.length === 0 ? (
          <p className="text-text-muted text-center py-12">{STRINGS.project.emptyState}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.map((project) => (
              <li key={project.id} className="flex items-center gap-2">
                <button
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className="flex-1 rounded border border-border bg-bg-input p-4 text-left hover:bg-bg-hover focus:outline-none focus:ring-2 focus:ring-focus-ring"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-text-primary">{project.title}</span>
                    <span className="text-sm text-text-muted">
                      {project.mode === "fiction"
                        ? STRINGS.project.fiction
                        : STRINGS.project.nonfiction}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-text-secondary flex items-center gap-3">
                    <span>{STRINGS.project.wordCount(project.total_word_count)}</span>
                    <span className="text-text-muted">
                      {STRINGS.project.lastEdited(project.updated_at)}
                    </span>
                  </div>
                </button>
                <button
                  onClick={() => setDeleteTarget(project)}
                  className="rounded p-2 text-text-muted hover:text-status-error focus:outline-none focus:ring-2 focus:ring-focus-ring"
                  aria-label={STRINGS.delete.buttonLabel}
                >
                  {STRINGS.delete.buttonLabel}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      <NewProjectDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={handleCreate}
      />

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          role="alertdialog"
          aria-modal="true"
          aria-label="Confirm delete"
          aria-describedby="home-delete-confirm-body"
        >
          <div className="rounded bg-bg-primary p-6 shadow-lg max-w-sm w-full mx-4">
            <p className="text-text-primary font-medium mb-2">
              {STRINGS.delete.confirmTitle(deleteTarget.title)}
            </p>
            <p id="home-delete-confirm-body" className="text-text-secondary text-sm mb-4">
              {STRINGS.delete.confirmBody}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded px-4 py-2 text-text-secondary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring"
              >
                {STRINGS.delete.cancelButton}
              </button>
              <button
                onClick={handleDelete}
                className="rounded bg-status-error px-4 py-2 text-text-inverse hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-focus-ring"
              >
                {STRINGS.delete.confirmButton}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
