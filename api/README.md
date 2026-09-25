# Nido API Service

Backend service for the Nido app built with TypeScript and Hono.

## Getting Started

### Prerequisites
- Node.js 18+

### Installation
```bash
cd api
npm install
```

### Environment Variables
There is no external database to provision — each family gets its own encrypted
SQLite file. Create a `.env` file in the repository root:
```env
# Keys every per-family database (HKDF-SHA256). Generate with: openssl rand -hex 32
# Unset in development only: the API logs a loud warning and falls back to a
# hardcoded key that is public in this repo.
NIDO_MASTER_KEY=""
# Where registry.db, db/<familyId>.db and photos/ live
NIDO_DATA_DIR="./data"
JWT_SECRET="your-super-secret-jwt-key"
```

### Running Locally
```bash
# Development mode with hot reload
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

### Database Initialization
```bash
npm run db:init
```

## API Endpoints

All routes are mounted under `/api/v1`. The numeric parameters (`:id`,
`:memberId`, `:babyId`, …) are constrained to digits by a Hono regex
(`:id{[0-9]+}`); they are written as `:id` below for readability.

Most read/write routes accept a `?babyId=` query parameter, except where a
`babyId` appears in the path.

### Auth
- `POST /api/v1/auth/register` — create an account
- `POST /api/v1/auth/login` — exchange credentials for a JWT
- `GET /api/v1/auth/verify` — verify a token/registration link
- `GET /api/v1/auth/verify-email` — confirm an email address
- `POST /api/v1/auth/forgot-password` — start a password reset (does not reveal
  whether the address exists)
- `POST /api/v1/auth/reset-password` — complete a password reset

### Users
- `GET /api/v1/users/me` — current user
- `PUT /api/v1/users/me` — update profile
- `POST /api/v1/users/me/password` — change password

### Families
- `POST /api/v1/families` — create a family (optionally with a first member)
- `GET /api/v1/families` — list the caller's families
- `GET /api/v1/families/members` — list members
- `POST /api/v1/families/members` — add a member (rejects a duplicate name +
  birth date)
- `PUT /api/v1/families/members/:memberId` — update a member
- `DELETE /api/v1/families/members/:memberId` — delete a member (cascades to
  records, photos, avatar, reminders)
- `GET /api/v1/families/members/:memberId/avatar` — fetch a member's avatar
- `POST /api/v1/families/members/:memberId/avatar` — upload a member's avatar
- `GET /api/v1/families/invitations` — list pending invitations
- `POST /api/v1/families/invitations` — invite someone by email
- `DELETE /api/v1/families/invitations/:inviteId` — revoke an invitation
- `POST /api/v1/families/join` — accept an invitation
- `GET /api/v1/families/settings` — family settings
- `PUT /api/v1/families/settings` — update family settings
- `GET /api/v1/families/export` — export the family's data (owner/admin)
- `POST /api/v1/families/restore` — restore exported data
- `DELETE /api/v1/families/` — delete the family (owner only)

The same handlers are also registered under a legacy `/:familyRef/...` alias
(e.g. `GET /api/v1/families/{familyRef}/members`), which resolves the family
from the path instead of the JWT. Prefer the flat form.

### Babies
- `GET /api/v1/babies` — list
- `GET /api/v1/babies/:id` — fetch one
- `POST /api/v1/babies` — create
- `PUT /api/v1/babies/:id` — update

> **Note:** there is no baby DELETE route. Deletion is handled through
> `DELETE /api/v1/families/members/:memberId`, which also cascades to the
> member's records, photos, avatar and reminders.

### Feeding, diaper, and sleep records
Each of these exposes the same five routes:

- `GET /api/v1/{feedings|diapers|sleep}` — list
- `GET /api/v1/{feedings|diapers|sleep}/:id` — fetch one
- `POST /api/v1/{feedings|diapers|sleep}` — create
- `PUT /api/v1/{feedings|diapers|sleep}/:id` — update
- `DELETE /api/v1/{feedings|diapers|sleep}/:id` — delete

### Growth
- `GET /api/v1/growth` — list
- `GET /api/v1/growth/:id` — fetch one
- `POST /api/v1/growth` — create
- `PUT /api/v1/growth/:id` — update
- `DELETE /api/v1/growth/:id` — delete
- `GET /api/v1/growth/:id/chart-data` — percentiles for charting

### Milestones
- `GET /api/v1/milestones` — list
- `GET /api/v1/milestones/categories` — category options
- `GET /api/v1/milestones/:id` — fetch one
- `POST /api/v1/milestones` — create
- `PUT /api/v1/milestones/:id` — update
- `DELETE /api/v1/milestones/:id` — delete

### Vaccinations
- `GET /api/v1/vaccinations` — list
- `GET /api/v1/vaccinations/schedule` — recommended schedule
- `GET /api/v1/vaccinations/:id` — fetch one
- `POST /api/v1/vaccinations` — create
- `PUT /api/v1/vaccinations/:id` — update
- `DELETE /api/v1/vaccinations/:id` — delete

### Journal and moods
Each exposes `GET /`, `POST /`, `PUT /:id`, `DELETE /:id`:

- `/api/v1/journal`
- `/api/v1/moods`

### Reminders
- `GET /api/v1/reminders` — list
- `POST /api/v1/reminders` — create
- `PUT /api/v1/reminders/:id` — update
- `DELETE /api/v1/reminders/:id` — delete
- `POST /api/v1/reminders/:id/done` — mark done / snooze

### Formulas
- `GET /api/v1/formulas` — list
- `POST /api/v1/formulas` — create
- `PUT /api/v1/formulas/:id` — update
- `DELETE /api/v1/formulas/:id` — delete

### Photos
- `GET /api/v1/photos` — list
- `POST /api/v1/photos` — upload
- `GET /api/v1/photos/:id/file` — stream the file
- `DELETE /api/v1/photos/:id` — delete

### Settings
- `GET /api/v1/settings` — instance settings
- `PUT /api/v1/settings` — update
- `POST /api/v1/settings/test` — send a test email (SMTP check)

### Health
- `GET /api/v1/health/summary/:babyId` — comprehensive summary
- `GET /api/v1/health/insights/:babyId` — trends and analytics

### Imports
- `POST /api/v1/imports/narababy` — import a Narababy export
- `GET /api/v1/imports/runs` — import history
- `GET /api/v1/imports/summary` — what an import would change
- `POST /api/v1/imports/runs/:runId/undo` — roll back a run

### Service
These two are **not** under `/api/v1`:

- `GET /health` — liveness. Used by the Compose healthcheck.
- `GET /ready` — readiness.
- `GET /` — service banner (name, version)

## Tech Stack
- TypeScript
- Hono
- SQLCipher-encrypted SQLite (`better-sqlite3-multiple-ciphers`), one file per family
- JWT Authentication
- Zod for validation

## Testing
```bash
npm test
```

## License
Apache-2.0