# Pilot State Machine

API that accepts incoming GET/POST requests to **check** or **update** state stored in the database. Database and VPC connection details are in `config/config.js`.

## Endpoints

### Key-value state
| Method | Path   | Purpose |
|--------|--------|--------|
| GET    | /state | Check (read) state by `key` query param |
| POST   | /state | Update state; body `{ "key": "...", "value": ... }` |

### Tables (actions, users, reports, kits, consents)
| Method | Path              | Purpose |
|--------|-------------------|--------|
| POST   | /actions          | Get all columns by `kit_id`; body `{ "kit_id": "..." }` |
| POST   | /users            | Same, for users table |
| POST   | /reports          | Same, for reports table |
| POST   | /kits             | Same, for kits table |
| POST   | /consents         | Same, for consents table |
| POST   | /actions/update   | Update rows by `kit_id`; body `{ "kit_id": "...", "field1": value1, ... }` |
| POST   | /users/update     | Same for users |
| POST   | /reports/update   | Same for reports |
| POST   | /kits/update      | Same for kits |
| POST   | /consents/update  | Same for consents |
| POST   | /webhooks/actions | Webhook: same body as `/actions/update`; use this URL for external callers |

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

**Get table rows by kit_id**  
`POST /actions` with body `{ "kit_id": "abc-123" }`  
→ Returns `{ "kit_id": "abc-123", "actions": [ { ...row } ] }`. Same for `/users`, `/reports`, `/kits`, `/consents`.

**Update specific fields**  
`POST /actions/update` with body `{ "kit_id": "abc-123", "status": "completed", "score": 95 }`  
→ Updates all rows in `actions` where `kit_id = 'abc-123'`, setting `status` and `score`. Returns `{ "ok": true, "kit_id": "abc-123", "updated": N }`.  
Field names must be valid column names (letters, numbers, underscore). Same pattern for `/users/update`, etc.

**Webhook**  
`POST /webhooks/actions` — Same body as `/actions/update`. Point external webhooks here to update the actions table.
