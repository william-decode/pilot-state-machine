/**
 * Pilot State Machine
 * GET /state — check (read) state from the database
 * POST /state — update state in the database
 *
 * Expects table: state_machine_state (key text primary key, value jsonb, updated_at timestamptz default now())
 */

const { Pool } = require('pg');

const STATE_TABLE = 'state_machine_state';

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: { rejectUnauthorized: false },
      max: 1,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on('error', (err) => console.error('Unexpected error on idle client', err));
  }
  return pool;
}

const jsonHeaders = { 'Content-Type': 'application/json' };

function jsonResponse(statusCode, body) {
  return { statusCode, headers: jsonHeaders, body: JSON.stringify(body) };
}

/**
 * GET /state — Check (read) state by key.
 * Query params: key (required)
 */
exports.getState = async (event) => {
  try {
    const key = event.queryStringParameters?.key;
    if (!key || typeof key !== 'string') {
      return jsonResponse(400, { error: 'Query parameter "key" is required' });
    }

    const db = getPool();
    const result = await db.query(
      `SELECT key, value, updated_at FROM ${STATE_TABLE} WHERE key = $1`,
      [key]
    );

    if (result.rows.length === 0) {
      return jsonResponse(404, { error: 'Not found', key });
    }

    const row = result.rows[0];
    return jsonResponse(200, {
      key: row.key,
      value: row.value,
      updated_at: row.updated_at,
    });
  } catch (error) {
    console.error('getState error:', error);
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return jsonResponse(500, { error: 'Database connection failed' });
    }
    if (error.code === '42P01') {
      return jsonResponse(500, { error: 'State table missing. Create state_machine_state (key, value, updated_at).' });
    }
    throw error;
  }
};

/**
 * POST /state — Update state in the database.
 * Body: { key: string, value: any } (value will be stored as JSONB)
 */
exports.updateState = async (event) => {
  try {
    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body || {};
    } catch {
      return jsonResponse(400, { error: 'Request body must be valid JSON' });
    }

    const key = body.key;
    if (!key || typeof key !== 'string') {
      return jsonResponse(400, { error: '"key" is required and must be a string' });
    }

    const value = body.value !== undefined ? body.value : null;

    const db = getPool();
    await db.query(
      `INSERT INTO ${STATE_TABLE} (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
      [key, JSON.stringify(value)]
    );

    return jsonResponse(200, { ok: true, key, value });
  } catch (error) {
    console.error('updateState error:', error);
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return jsonResponse(500, { error: 'Database connection failed' });
    }
    if (error.code === '42P01') {
      return jsonResponse(500, { error: 'State table missing. Create state_machine_state (key, value, updated_at).' });
    }
    throw error;
  }
};
