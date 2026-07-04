# Ajaba Server — Backend for Ajaba Smart Shelf

## Quick Start

```bash
npm install
npm run db:migrate   # Create tables
npm run db:seed      # Seed IGA Valley + Boondall + owner user
npm run dev          # Start on http://localhost:8787
```

## Architecture

- **Runtime**: Node.js 22+ with Express 5 + TypeScript
- **Database**: SQLite via `better-sqlite3` (WAL mode)
- **Auth**: JWT with 4-digit PIN (bcrypt hashed)
- **Port**: 8787

## Project Structure

```
src/
├── server.ts          # Express app entry
├── db/
│   ├── connection.ts  # SQLite connection (WAL, foreign keys)
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

- File: `data/ajaba.db`
- Mode: WAL (concurrent reads, single writer)
- Foreign keys: enforced

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/health | No | Health check |
| POST | /api/auth/login | No | Login (username + PIN) |
| GET | /api/auth/me | JWT | Current user info |
