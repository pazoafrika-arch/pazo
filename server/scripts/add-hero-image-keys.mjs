/**
 * Adds the landing hero image entries to the CMS.
 *
 * The seed only populates an empty database, and the admin content editor
 * updates existing rows rather than creating them, so an installation that
 * predates the hero image needs these two rows inserted once.
 *
 *   node scripts/add-hero-image-keys.mjs
 */
import { query, execute } from '../src/db/pool.js';

const ROWS = [
  ['hero_image_url', '', 'Hero image URL — leave empty to show a placeholder', 5],
  [
    'hero_image_alt',
    'A Tanzanian guide sharing his referral QR code with two travellers below Mount Kilimanjaro',
    'Hero image description — read aloud by screen readers',
    6,
  ],
];

for (const [key, value, label, sort] of ROWS) {
  const existing = await query('SELECT content_key FROM cms_content WHERE content_key = ?', [key]);
  if (existing.length) {
    console.log(`  ${key}: already present, left as is`);
    continue;
  }
  await execute(
    `INSERT INTO cms_content (content_key, content_value, value_type, group_name, label, sort_order)
     VALUES (?, ?, 'text', 'landing', ?, ?)`,
    [key, value, label, sort],
  );
  console.log(`  ${key}: added`);
}
process.exit(0);
