# Pilot State Machine

API that accepts incoming GET/POST requests to **check** or **update** state stored in the database. Database and VPC connection details are in `config/config.js`.

## Endpoints

| Method | Path   | Purpose |
|--------|--------|--------|
| GET    | /state | Check (read) state by `key` query param |
| POST   | /state | Update state; body `{ "key": "...", "value": ... }` |

## Database

Create the state table in your PostgreSQL database (same one referenced in `config/config.js`):

```sql
CREATE TABLE IF NOT EXISTS state_machine_state (
  key         text primary key,
  value       jsonb,
  updated_at  timestamptz default now()
);
```

## Deploy

```bash
npm install
npx serverless deploy --stage dev
```

## Examples

**Check state (GET)**  
`GET /state?key=my-key`  
→ Returns `{ "key": "my-key", "value": ..., "updated_at": "..." }` or 404.

**Update state (POST)**  
`POST /state` with body:  
`{ "key": "my-key", "value": { "status": "active", "count": 1 } }`  
→ Returns `{ "ok": true, "key": "my-key", "value": { ... } }`.
