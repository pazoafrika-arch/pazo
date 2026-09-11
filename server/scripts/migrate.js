/**
 * Creates the database if needed, then applies every SQL file in ../migrations
 * in filename order. Applied files are recorded so re-running is safe.
 *
 *   npm run migrate
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import env from '../src/config/env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../migrations');

/**
 * Split a migration file into individual statements.
 * Comment lines are stripped first, then the file is split on semicolons that
 * sit outside quoted strings, so a `;` inside a default value is never treated
 * as a statement boundary.
 */
function splitStatements(sql) {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');

  const statements = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < withoutComments.length; i += 1) {
    const ch = withoutComments[i];
    if (quote) {
      current += ch;
      if (ch === quote && withoutComments[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function main() {
  console.log(`\n  Connecting to MySQL at ${env.db.host}:${env.db.port} as ${env.db.user}`);

  // On a managed platform the database already exists and the supplied user
  // has no rights to create one. Attempt it, but treat a refusal as fine.
  try {
    const root = await mysql.createConnection({
      host: env.db.host,
      port: env.db.port,
      user: env.db.user,
      password: env.db.password,
      multipleStatements: true,
    });
    await root.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    console.log(`  Database "${env.db.database}" ready`);
    await root.end();
  } catch (err) {
    if (err.code === 'ER_DBACCESS_DENIED_ERROR' || err.code === 'ER_SPECIFIC_ACCESS_DENIED_ERROR') {
      console.log(`  Using the existing database "${env.db.database}"`);
    } else {
      throw err;
    }
  }

  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    multipleStatements: true,
  });

  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [applied] = await conn.query('SELECT filename FROM schema_migrations');
  const done = new Set(applied.map((r) => r.filename));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let ran = 0;
  for (const file of files) {
    if (done.has(file)) {
      console.log(`  - ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    process.stdout.write(`  + ${file} ... `);
    for (const statement of splitStatements(sql)) {
      await conn.query(statement);
    }
    await conn.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
    console.log('done');
    ran += 1;
  }

  await conn.end();
  console.log(
    ran ? `\n  Applied ${ran} migration${ran === 1 ? '' : 's'}.\n` : '\n  Schema already up to date.\n',
  );
}

main().catch((err) => {
  console.error('\n  Migration failed:', err.message);
  if (err.code === 'ECONNREFUSED') {
    console.error('  Is MySQL running? With XAMPP, start MySQL from the control panel.\n');
  }
  process.exit(1);
});
