# Scripts

Utility scripts for the Nido project.

## Available Scripts

- `init-env.sh` — generates `.env` with random `NIDO_MASTER_KEY` and
  `JWT_SECRET`. Required before `docker compose up`; refuses to overwrite an
  existing `.env`.

There is also `api/scripts/init-db.ts`, run via `npm run db:init`, which
creates the registry database.
