# Farmies

## Authority and scope

Read `.planning/mvp.md`, `.planning/mvp-2.md`, and `.planning/mvp-data-model.md` before product work; keep applicable PlantUML diagrams synchronized. `.planning/mvp.md` is the completed first-slice record; `.planning/mvp-2.md` is the active implementation plan and progress tracker after its approval. Planning artifacts are local and gitignored.

Farmies is a private friend-group app. The active second MVP supports at most three active memberships and one owned Party while retaining at most 10 members per Party, `COW` + `PASTURE`, responsive web first, and Capacitor Android second. English and Spanish are required. Deferred features include iOS packaging, other species/environments, chat, presence, realtime delivery, public profiles, social login, and monetization.

## Architecture

- Client: Vue 3, TypeScript, Quasar, Pinia, Vue Router, PixiJS, Zod, and Capacitor adapters.
- UI: compose reusable Vue components from Quasar primitives; use shared semantic light/dark theme tokens, not a second component library.
- Preferences: locale options come from the language registry; locale/theme stores own changes and persistence, not UI components. Theme is device-local; locale syncs to the authenticated account.
- API: Cloudflare Worker, Hono, Zod, Drizzle, Hyperdrive, and Supabase PostgreSQL.
- Auth: Supabase email OTP; clients use Supabase directly only for authentication.
- Files: private R2 objects served only through authorized Worker routes.
- Boundaries: Vue owns UI, PixiJS owns scene rendering, adapters own platform access, and the Worker owns authorization and persistence.

Use one Git history with npm workspaces at `apps/client` and `apps/api`. Dockerize local client/API development and use Supabase's Docker-based local services. Keep Android SDK, emulator, and device tooling on the host. Add shared packages or infrastructure only when current stories require them.

## Invariants

- Derive identity from verified token claims; never trust client-supplied user IDs.
- Authorize every Party-scoped operation by active membership and validate all API input.
- Keep secrets and local environment values out of source, output, and documentation.
- Email is private. Users have an internal global ID; `memberships.nickname` is the only displayed person-name and is non-unique.
- A user may hold at most three active memberships and own at most one active Party. Create, join, and transfer enforce those limits atomically; leave and deletion free their slots immediately.
- `member_avatars` belong to memberships. Leaving or Party deletion removes their metadata and R2 object.
- Return PostgreSQL `bigint` IDs as strings. Exclude soft-deleted rows explicitly.
- Persist meaningful state only; derive ambient animation state without continuous server writes.

## Workflow

- Planning does not authorize implementation. Follow the next story in the active approved MVP plan and implement one independently verifiable story per request.
- Record story status only in the active MVP plan; do not maintain additional parallel story lists or progress trackers.
- Prefer the smallest working change; do not scaffold deferred features or speculative abstractions.
- Prefer one named happy-path and one failure-path test per behavior; use table rows only for materially distinct branches.
- Add proportionate checks and run relevant typecheck, lint, test, and build commands before completion.
- Record durable decisions in planning documents or ADRs. Never record secrets.
- Keep `AGENTS.md` and future `README.md` files concise, operational, and free of duplicated PRD detail.
- Commit only when asked. Use Conventional Commits without bracketed story, PRD, or task identifiers.
