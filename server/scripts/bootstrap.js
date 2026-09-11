/**
 * First-run bootstrap.
 *
 * Creates the initial super admin from environment variables so a hosted
 * deployment needs no shell access and no hand-written SQL.
 *
 *   ADMIN_EMAIL=you@pazo.co.tz ADMIN_PASSWORD=... node scripts/bootstrap.js
 *
 * Safe to run on every boot: it does nothing if the account already exists.
 */
import { execute, queryOne } from '../src/db/pool.js';
import { avatarColorFor, hashPassword, uuid } from '../src/utils/crypto.js';
import { isEmail, passwordProblem } from '../src/utils/format.js';

async function main() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  const name = process.env.ADMIN_NAME || 'Pazo Admin';

  if (!email || !password) {
    console.log('  No ADMIN_EMAIL/ADMIN_PASSWORD set — skipping admin bootstrap.');
    return;
  }
  if (!isEmail(email)) {
    console.error('  ADMIN_EMAIL is not a valid email address. Skipping.');
    return;
  }
  const problem = passwordProblem(password);
  if (problem) {
    console.error(`  ADMIN_PASSWORD rejected: ${problem}. Skipping.`);
    return;
  }

  const existing = await queryOne('SELECT id, role FROM users WHERE email = ? LIMIT 1', [email]);
  if (existing) {
    console.log(`  Admin ${email} already exists — nothing to do.`);
    return;
  }

  const id = uuid();
  await execute(
    `INSERT INTO users
       (id, email, password_hash, role, status, name, avatar_color, email_verified)
     VALUES (?, ?, ?, 'super_admin', 'active', ?, ?, 1)`,
    [id, email, await hashPassword(password), name, avatarColorFor(id)],
  );

  console.log(`  Created super admin ${email}. Sign in and change the password.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // A bootstrap failure must never stop the app from starting.
    console.error('  Admin bootstrap failed:', err.message);
    process.exit(0);
  });
