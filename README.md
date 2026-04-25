# Smudge

**A writing app for people writing books, not documents.**

![Smudge](images/smudge.png)

Google Docs treats every chapter like a separate island. Scrivener is powerful but desktop-bound and visually stuck in 2005. Smudge sits in the space between: structured enough to manage a book-length project, simple enough that you open it and write.

Smudge organizes your long-form work — fiction or non-fiction — as projects made of chapters. You get a distraction-minimal editor, a sidebar to navigate your manuscript, drag-and-drop chapter reordering, live word counts, and auto-save you never have to think about. Open it and write.

## Quick Start

**Prerequisites:** Node.js 22 (pinned in [`.nvmrc`](.nvmrc)). Recommended: install via [nvm](https://github.com/nvm-sh/nvm) on macOS/Linux, [nvm-windows](https://github.com/coreybutler/nvm-windows) or [fnm](https://github.com/Schniz/fnm) on Windows. All read `.nvmrc` automatically.

```bash
# Clone and install
git clone https://github.com/Ovid/smudge.git
cd smudge
nvm install        # or: fnm use, volta pin — reads .nvmrc
npm install

# Start developing
make dev
```

The app runs at [http://localhost:3456](http://localhost:3456).

For the full contributor guide — Node version rationale, PR rules, commit conventions — see [CONTRIBUTING.md](CONTRIBUTING.md).

If you plan to run the end-to-end tests (`make e2e` or `make all`), also run this once per machine:

```bash
npx playwright install    # Chromium/Firefox/WebKit browser binaries (~265 MB)
```

### Docker

```bash
docker compose up
```

Single container, single port (3456), SQLite database persisted via volume. Nothing to configure.

## What You Get

- **Projects and chapters** — organize a full manuscript, not a pile of files
- **Rich text editing** — bold, italic, headings, block quotes, lists, powered by [TipTap](https://tiptap.dev/)
- **Auto-save you can trust** — 1.5s debounce, retry with backoff, persistent status indicator
- **Live word counts** — per-chapter and full manuscript, always in sync between client and server
- **Chapter reordering** — drag-and-drop or keyboard shortcuts (Alt+Up/Down)
- **Preview mode** — read through your entire manuscript as one continuous document
- **Soft delete with 30-day recovery** — nothing is permanently gone by accident
- **Accessible by default** — WCAG 2.1 AA, full keyboard navigation, screen reader support

## Tech Stack

TypeScript monorepo (npm workspaces) with three packages:

| Package | Role | Key Tech |
|---------|------|----------|
| `packages/shared` | Types, schemas, word counting | Zod, `Intl.Segmenter` |
| `packages/server` | REST API | Express, better-sqlite3, Knex.js |
| `packages/client` | Single-page app | React, Vite, TipTap v2, Tailwind CSS |

## Development

```bash
make dev       # Start server + client dev servers
make test      # Run full test suite (Vitest)
make lint      # Lint with autofix
make format    # Format code
make all       # Lint + format + test (full CI pass)
make cover     # Code coverage report
make help      # Show all targets
```

### Per-package testing

```bash
npm test -w packages/shared     # Shared unit tests
npm test -w packages/server     # Server integration tests
npx playwright test             # End-to-end + accessibility
```

## Design Philosophy

1. **Think like a writer, not a developer.** Every feature answers: "Does this help someone write a book?"
2. **Stay out of the way.** The default state is you looking at your words. UI chrome lives at the edges.
3. **Trust the save.** Auto-save is invisible and reliable. You never think about saving.
4. **Structure without rigidity.** A "chapter" can be a chapter, a section, an interlude, a prologue — whatever you need.
5. **Accessible by default.** Accessibility is a design constraint, not a feature toggle.

## Roadmap

Smudge is in active development. The MVP is the foundation — everything after it makes Smudge a *writer's* tool, not just an editor.

| Phase | Name | What it unlocks |
|-------|------|-----------------|
| 0 | **MVP** | Projects, chapters, rich text editing, auto-save, preview, word counts |
| 1 | **Writer's Dashboard** | Chapter status tracking, manuscript overview, navigation shortcuts |
| 2 | **Goals & Velocity** | Word targets, deadlines, daily tracking, session stats, burndown charts |
| 3 | **Export** | HTML, PDF, Word, Markdown, EPUB, plain text |
| 4 | **Annotations & Infrastructure** | Snapshots, inline notes, scratchpad, find-and-replace, tags, reference panel |
| 5 | **Fiction Tools** | Character sheets, scene cards, world-building bible, relationship maps, timelines |
| 6 | **Non-Fiction Tools** | Research library, citation management, fact-check flags, argument structure |
| 7 | **Polish & Power** | Dark mode, distraction-free mode, split view, style linting, TTS, i18n |

See [`docs/roadmap.md`](docs/roadmap.md) for full details and [`docs/plans/mvp.md`](docs/plans/mvp.md) for the MVP spec.

## License

[MIT](LICENSE)
