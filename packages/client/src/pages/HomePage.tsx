import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProjectListItem, ProjectModeType as ProjectMode } from "@smudge/shared";
import { api } from "../api/client";
import { NewProjectDialog } from "../components/NewProjectDialog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { STRINGS } from "../strings";
import { Logo } from "../components/Logo";

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
      navigate(`/projects/${project.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : STRINGS.error.createFailed);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api.projects.delete(deleteTarget.slug);
      setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : STRINGS.error.deleteFailed);
      setDeleteTarget(null);
    }
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <header className="border-b border-border/60 px-6 py-3">
        <Logo as="h1" />
      </header>

      <main
        className="mx-auto max-w-2xl px-8 py-12 page-enter"
        aria-label={STRINGS.a11y.mainContent}
      >
        {error && (
          <div
            role="alert"
            className="mb-6 rounded-lg bg-status-error/8 px-5 py-3 text-status-error text-sm border border-status-error/15"
          >
            {error}
          </div>
        )}
        <div className="flex items-center justify-between mb-10">
          <h2 className="text-2xl font-serif font-semibold text-text-primary tracking-tight">
            {STRINGS.home.projectsHeading}
          </h2>
          <button
            onClick={() => setDialogOpen(true)}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-text-inverse hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-focus-ring focus:ring-offset-2 focus:ring-offset-bg-primary shadow-sm"
          >
            {STRINGS.project.createNew}
          </button>
        </div>

        {projects.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-text-muted text-lg font-serif italic">
              {STRINGS.project.emptyState}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {projects.map((project) => (
              <li key={project.id} className="flex items-center gap-2 group">
                <button
                  onClick={() => navigate(`/projects/${project.slug}`)}
                  className="flex-1 rounded-lg border border-border/70 bg-bg-input p-5 text-left hover:bg-bg-hover hover:border-border-strong focus:outline-none focus:ring-2 focus:ring-focus-ring transition-all duration-200"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-serif font-medium text-text-primary tracking-tight">
                      {project.title}
                    </span>
                    <span className="text-xs tracking-wide uppercase text-text-muted font-medium">
                      {project.mode === "fiction"
                        ? STRINGS.project.fiction
                        : STRINGS.project.nonfiction}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-text-secondary flex items-center gap-4">
                    <span className="font-medium">
                      {STRINGS.project.wordCount(project.total_word_count)}
                    </span>
                    <span className="text-text-muted">
                      {STRINGS.project.lastEdited(project.updated_at)}
                    </span>
                  </div>
                </button>
                <button
                  onClick={() => setDeleteTarget(project)}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 rounded-lg p-2.5 text-text-muted hover:text-status-error hover:bg-status-error/8 focus:outline-none focus:ring-2 focus:ring-focus-ring transition-all duration-200"
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
        <ConfirmDialog
          title={STRINGS.delete.confirmTitle(deleteTarget.title)}
          body={STRINGS.delete.confirmBody}
          confirmLabel={STRINGS.delete.confirmButton}
          cancelLabel={STRINGS.delete.cancelButton}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
