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
      <header className="border-b border-border/60 px-6 h-12 flex items-center shrink-0">
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
          <h2 className="text-lg font-semibold text-text-primary">
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
            <p className="text-text-muted text-base">{STRINGS.project.emptyState}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.map((project) => (
              <li key={project.id} className="group relative">
                <button
                  onClick={() => navigate(`/projects/${project.slug}`)}
                  className="w-full rounded-lg border border-border/50 bg-bg-input px-5 py-3.5 text-left hover:bg-bg-hover hover:border-border-strong focus:outline-none focus:ring-2 focus:ring-focus-ring transition-all duration-200"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-lg font-serif font-medium text-text-primary tracking-tight leading-snug">
                      {project.title}
                    </span>
                    <span className="text-[10px] tracking-widest uppercase text-text-muted/70 font-medium shrink-0">
                      {project.mode === "fiction"
                        ? STRINGS.project.fiction
                        : STRINGS.project.nonfiction}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-text-muted flex items-center justify-between">
                    <span className="flex items-center gap-3">
                      <span>{STRINGS.project.wordCount(project.total_word_count)}</span>
                      <span className="text-border-strong" aria-hidden="true">
                        &middot;
                      </span>
                      <span>{STRINGS.project.lastEdited(project.updated_at)}</span>
                    </span>
                  </div>
                </button>
                <button
                  onClick={() => setDeleteTarget(project)}
                  className="absolute right-4 bottom-3 opacity-0 group-hover:opacity-100 focus:opacity-100 rounded-md p-1.5 text-text-muted/50 hover:text-status-error hover:bg-status-error/8 focus:outline-none focus:ring-2 focus:ring-focus-ring transition-all duration-200"
                  aria-label={STRINGS.delete.deleteProjectAriaLabel(project.title)}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
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
