/**
 * Attach profile images to the demo accounts.
 *
 * The business logo is The Travela's real mark, downloaded from their site so
 * the demo shows the actual brand rather than a placeholder. Partner avatars
 * are generated monograms in the Pazo palette: inventing photographs of people
 * who do not exist would be misleading, and using real people's photos without
 * permission is not something to ship.
 *
 *   node scripts/seed-images.js
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute, query, queryOne } from '../src/db/pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(here, '../assets');

const TRAVELA_LOGO_URL = 'https://www.thetravela.com/logos/travela_dark.png';

/* ------------------------------------------------------------------ */
/* monogram colours                                                    */
/*                                                                     */
/* Partner avatars stay as the monogram the interface already draws     */
/* from the name and colour: it is crisp at every size, needs no        */
/* storage, and is honest. Inventing photographs of people who do not   */
/* exist would misrepresent the demo.                                   */
/* ------------------------------------------------------------------ */

/** Deterministic colour per name, from the Pazo palette. */
const PALETTE = ['#01989f', '#0f3460', '#0e7490', '#2c6e6e', '#047857', '#b45309', '#4338ca'];
const colourFor = (seed) =>
  PALETTE[parseInt(crypto.createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) % PALETTE.length];

/* ------------------------------------------------------------------ */
/* business logo                                                       */
/* ------------------------------------------------------------------ */

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PazoSeed/1.0)' } });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const pngSize = (b) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) });

async function seedBusinessLogo() {
  const business = await queryOne(
    "SELECT id, name FROM businesses WHERE slug = 'thetravela' OR name LIKE '%Travela%' LIMIT 1",
  );
  if (!business) {
    console.log('  No Travela business row — skipping logo.');
    return;
  }

  // Prefer a locally cached copy so a seed never depends on a third-party site
  // being reachable; fall back to downloading it.
  const local = path.join(ASSETS, 'travela-logo.png');
  let buf;
  if (fs.existsSync(local)) {
    buf = fs.readFileSync(local);
    console.log(`  Using cached logo (${(buf.length / 1024).toFixed(0)}KB)`);
  } else {
    console.log('  Downloading The Travela logo...');
    buf = await fetchBuffer(TRAVELA_LOGO_URL);
    fs.mkdirSync(ASSETS, { recursive: true });
    fs.writeFileSync(local, buf);
    console.log(`  Cached to assets/travela-logo.png (${(buf.length / 1024).toFixed(0)}KB)`);
  }

  if (!(buf[0] === 0x89 && buf[1] === 0x50)) {
    console.log('  Downloaded file is not a PNG — skipping.');
    return;
  }

  const { width, height } = pngSize(buf);
  const etag = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 32);

  await execute(
    `INSERT INTO business_logos (business_id, mime_type, byte_size, width, height, image_data, etag)
     VALUES (?, 'image/png', ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       mime_type = VALUES(mime_type), byte_size = VALUES(byte_size),
       width = VALUES(width), height = VALUES(height),
       image_data = VALUES(image_data), etag = VALUES(etag)`,
    [business.id, buf.length, width, height, buf, etag],
  );
  await execute('UPDATE businesses SET has_logo = 1 WHERE id = ?', [business.id]);
  console.log(`  ${business.name}: logo set (${width}x${height}, ${(buf.length / 1024).toFixed(0)}KB)`);
}

/* ------------------------------------------------------------------ */
/* avatar colours                                                      */
/* ------------------------------------------------------------------ */

/**
 * Give every demo account a distinct, stable monogram colour so partner lists
 * look like a real roster rather than a wall of identical circles.
 */
async function seedAvatarColours() {
  const users = await query(
    `SELECT u.id, u.name FROM users u
      JOIN partners p ON p.user_id = u.id`,
  );
  for (const u of users) {
    await execute('UPDATE users SET avatar_color = ? WHERE id = ?', [colourFor(u.name), u.id]);
  }
  console.log(`  ${users.length} partner monogram colours set`);
}

async function main() {
  console.log('\n  Seeding brand images...');
  await seedBusinessLogo();
  await seedAvatarColours();
  console.log('  Done.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('  Image seed failed:', err.message);
    process.exit(1);
  });
