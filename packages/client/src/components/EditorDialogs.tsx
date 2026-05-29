import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { ConfirmDialog } from "./ConfirmDialog";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";
import { ShortcutHelpDialog } from "./ShortcutHelpDialog";
import { ExportDialog } from "./ExportDialog";
import { STRINGS } from "../strings";
import type {
  ReplaceConfirmation,
  useFindReplaceController,
} from "../hooks/useFindReplaceController";

type FindReplaceController = ReturnType<typeof useFindReplaceController>;

// F-1 decomposition (2026-05-29): the EditorPage dialog + live-region
// cluster — the delete-chapter and replace-confirmation ConfirmDialogs,
// the three screen-reader announcement regions (nav / word-count /
// image), and the project-settings / shortcut-help / export dialogs.
// Each dialog's open/close flag and handlers stay owned by the
// EditorPage body and are threaded in; this component only renders.
interface EditorDialogsProps {
  // Delete-chapter confirmation.
  deleteTarget: Chapter | null;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;

  // Find-and-replace confirmation (the IIFE that builds the dialog copy
  // from the pending replace lives here verbatim; it needs the raw
  // confirmation state plus its setter and the executor).
  replaceConfirmation: ReplaceConfirmation | null;
  setReplaceConfirmation: FindReplaceController["setReplaceConfirmation"];
  executeReplace: FindReplaceController["executeReplace"];

  // Live regions.
  navAnnouncement: string;
  wordCountAnnouncement: string;
  imageAnnouncement: string;

  // Project settings / shortcut help / export dialogs.
  project: ProjectWithChapters;
  projectSettingsOpen: boolean;
  onCloseSettings: () => void;
  onSettingsUpdate: () => void;
  shortcutHelpOpen: boolean;
  onCloseShortcutHelp: () => void;
  exportDialogOpen: boolean;
  onCloseExport: () => void;
}

export function EditorDialogs({
  deleteTarget,
  onConfirmDelete,
  onCancelDelete,
  replaceConfirmation,
  setReplaceConfirmation,
  executeReplace,
  navAnnouncement,
  wordCountAnnouncement,
  imageAnnouncement,
  project,
  projectSettingsOpen,
  onCloseSettings,
  onSettingsUpdate,
  shortcutHelpOpen,
  onCloseShortcutHelp,
  exportDialogOpen,
  onCloseExport,
}: EditorDialogsProps) {
  return (
    <>
      {deleteTarget && (
        <ConfirmDialog
          title={STRINGS.delete.confirmTitle(deleteTarget.title)}
          body={STRINGS.delete.confirmBody}
          confirmLabel={STRINGS.delete.confirmButton}
          cancelLabel={STRINGS.delete.cancelButton}
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
        />
      )}

      {replaceConfirmation &&
        (() => {
          // Empty replacement is a valid "delete all matches" operation. Use
          // distinct delete-copy in the dialog so the user can't confuse it
          // with a Replace that would substitute an empty string — the
          // destructive intent must be explicit before the user commits.
          const isDelete = replaceConfirmation.replacement.length === 0;
          const isProjectScope = replaceConfirmation.scope.type === "project";
          return (
            <ConfirmDialog
              title={
                isDelete
                  ? isProjectScope
                    ? STRINGS.findReplace.replaceDeleteConfirmTitle
                    : STRINGS.findReplace.replaceDeleteChapterConfirmTitle
                  : isProjectScope
                    ? STRINGS.findReplace.replaceConfirmTitle
                    : STRINGS.findReplace.replaceChapterConfirmTitle
              }
              body={
                isDelete
                  ? isProjectScope
                    ? STRINGS.findReplace.replaceDeleteConfirm(
                        replaceConfirmation.totalCount,
                        replaceConfirmation.query,
                        replaceConfirmation.chapterCount,
                      )
                    : STRINGS.findReplace.replaceDeleteChapterConfirm(
                        replaceConfirmation.perChapterCount,
                        replaceConfirmation.query,
                      )
                  : isProjectScope
                    ? STRINGS.findReplace.replaceConfirm(
                        replaceConfirmation.totalCount,
                        replaceConfirmation.query,
                        replaceConfirmation.replacement,
                        replaceConfirmation.chapterCount,
                      )
                    : STRINGS.findReplace.replaceChapterConfirm(
                        replaceConfirmation.perChapterCount,
                        replaceConfirmation.query,
                        replaceConfirmation.replacement,
                      )
              }
              confirmLabel={
                isDelete
                  ? STRINGS.findReplace.replaceDeleteConfirmButton
                  : STRINGS.findReplace.replaceConfirmButton
              }
              cancelLabel={STRINGS.findReplace.replaceCancelButton}
              onConfirm={() => {
                const frozen = replaceConfirmation;
                setReplaceConfirmation(null);
                void executeReplace({
                  scope: frozen.scope,
                  query: frozen.query,
                  replacement: frozen.replacement,
                  options: frozen.options,
                });
              }}
              onCancel={() => setReplaceConfirmation(null)}
            />
          );
        })()}

      <div aria-live="polite" className="sr-only" data-testid="nav-announcement">
        {navAnnouncement}
      </div>
      <div aria-live="polite" className="sr-only" data-testid="word-count-announcement">
        {wordCountAnnouncement}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {imageAnnouncement}
      </div>

      <ProjectSettingsDialog
        key={project.slug}
        open={projectSettingsOpen}
        project={project}
        onClose={onCloseSettings}
        onUpdate={onSettingsUpdate}
      />

      <ShortcutHelpDialog open={shortcutHelpOpen} onClose={onCloseShortcutHelp} />

      <ExportDialog
        open={exportDialogOpen}
        projectSlug={project.slug}
        projectId={project.id}
        chapters={project.chapters.map((ch) => ({
          id: ch.id,
          title: ch.title,
          sort_order: ch.sort_order,
        }))}
        onClose={onCloseExport}
      />
    </>
  );
}
