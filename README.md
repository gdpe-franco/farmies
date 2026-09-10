# Farmies

Private shared farms for real-life friend groups.

## Local development

Requirements: Docker with Compose. Android builds additionally require a host Android SDK.

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
supabase start
```

The Supabase project configuration is added in US-001B. Keep Android emulator and device commands on the host.
