# Farmies

## Authority and scope

Read `.planning/mvp.md` and `.planning/mvp-data-model.md` before product work; keep their PlantUML diagrams synchronized. Planning artifacts are local and gitignored. Resolve document conflicts before implementing.

Farmies is a private friend-group app. The MVP is one Party of at most 10 members, `COW` + `PASTURE`, responsive web first, and Capacitor Android second. English and Spanish are required. Deferred features include iOS packaging, other species/environments, chat, presence, realtime interactions, public profiles, social login, and monetization.

## Architecture

- Client: Vue 3, TypeScript, Quasar, Pinia, Vue Router, PixiJS, Zod, and Capacitor adapters.
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
- A user has at most one active membership. Party creation, capacity-safe joining, and ownership transfer are atomic.
- `member_avatars` belong to memberships. Leaving or Party deletion removes their metadata and R2 object.
- Return PostgreSQL `bigint` IDs as strings. Exclude soft-deleted rows explicitly.
- Persist meaningful state only; derive ambient animation state without continuous server writes.

## Workflow

- Planning does not authorize implementation. Follow the approved PRD and implement one independently verifiable story per request.
- Prefer the smallest working change; do not scaffold deferred features or speculative abstractions.
- Add proportionate checks and run relevant typecheck, lint, test, and build commands before completion.
- Record durable decisions in planning documents or ADRs. Never record secrets.
- Keep `AGENTS.md` and future `README.md` files concise, operational, and free of duplicated PRD detail.
- Commit only when asked. Use Conventional Commits without bracketed story, PRD, or task identifiers.
