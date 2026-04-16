# TODO

## Architecture

### Consider splitting ProjectStore interface

`ProjectStore` (`packages/server/src/stores/project-store.types.ts`) currently has 31 methods spanning 5 domains: projects, chapters, chapter statuses, settings, and velocity. Phase 4a adds images as a separate module using `getDb()` directly rather than extending the store, which is the right call — but it raises the question of whether the existing store should be decomposed.

Potential split: `ProjectStore` (projects + chapters, since they share transactions), `StatusStore`, `SettingsStore`, `VelocityStore`. Each would be a thin interface over its repository, initialized alongside the current store. The transaction boundary is the key design constraint — only entities that participate in the same transactions need to share a store.

Not urgent. The current monolithic store works. Revisit when the interface exceeds ~40 methods or when a new domain needs transaction coordination with an existing one.
