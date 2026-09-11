import mysql from 'mysql2/promise';
import env from '../config/env.js';

export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: env.db.connectionLimit,
  queueLimit: 0,
  dateStrings: false,
  timezone: 'Z',
  charset: 'utf8mb4_unicode_ci',
  supportBigNumbers: true,
  bigNumberStrings: false,
  namedPlaceholders: false,
});

/**
 * Pin every connection to UTC.
 *
 * Without this the database server's local zone applies, so a column that
 * defaults to CURRENT_TIMESTAMP stores local time while the application writes
 * UTC. On a machine at UTC+3 that is a three-hour disagreement: scheduled
 * retries fire late, "today" filters cover the wrong window, and timestamps
 * drift against each other. Setting it per connection makes NOW(),
 * CURRENT_TIMESTAMP and UTC_TIMESTAMP() all agree with what the app writes.
 */
pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'", (err) => {
    if (err) console.error('[pazo:db] could not set connection time zone:', err.message);
  });
});

/** Run a query and return the rows. */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** Run a query and return the first row, or null. */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

/** Run a non-select statement and return the result header. */
export async function execute(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

/**
 * Run a function inside a transaction. The callback receives a connection with
 * the same helpers (q/one/exec) bound to it. Rolls back on any thrown error.
 */
export async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const tx = {
      conn,
      async q(sql, params = []) {
        const [rows] = await conn.execute(sql, params);
        return rows;
      },
      async one(sql, params = []) {
        const [rows] = await conn.execute(sql, params);
        return rows.length ? rows[0] : null;
      },
      async exec(sql, params = []) {
        const [result] = await conn.execute(sql, params);
        return result;
      },
    };
    const out = await fn(tx);
    await conn.commit();
    return out;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* connection already gone */
    }
    throw err;
  } finally {
    conn.release();
  }
}

export async function healthcheck() {
  const row = await queryOne('SELECT 1 AS ok');
  return row?.ok === 1;
}

export default pool;
