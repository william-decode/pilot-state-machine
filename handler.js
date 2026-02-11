/**
 * Pilot State Machine
 * GET /state — check (read) state from the database
 * POST /state — update state in the database
 *
 * Expects table: state_machine_state (key text primary key, value jsonb, updated_at timestamptz default now())
 */

const { Pool } = require('pg');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const STATE_TABLE = 'state_machine_state';

let pool = null;
const snsClient = new SNSClient({});

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

const TABLES = { actions: 'actions', users: 'users', reports: 'reports', kits: 'kits', consents: 'consents' };
const SAFE_COLUMN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function parseJsonBody(event) {
  try {
    return typeof event.body === 'string' ? JSON.parse(event.body) : event.body || {};
  } catch {
    return null;
  }
}

function getByKitId(tableName, responseKey) {
  return async (event) => {
    try {
      const body = parseJsonBody(event);
      if (body === null) return jsonResponse(400, { error: 'Request body must be valid JSON' });

      const kitId = body.kit_id;
      if (!kitId || typeof kitId !== 'string') {
        return jsonResponse(400, { error: '"kit_id" is required and must be a string' });
      }

      const db = getPool();
      const result = await db.query(
        `SELECT * FROM ${tableName} WHERE kit_id = $1`,
        [kitId]
      );

      return jsonResponse(200, { kit_id: kitId, [responseKey]: result.rows });
    } catch (error) {
      console.error(`get${responseKey} error:`, error);
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        return jsonResponse(500, { error: 'Database connection failed' });
      }
      if (error.code === '42P01') {
        return jsonResponse(500, { error: `Table "${tableName}" not found.` });
      }
      throw error;
    }
  };
}

exports.getActionsByKitId = getByKitId(TABLES.actions, 'actions');
exports.getUsersByKitId = getByKitId(TABLES.users, 'users');
exports.getReportsByKitId = getByKitId(TABLES.reports, 'reports');
exports.getKitsByKitId = getByKitId(TABLES.kits, 'kits');
exports.getConsentsByKitId = getByKitId(TABLES.consents, 'consents');

/**
 * POST /users/by-email — Look up users by email (case-insensitive).
 * Body: { email: string }
 */
exports.getUsersByEmail = async (event) => {
  try {
    const body = parseJsonBody(event);
    if (body === null) return jsonResponse(400, { error: 'Request body must be valid JSON' });
    const email = body.email;
    if (!email || typeof email !== 'string') {
      return jsonResponse(400, { error: '"email" is required and must be a string' });
    }
    const db = getPool();
    const result = await db.query(
      `SELECT * FROM ${TABLES.users} WHERE LOWER(email) = LOWER($1)`,
      [email.trim()]
    );
    return jsonResponse(200, { email: email.trim(), users: result.rows });
  } catch (error) {
    console.error('getUsersByEmail error:', error);
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return jsonResponse(500, { error: 'Database connection failed' });
    }
    if (error.code === '42P01') {
      return jsonResponse(500, { error: 'Table "users" not found.' });
    }
    throw error;
  }
};

/**
 * POST /users/create — Create a user with kit_id, email, is_test, first_name.
 * Body: { kit_id: string, email: string, is_test: boolean }
 * first_name is set to 'test_user' for test users.
 * Returns 201 with user row, or 409 if kit_id already exists (caller should retry with new kit_id).
 */
exports.createUser = async (event) => {
  try {
    const body = parseJsonBody(event);
    if (body === null) return jsonResponse(400, { error: 'Request body must be valid JSON' });
    const kitId = body.kit_id;
    const email = body.email;
    const isTest = body.is_test === true;
    if (!kitId || typeof kitId !== 'string') {
      return jsonResponse(400, { error: '"kit_id" is required and must be a string' });
    }
    if (!email || typeof email !== 'string') {
      return jsonResponse(400, { error: '"email" is required and must be a string' });
    }
    const db = getPool();
    const result = await db.query(
      `INSERT INTO ${TABLES.users} (kit_id, email, is_test, first_name) VALUES ($1, $2, $3, 'test_user') RETURNING *`,
      [kitId, email.trim(), isTest]
    );
    if (result.rows.length === 0) return jsonResponse(500, { error: 'Insert failed' });
    return jsonResponse(201, { ok: true, user: result.rows[0] });
  } catch (error) {
    console.error('createUser error:', error);
    if (error.code === '23505') {
      return jsonResponse(409, { error: 'kit_id already exists', conflict: 'kit_id' });
    }
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return jsonResponse(500, { error: 'Database connection failed' });
    }
    if (error.code === '42P01') {
      return jsonResponse(500, { error: 'Table "users" not found.' });
    }
    throw error;
  }
};

/**
 * Build UPDATE table SET col1=$2, col2=$3 ... WHERE kit_id=$1 from body.
 * Only keys matching SAFE_COLUMN are used; kit_id is required and used in WHERE.
 */
function updateByKitId(tableName) {
  return async (event) => {
    try {
      const body = parseJsonBody(event);
      if (body === null) return jsonResponse(400, { error: 'Request body must be valid JSON' });

      const kitId = body.kit_id;
      if (!kitId || typeof kitId !== 'string') {
        return jsonResponse(400, { error: '"kit_id" is required and must be a string' });
      }

      const updates = { ...body };
      delete updates.kit_id;
      const columns = Object.keys(updates).filter((k) => SAFE_COLUMN.test(k));
      if (columns.length === 0) {
        return jsonResponse(400, { error: 'Send at least one field to update (e.g. status, score). Column names must be alphanumeric + underscore.' });
      }

      const invalidValues = columns.filter((c) => updates[c] === undefined || Number.isNaN(updates[c]));
      if (invalidValues.length > 0) {
        return jsonResponse(400, { error: `Invalid values for fields: ${invalidValues.join(', ')}. Use null to clear a field.` });
      }

      const setClause = columns.map((c, i) => `${c} = $${i + 2}`).join(', ');
      const params = [kitId, ...columns.map((c) => updates[c])];
      const db = getPool();
      let result = await db.query(
        `UPDATE ${tableName} SET ${setClause} WHERE kit_id = $1`,
        params
      );

      let created = false;
      if (result.rowCount === 0) {
        const insertCols = ['kit_id', ...columns].join(', ');
        const insertPlaces = columns.map((_, i) => `$${i + 2}`).join(', ');
        result = await db.query(
          `INSERT INTO ${tableName} (${insertCols}) VALUES ($1, ${insertPlaces})`,
          params
        );
        created = true;
      }

      return jsonResponse(200, { ok: true, kit_id: kitId, updated: result.rowCount, created });
    } catch (error) {
      console.error(`update${tableName} error:`, error);
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        return jsonResponse(500, { error: 'Database connection failed' });
      }
      if (error.code === '22P02' || error.code === '42804' || error.code === '23502') {
        return jsonResponse(400, { error: 'Invalid field type or value for update.' });
      }
      if (error.code === '42P01') {
        return jsonResponse(500, { error: `Table "${tableName}" not found.` });
      }
      throw error;
    }
  };
}

const topicArn = () => process.env.ROUTER_TOPIC_ARN;

async function maybeSendPdfEmail(db, kitId, link) {
  const topic = topicArn();
  if (!topic) {
    console.log('maybeSendPdfEmail skipped', { kitId, reason: 'ROUTER_TOPIC_ARN not set' });
    return;
  }
  const userResult = await db.query(
    'SELECT kit_id, email, first_name FROM users WHERE kit_id = $1 LIMIT 1',
    [kitId]
  );
  if (userResult.rows.length === 0) {
    console.log('maybeSendPdfEmail skipped', { kitId, reason: 'no user' });
    return;
  }
  const user = userResult.rows[0];
  const consentResult = await db.query(
    'SELECT toc_agreed FROM consents WHERE kit_id = $1 LIMIT 1',
    [kitId]
  );
  if (consentResult.rows.length === 0) {
    console.log('maybeSendPdfEmail skipped', { kitId, reason: 'no consent' });
    return;
  }
  if (!consentResult.rows[0].toc_agreed) {
    console.log('maybeSendPdfEmail skipped', { kitId, reason: 'toc_agreed false' });
    return;
  }
  const actionResult = await db.query(
    'SELECT appointment_made, pdf_email_sent FROM actions WHERE kit_id = $1 LIMIT 1',
    [kitId]
  );
  if (actionResult.rows.length === 0) {
    console.log('maybeSendPdfEmail skipped', { kitId, reason: 'no action row' });
    return;
  }
  const action = actionResult.rows[0];
  if (!action.appointment_made) {
    console.log('maybeSendPdfEmail skipped', { kitId, reason: 'appointment_made false' });
    return;
  }
  if (action.pdf_email_sent) {
    console.log('maybeSendPdfEmail skipped', { kitId, reason: 'pdf_email_sent already true' });
    return;
  }
  const firstName = user.first_name || '';
  const email = user.email || '';
  console.log('maybeSendPdfEmail running', { kitId, email });
  try {
    await snsClient.send(new PublishCommand({
      TopicArn: topic,
      Message: JSON.stringify({
        message_type: 'send_pdf_email',
        kit_id: kitId,
        firstName,
        email,
        link: link || undefined,
      }),
    }));
    console.log('maybeSendPdfEmail sent', { kitId });
  } catch (err) {
    console.error('maybeSendPdfEmail failed', { kitId, error: err.message });
  }
}

exports.updateActions = async (event) => {
  const result = await updateByKitId(TABLES.actions)(event);
  if (result.statusCode !== 200) return result;
  const body = parseJsonBody(event);
  if (body?.appointment_made && body?.kit_id) {
    const db = getPool();
    await maybeSendPdfEmail(db, body.kit_id);
  }
  return result;
};
exports.updateUsers = updateByKitId(TABLES.users);
exports.updateConsents = async (event) => {
  const result = await updateByKitId(TABLES.consents)(event);
  if (result.statusCode !== 200) return result;
  const body = parseJsonBody(event);
  if (body?.toc_agreed && body?.kit_id) {
    const db = getPool();
    await maybeSendPdfEmail(db, body.kit_id);
  }
  return result;
};
exports.updateReports = updateByKitId(TABLES.reports);
exports.updateKits = updateByKitId(TABLES.kits);

/**
 * POST /webhooks/actions — Incoming webhook: update actions table by kit_id.
 * Body: { kit_id: string, ...fields to set on actions }
 * Same shape as POST /actions/update; use this URL for external webhook callers.
 */
exports.webhookActions = async (event) => {
  const always200 = (body) => ({ statusCode: 200, headers: jsonHeaders, body: JSON.stringify(body) });
  try {
    console.log('webhookActions invoked', { rawPath: event.rawPath, path: event.path, method: event.requestContext?.http?.method });
    const body = parseJsonBody(event);
    if (body === null) return always200({ ok: false, error: 'Request body must be valid JSON' });

    console.log('Webhook payload received', {
      path: event.rawPath || event.path,
      headers: event.headers || {},
      body,
    });

    const isInviteeCreated = String(body.event || '').toLowerCase() === 'invitee.created';
    if (isInviteeCreated) {
    try {
      console.log('Calendly invitee.created payload', JSON.stringify(body.payload, null, 2));

      const email = body.payload?.email;
      if (!email || typeof email !== 'string') {
        return always200({ ok: false, error: 'invitee.created payload missing email' });
      }

      const db = getPool();
      const userResult = await db.query(
        'SELECT kit_id, first_name FROM users WHERE lower(email) = lower($1) LIMIT 1',
        [email.trim().toLowerCase()]
      );

      if (userResult.rows.length === 0 || !userResult.rows[0].kit_id) {
        console.error('Calendly webhook: user not found for email', { email });
        return always200({
          ok: false,
          error: 'No user found for this email',
          email,
          event: body.event,
        });
      }

      const kitId = userResult.rows[0].kit_id;
      const firstName = userResult.rows[0].first_name || body.payload?.first_name || body.payload?.name || '';
      const link = body.payload?.reschedule_url || body.payload?.cancel_url || '';
      let actionResult = await db.query(
        'UPDATE actions SET appointment_made = true WHERE kit_id = $1',
        [kitId]
      );

      let created = false;
      if (actionResult.rowCount === 0) {
        actionResult = await db.query(
          'INSERT INTO actions (kit_id, appointment_made) VALUES ($1, true) RETURNING kit_id',
          [kitId]
        );
        created = true;
      }

      console.log('📅 Calendly invitee.created processed', { email, kitId });

      const guests = Array.isArray(body.payload?.scheduled_event?.event_guests)
        ? body.payload.scheduled_event.event_guests
        : [];
      const touchedKitIds = [kitId];
      for (const guest of guests) {
        const guestEmail = guest?.email;
        if (!guestEmail || typeof guestEmail !== 'string') continue;
        const guestUserResult = await db.query(
          'SELECT kit_id FROM users WHERE lower(email) = lower($1) LIMIT 1',
          [guestEmail.trim().toLowerCase()]
        );
        if (guestUserResult.rows.length === 0 || !guestUserResult.rows[0].kit_id) continue;
        const guestKitId = guestUserResult.rows[0].kit_id;
        touchedKitIds.push(guestKitId);
        let guestActionResult = await db.query(
          'UPDATE actions SET appointment_made = true WHERE kit_id = $1',
          [guestKitId]
        );
        if (guestActionResult.rowCount === 0) {
          await db.query(
            'INSERT INTO actions (kit_id, appointment_made) VALUES ($1, true)',
            [guestKitId]
          );
        }
      }

      for (const kid of touchedKitIds) {
        await maybeSendPdfEmail(db, kid, kid === kitId ? link : undefined);
      }

      const topicArn = process.env.ROUTER_TOPIC_ARN;
      console.log('SNS publish attempt', { topicArn: topicArn || '(not set)', kitId });
      if (topicArn) {
        try {
          await snsClient.send(new PublishCommand({
            TopicArn: topicArn,
            Message: JSON.stringify({
              message_type: 'appointment_made',
              kit_id: kitId,
              firstName,
              email,
              link: link || undefined,
            }),
          }));
          console.log('📣 Appointment SNS message sent', { kitId, topicArn });
        } catch (snsError) {
          const errMsg = snsError.message || String(snsError);
          const errCode = snsError.Code || snsError.name || snsError.code;
          console.error('Failed to publish appointment SNS message', {
            kitId,
            topicArn,
            error: errMsg,
            code: errCode,
          });
        }
      } else {
        console.log('ROUTER_TOPIC_ARN not set; skipping appointment SNS publish');
      }

      return always200({
        ok: true,
        event: body.event,
        email,
        kit_id: kitId,
        appointment_made: true,
        updated: actionResult.rowCount,
        created_when_missing: created,
      });
    } catch (error) {
      console.error('webhookActions invitee.created error:', error);
      const message = error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND'
        ? 'Database connection failed'
        : (error.message || String(error));
      return always200({ ok: false, error: message, code: error.code });
    }
  }

    // Default behavior: treat webhook as a generic actions update payload — still always 200
    const result = await exports.updateActions(event);
    const payload = result.body ? JSON.parse(result.body) : { ok: false, error: 'No response body' };
    return always200(result.statusCode === 200 ? payload : { ...payload, ok: false });
  } catch (error) {
    console.error('webhookActions error', error);
    return always200({
      ok: false,
      error: error && (error.message || String(error)),
      code: error && error.code,
    });
  }
};
