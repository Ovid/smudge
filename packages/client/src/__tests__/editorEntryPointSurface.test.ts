import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ===========================================================================
// F-1 forcing-pause: the editor-mutating entry-point surface.
// ===========================================================================
//
// EditorPage.tsx is the god-orchestrator (architecture report F-1). It is the
// single place that owns the shared mutable busy/lock state and threads it into
// every editor-mutating entry point. The load-bearing invariant (CLAUDE.md
// §Save-pipeline invariants) is that each such entry point must refuse while a
// mutation is in-flight (the `isActionBusy()` / `mutation.isBusy()` latch) or
// while the editor-locked banner is up (the `editorMachine.isLocked()` check),
// so a stale PATCH can never overwrite a server-committed mutation.
//
// That invariant is enforced per-site by hand — there is deliberately no single
// wrapper every entry point routes through (the guards are individually
// distinct: some check busy+lock, some busy-only, and the content/save path
// gates on the machine's `editable` flag instead). A mechanical check cannot
// DECIDE which guard a new entry point needs — that choice is irreducibly
// semantic. What it CAN do is refuse to let a new entry point land silently.
//
// This test snapshots the full name-set of every prop/key EditorPage threads
// into its four wiring sites (EditorHeader, EditorMainContent, EditorDialogs,
// and the useKeyboardShortcuts registration). Adding or removing ANY of them
// turns this test red.
//
//   *** If this test fails because you changed an entry point: STOP and decide
//   *** the new entry point's guard axis before updating the list below:
//   ***   - a chapter/structure/status action -> `isActionBusy()` + `isLocked()`
//   ***   - a panel/view toggle that can remount the editor -> same
//   ***   - the content/save path -> the machine's editable/lock, NOT isActionBusy
//   ***   - genuinely non-mutating (data, ref, setter, dismiss, view-only) -> no guard
//   *** See CLAUDE.md §Save-pipeline invariants (1-5). Over-including a benign
//   *** prop here is harmless; a MISSING one is the silent regression this
//   *** guards against.
//
// This converts "a reviewer might notice a new entry point on a 1094-line
// component" into "CI blocks until the author acknowledges it." It does not
// (and cannot) verify the guard is correct — that is what the behavioral guard
// tests in EditorPageFeatures.test.tsx do for the current handlers.
//
// Extraction assumes Prettier's stable indentation (props at 8 spaces under a
// 6-space tag; hook keys at 4 spaces under a 2-space call). A reformat that
// shifts indentation surfaces as a loud false-RED (every name "missing"), not a
// silent false-GREEN — the safe failure direction.

const editorPagePath = resolve(dirname(fileURLToPath(import.meta.url)), "../pages/EditorPage.tsx");

// Collects the capture group of `nameRe` from every line strictly between the
// first line matching `startRe` and the next line matching `endRe`. Returns the
// names sorted and de-duplicated. `nameRe` is anchored at the exact top-level
// indent so nested handler-body lines (deeper indent) and comments (which start
// with `/` at the indent column) never match.
export function extractRegionNames(
  source: string,
  startRe: RegExp,
  endRe: RegExp,
  nameRe: RegExp,
): string[] {
  const lines = source.split("\n");
  const start = lines.findIndex((l) => startRe.test(l));
  if (start === -1) throw new Error(`region start not found: ${startRe}`);
  const relEnd = lines.slice(start + 1).findIndex((l) => endRe.test(l));
  if (relEnd === -1) throw new Error(`region end not found: ${endRe}`);
  const end = start + 1 + relEnd;
  const names = new Set<string>();
  for (const line of lines.slice(start + 1, end)) {
    const m = nameRe.exec(line);
    if (m && m[1] !== undefined) names.add(m[1]);
  }
  return [...names].sort();
}

// Props sit at 8 spaces as `name={...}`; keys sit at 4 spaces as `name:`/`name,`.
const PROP_RE = /^ {8}([A-Za-z_]\w*)=/;
const KEY_RE = /^ {4}([A-Za-z_]\w*)[,:]/;

const HEADER_START = /^ {6}<EditorHeader\b/;
const MAIN_START = /^ {6}<EditorMainContent\b/;
const DIALOGS_START = /^ {6}<EditorDialogs\b/;
const SELF_CLOSE = /^ {6}\/>/;
const HOOK_START = /^ {2}useKeyboardShortcuts\(\{/;
const HOOK_END = /^ {2}\}\);/;

// --- Committed entry-point surface. Update ONLY after reading the header. -----

const EDITOR_HEADER_PROPS = [
  "projectTitle",
  "onNavigateHome",
  "editingProjectTitle",
  "projectTitleDraft",
  "setProjectTitleDraft",
  "saveProjectTitle",
  "cancelEditingProjectTitle",
  "startEditingProjectTitle",
  "projectTitleError",
  "projectTitleInputRef",
  "showActiveEditor",
  "viewMode",
  "toolbarEditor",
  "snapshotCount",
  "onToggleSnapshots",
  "onToggleFindReplace",
  "snapshotsTriggerRef",
  "findReplaceTriggerRef",
  "onSwitchToView",
  "onOpenExport",
  "onToggleReferencePanel",
  "panelOpen",
  "onOpenSettings",
];

const EDITOR_MAIN_CONTENT_PROPS = [
  "sidebarOpen",
  "sidebarWidth",
  "onSidebarResize",
  "project",
  "activeChapter",
  "showActiveEditor",
  "viewMode",
  "statuses",
  "onSelectChapter",
  "onAddChapter",
  "onDeleteChapter",
  "onReorderChapters",
  "onRenameChapter",
  "onOpenTrash",
  "onStatusChange",
  "editorLockedMessage",
  "actionError",
  "onDismissActionError",
  "actionInfo",
  "onDismissActionInfo",
  "trashOpen",
  "trashedChapters",
  "onRestore",
  "onCloseTrash",
  "dashboardRefreshKey",
  "viewingSnapshot",
  "onRestoreSnapshot",
  "onExitSnapshotView",
  "editingTitle",
  "titleDraft",
  "setTitleDraft",
  "saveTitle",
  "cancelEditingTitle",
  "startEditingTitle",
  "titleError",
  "titleInputRef",
  "chapterReloadKey",
  "editorRef",
  "onSave",
  "onContentChange",
  "onEditorReady",
  "onImageAnnouncement",
  "onImageUploadCommitted",
  "chapterWordCount",
  "saveStatus",
  "saveErrorMessage",
  "cacheWarning",
  "panelOpen",
  "panelWidth",
  "onPanelResize",
  "activeTabId",
  "onSelectTab",
  "galleryExternalRefreshKey",
  "onInsertImage",
  "snapshotPanelOpen",
  "onCloseSnapshotPanel",
  "snapshotPanelRef",
  "onSnapshotView",
  "onSnapshotBeforeCreate",
  "onSnapshotsChange",
  "snapshotsTriggerRef",
  "findReplace",
  "onReplaceOne",
  "onReplaceAllInChapter",
  "onReplaceAllInManuscript",
  "findReplaceTriggerRef",
];

const EDITOR_DIALOGS_PROPS = [
  "deleteTarget",
  "onConfirmDelete",
  "onCancelDelete",
  "replaceConfirmation",
  "setReplaceConfirmation",
  "executeReplace",
  "navAnnouncement",
  "wordCountAnnouncement",
  "imageAnnouncement",
  "project",
  "projectSettingsOpen",
  "onCloseSettings",
  "onSettingsUpdate",
  "shortcutHelpOpen",
  "onCloseShortcutHelp",
  "exportDialogOpen",
  "onCloseExport",
];

const KEYBOARD_SHORTCUT_KEYS = [
  "shortcutHelpOpen",
  "deleteTarget",
  "projectSettingsOpen",
  "exportDialogOpen",
  "replaceConfirmOpen",
  "viewMode",
  "activeChapter",
  "project",
  "chapterWordCount",
  "flushSave",
  "setShortcutHelpOpen",
  "toggleSidebar",
  "handleCreateChapter",
  "handleSelectChapterWithFlush",
  "setWordCountAnnouncement",
  "setNavAnnouncement",
  "switchToView",
  "togglePanel",
  "toggleFindReplace",
];

describe("F-1: editor-mutating entry-point surface (forcing-pause)", () => {
  const source = readFileSync(editorPagePath, "utf-8");

  it("EditorHeader props match the committed surface", () => {
    expect(extractRegionNames(source, HEADER_START, SELF_CLOSE, PROP_RE)).toEqual(
      [...EDITOR_HEADER_PROPS].sort(),
    );
  });

  it("EditorMainContent props match the committed surface", () => {
    expect(extractRegionNames(source, MAIN_START, SELF_CLOSE, PROP_RE)).toEqual(
      [...EDITOR_MAIN_CONTENT_PROPS].sort(),
    );
  });

  it("EditorDialogs props match the committed surface", () => {
    expect(extractRegionNames(source, DIALOGS_START, SELF_CLOSE, PROP_RE)).toEqual(
      [...EDITOR_DIALOGS_PROPS].sort(),
    );
  });

  it("useKeyboardShortcuts keys match the committed surface", () => {
    expect(extractRegionNames(source, HOOK_START, HOOK_END, KEY_RE)).toEqual(
      [...KEYBOARD_SHORTCUT_KEYS].sort(),
    );
  });
});

describe("extractRegionNames (drift-detector self-tests)", () => {
  // A fixture in the real formatting shape: a self-closing 6-space tag whose
  // props sit at 8 spaces, one prop carrying a nested inline arrow whose body
  // (10+ spaces) and closing `}}` (8 spaces) must NOT be mistaken for props.
  const fixture = [
    "  return (",
    "    <div>",
    "      <Widget",
    "        alpha={alpha}",
    "        // beta is intentionally commented out",
    "        onBeta={() => {",
    "          if (busy()) return;",
    "          doThing();",
    "        }}",
    "        gamma={gamma}",
    "      />",
    "    </div>",
    "  );",
  ].join("\n");

  it("extracts only top-level props, skipping nested body and comment lines", () => {
    expect(extractRegionNames(fixture, /^ {6}<Widget\b/, SELF_CLOSE, PROP_RE)).toEqual([
      "alpha",
      "gamma",
      "onBeta",
    ]);
  });

  it("detects a newly added entry point (the drift it exists to catch)", () => {
    const withNewProp = fixture.replace(
      "        gamma={gamma}",
      "        gamma={gamma}\n        onDelta={handleDelta}",
    );
    const extracted = extractRegionNames(withNewProp, /^ {6}<Widget\b/, SELF_CLOSE, PROP_RE);
    // A new prop appears in the extracted set, so it would no longer equal a
    // committed [alpha, gamma, onBeta] list — the assertion goes red.
    expect(extracted).toContain("onDelta");
    expect(extracted).not.toEqual(["alpha", "gamma", "onBeta"]);
  });

  it("extracts object keys (shorthand and colon forms), skipping nested values", () => {
    const hookFixture = [
      "  useThing({",
      "    dataFlag,",
      "    computed: a !== null,",
      "    handler: () => {",
      "      if (busy()) return;",
      "    },",
      "  });",
    ].join("\n");
    expect(extractRegionNames(hookFixture, /^ {2}useThing\(\{/, HOOK_END, KEY_RE)).toEqual([
      "computed",
      "dataFlag",
      "handler",
    ]);
  });

  it("throws a readable error when the region markers are absent", () => {
    expect(() => extractRegionNames("const x = 1;", MAIN_START, SELF_CLOSE, PROP_RE)).toThrow(
      /region start not found/,
    );
    expect(() =>
      extractRegionNames(
        "      <EditorMainContent\n        a={a}",
        MAIN_START,
        SELF_CLOSE,
        PROP_RE,
      ),
    ).toThrow(/region end not found/);
  });
});
