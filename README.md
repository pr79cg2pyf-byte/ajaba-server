# Ajaba Server — Backend for Ajaba Smart Shelf

## Quick Start

```bash
npm install
npm run db:migrate   # Create tables
npm run db:seed      # Seed IGA Valley + Boondall + owner user
npm run dev          # Start on http://localhost:3020 (override with PORT)
```

## Architecture

- **Runtime**: Node.js 22+ with Express 4 + TypeScript
- **Database**: SQLite via `sql.js` with durable file snapshots
- **Auth**: JWT with 4-digit PIN (bcrypt hashed)
- **Port**: 3020 (the separate vision helper uses 8787)

## Project Structure

```
src/
├── server.ts          # Express app entry
├── db/
│   ├── connection.ts  # sql.js connection, atomic snapshots, foreign keys
│   ├── migrate.ts     # Schema creation
│   └── seed.ts        # Initial data
├── routes/
│   └── auth.ts        # POST /api/auth/login, GET /api/auth/me
├── middleware/
│   └── auth.ts        # JWT verification middleware
└── types/
    └── index.ts       # Shared TypeScript types
```

## Database

- File: `data/ajaba.db`, overridable with `AJABA_DB_PATH`
- One server process owns the in-memory database and writes atomic snapshots.
- Expiry records and linked claims use a transaction with rollback if disk persistence fails.
- Foreign keys: enforced
- `npm test` creates fresh temporary databases and chooses an unused loopback port.
  `NODE_ENV=test` refuses the default database unless `AJABA_DB_PATH` is explicit.
- `AJABA_DISABLE_SCHEDULER=1` disables scheduled task creation for isolated previews.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/health | No | Health check |
| POST | /api/auth/login | No | Login (username + PIN) |
| GET | /api/auth/me | JWT | Current user info |
| GET | /api/expiry-records | JWT + active store | Current store's durable expiry records |
| PUT | /api/expiry-records/:id | JWT + active store | Save with `record`, `expectedVersion`, `mutationId`; stale writes return 409 with the server record |
