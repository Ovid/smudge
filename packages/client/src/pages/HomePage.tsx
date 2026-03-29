import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ProjectListItem, ProjectModeType as ProjectMode } from "@smudge/shared";
import { api } from "../api/client";
import { NewProjectDialog } from "../components/NewProjectDialog";
import { STRINGS } from "../strings";

export function HomePage() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const navigate = useNavigate();

  const loadProjects = useCallback(async () => {
    const data = await api.projects.list();
    setProjects(data);
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  async function handleCreate(title: string, mode: ProjectMode) {
    const project = await api.projects.create({ title, mode });
    setDialogOpen(false);
    navigate(`/projects/${project.id}`);
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-2xl font-serif text-text-primary">{STRINGS.app.name}</h1>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8" aria-label={STRINGS.a11y.mainContent}>
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
          <p className="text-text-muted text-center py-12">
            {STRINGS.project.emptyState}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className="w-full rounded border border-border bg-bg-input p-4 text-left hover:bg-bg-hover focus:outline-none focus:ring-2 focus:ring-focus-ring"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-text-primary">{project.title}</span>
                    <span className="text-sm text-text-muted">
                      {project.mode === "fiction" ? STRINGS.project.fiction : STRINGS.project.nonfiction}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-text-secondary flex items-center gap-3">
                    <span>{STRINGS.project.wordCount(project.total_word_count)}</span>
                    <span className="text-text-muted">{STRINGS.project.lastEdited(project.updated_at)}</span>
                  </div>
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
    </div>
  );
}
