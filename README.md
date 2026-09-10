# Farmies

Private shared farms for real-life friend groups.

## Local development

Requirements: Docker with Compose and Node.js 24. Android builds additionally require a host Android SDK.

```sh
docker compose up --build
```

- Client: <http://localhost:9000>
- API health: <http://localhost:8787/health>

Run checks in the project image:

```sh
docker compose run --rm api npm run check
```

Local authentication uses the Supabase CLI, which starts Supabase Auth, PostgreSQL, and Mailpit in Docker:

```sh
npm run supabase:start
npm run db:reset
npm run db:test
npm run supabase:stop
```

- Studio: <http://localhost:54323>
- Mailpit: <http://localhost:54324>

Keep Android emulator and device commands on the host.
