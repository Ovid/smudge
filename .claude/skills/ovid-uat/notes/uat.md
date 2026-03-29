# UAT Notes

## Common issues that slow down UAT

1. **Dev server migration errors**: When DB schema changes (e.g., migration file renamed from .ts to .js), the existing SQLite database may have stale migration records. **NEVER delete the production/dev DB** — it may contain the user's actual writing. Instead: (a) copy it to a backup first, (b) use a separate test DB path (e.g., `data/smudge-uat.db`) by setting `DB_PATH` env var, or (c) ask the user before touching any DB file. UAT should use a fresh temporary database, not the user's working data.

2. **Network/console tracking timing**: Browser automation tools (read_console_messages, read_network_requests) only track from the moment they're first called. Call them early to capture page load errors, or reload after first call.

3. **Server routes missing**: The client API may reference endpoints that don't exist on the server yet. Check server routes when client API calls fail silently or return HTML (the Vite fallback).

4. **Save-on-blur vs auto-save**: These are different mechanisms. Save-on-blur fires when the editor loses focus. Auto-save (debounced) fires after a pause in typing. Test both — a writer expects content to save while they're still focused on the editor.

5. **Word count server-side**: The server must recalculate word_count on every content PATCH, not just store what the client sends. Check that the shared countWords function is used in the chapter update route.
