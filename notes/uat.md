# UAT notes (Smudge)

Gotchas discovered during browser UAT runs. Add to this as you hit new ones.

## Isolated dev server

`DATA_DIR=/tmp/smudge-uat DB_PATH=/tmp/smudge-uat/uat.db npm run dev`

Both vars matter: `DATA_DIR` also owns the image store, so setting only
`DB_PATH` leaves uploads landing in the real `packages/server/data/`.
Client on 5173, server on 3456.

## UI mechanics that waste time if you guess

- **Chapter title is renamed from the sidebar**, not the editor. The `<h1>` in
  the main area is a heading, not an input — clicking it and typing silently
  does nothing. Double-click the chapter row in the left sidebar.
- **Reference panel** opens with the toolbar's right-hand panel icon (Ctrl+.).
  Its open/closed state and active tab persist per browser, so a fresh project
  may open with the panel closed.
- **TipTap image nodes resist selection** via drag or shift+arrow through the
  browser tools. To get an image inside a selection, click in the editor and
  press `cmd+a` (select-all) — that reliably includes image nodes.

## API endpoints worth using directly for assertions

- Export is **POST** `/api/projects/{slug}/export` with `{"format":"html"}` —
  not a GET with a query string. Formats: html, markdown, plaintext, docx, epub.
  docx/epub are zips; `unzip -p out.docx '*' | grep -i <sentinel>` to inspect.
- `GET /api/projects/{id}/outtakes`, `DELETE /api/outtakes/{id}` (204) are handy
  for setting up stale-client states the UI cannot produce on its own.
- Asserting an exclusion (word count / export / find-replace) needs a **sentinel
  string that exists only in the excluded store**. Reusing text that also lives
  in a chapter proves nothing.

## Chrome tool caveats

- `navigator.clipboard.readText()` via `javascript_tool` **hangs the CDP call**
  (45s timeout) — it needs a permission the extension does not grant. To verify
  clipboard contents, paste (`cmd+v`) into any textarea in the app and read it
  visually.
- Panel-level error/status messages render at the **top of the panel**, so after
  acting on a card below the fold you must scroll up to see whether a message
  appeared. Absence of a visible message is not absence of a message.
