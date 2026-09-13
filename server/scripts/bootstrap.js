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

/**
 * Seed demo data when SEED_DEMO=true and the platform has no partners yet.
 *
 * Guarded on emptiness so a redeploy can never wipe real data: the seed script
 * truncates tables, which would be catastrophic against a live database.
 */
async function seedDemoIfEmpty() {
  if (String(process.env.SEED_DEMO || '').toLowerCase() !== 'true') return;

  const existing = await queryOne('SELECT COUNT(*) AS n FROM partners');
  if (Number(existing?.n || 0) > 0) {
    console.log('  SEED_DEMO is set but partners already exist — refusing to overwrite.');
    return;
  }

  console.log('  Seeding demo data...');
  const { execFileSync } = await import('node:child_process');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  try {
    execFileSync(process.execPath, [path.join(here, 'seed.js')], { stdio: 'inherit' });
    // Brand images are a separate step so they can be refreshed on their own.
    execFileSync(process.execPath, [path.join(here, 'seed-images.js')], { stdio: 'inherit' });
  } catch (err) {
    console.error('  Demo seed failed:', err.message);
  }
}

/**
 * Add site-content entries introduced after a deployment was first seeded.
 *
 * The seed only populates an empty database and the admin editor updates rows
 * rather than creating them, so a key added later would never appear in the
 * dashboard. Inserting the missing ones on boot keeps every environment in
 * step without hand-written SQL. Existing values are never touched.
 */
const LATER_CMS_KEYS = [
  ['hero_image_url', '', 'Hero image URL — leave empty to show a placeholder', 5],
  [
    'hero_image_alt',
    'A Tanzanian guide sharing his referral QR code with two travellers below Mount Kilimanjaro',
    'Hero image description — read aloud by screen readers',
    6,
  ],
];

async function addMissingContentKeys() {
  let added = 0;
  for (const [key, value, label, sort] of LATER_CMS_KEYS) {
    const existing = await queryOne('SELECT content_key FROM cms_content WHERE content_key = ?', [
      key,
    ]);
    if (existing) continue;
    await execute(
      `INSERT INTO cms_content (content_key, content_value, value_type, group_name, label, sort_order)
       VALUES (?, ?, 'text', 'landing', ?, ?)`,
      [key, value, label, sort],
    );
    added += 1;
  }
  if (added) console.log(`  Added ${added} new site content ${added === 1 ? 'entry' : 'entries'}.`);
}

async function main() {
  await seedDemoIfEmpty();
  await addMissingContentKeys();

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
