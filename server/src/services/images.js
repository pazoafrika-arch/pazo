import crypto from 'node:crypto';
import { execute, queryOne } from '../db/pool.js';
import { badRequest } from '../utils/http.js';

/**
 * Profile images.
 *
 * Uploads arrive as a base64 data URL from the browser, which has already
 * cropped and resized the image on a canvas. That keeps the server free of a
 * native image library while still bounding what gets stored.
 *
 * The server does not trust any of it. It re-checks the declared type against
 * the file's actual magic bytes, enforces a hard byte cap, and rejects
 * anything that is not a real raster image. A file claiming to be a PNG but
 * containing SVG or HTML would otherwise be served back from our own origin
 * and could run script in the user's session.
 */

const MAX_BYTES = 512 * 1024; // 512KB after client-side resizing
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Verify the bytes really are the image type they claim to be. */
function detectType(buf) {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'image/png';
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // WebP: "RIFF" .... "WEBP"
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  return null;
}

/** Read the pixel dimensions straight from the header, for the record. */
function readDimensions(buf, mime) {
  try {
    if (mime === 'image/png') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === 'image/webp' && buf.toString('ascii', 12, 16) === 'VP8X') {
      return {
        width: 1 + buf.readUIntLE(24, 3),
        height: 1 + buf.readUIntLE(27, 3),
      };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i += 1; continue; }
        const marker = buf[i + 1];
        // SOF0..SOF15, excluding the non-frame markers C4, C8 and CC.
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch {
    /* a malformed header just means we store no dimensions */
  }
  return { width: null, height: null };
}

/**
 * Turn a data URL into validated bytes.
 * Throws a user-facing message on anything suspicious.
 */
export function parseImageUpload(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:'))
    throw badRequest('Choose an image file');

  const match = /^data:([a-z/+.-]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw badRequest('That image could not be read');

  const declared = match[1].toLowerCase();
  if (!ALLOWED.has(declared))
    throw badRequest('Use a PNG, JPEG or WebP image');

  let buf;
  try {
    buf = Buffer.from(match[2], 'base64');
  } catch {
    throw badRequest('That image could not be read');
  }

  if (!buf.length) throw badRequest('That image is empty');
  if (buf.length > MAX_BYTES)
    throw badRequest(`That image is too large. Keep it under ${Math.round(MAX_BYTES / 1024)}KB.`);

  // The decisive check: what the bytes actually are, not what they claim.
  const actual = detectType(buf);
  if (!actual) throw badRequest('That file is not a valid image');
  if (actual !== declared)
    throw badRequest('That file does not match its image type');

  const { width, height } = readDimensions(buf, actual);
  const etag = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 32);

  return { buffer: buf, mime: actual, bytes: buf.length, width, height, etag };
}

/* ------------------------------------------------------------------ */
/* user avatars                                                        */
/* ------------------------------------------------------------------ */

export async function saveUserAvatar(userId, dataUrl) {
  const img = parseImageUpload(dataUrl);
  await execute(
    `INSERT INTO user_avatars (user_id, mime_type, byte_size, width, height, image_data, etag)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       mime_type = VALUES(mime_type), byte_size = VALUES(byte_size),
       width = VALUES(width), height = VALUES(height),
       image_data = VALUES(image_data), etag = VALUES(etag)`,
    [userId, img.mime, img.bytes, img.width, img.height, img.buffer, img.etag],
  );
  await execute('UPDATE users SET has_avatar = 1 WHERE id = ?', [userId]);
  return { etag: img.etag, bytes: img.bytes, width: img.width, height: img.height };
}

export async function getUserAvatar(userId) {
  return queryOne(
    'SELECT mime_type, image_data, etag FROM user_avatars WHERE user_id = ? LIMIT 1',
    [userId],
  );
}

export async function deleteUserAvatar(userId) {
  await execute('DELETE FROM user_avatars WHERE user_id = ?', [userId]);
  await execute('UPDATE users SET has_avatar = 0 WHERE id = ?', [userId]);
  return { removed: true };
}

/* ------------------------------------------------------------------ */
/* business logos                                                      */
/* ------------------------------------------------------------------ */

export async function saveBusinessLogo(businessId, dataUrl) {
  const img = parseImageUpload(dataUrl);
  await execute(
    `INSERT INTO business_logos (business_id, mime_type, byte_size, width, height, image_data, etag)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       mime_type = VALUES(mime_type), byte_size = VALUES(byte_size),
       width = VALUES(width), height = VALUES(height),
       image_data = VALUES(image_data), etag = VALUES(etag)`,
    [businessId, img.mime, img.bytes, img.width, img.height, img.buffer, img.etag],
  );
  await execute('UPDATE businesses SET has_logo = 1 WHERE id = ?', [businessId]);
  return { etag: img.etag, bytes: img.bytes };
}

export async function getBusinessLogo(businessId) {
  return queryOne(
    'SELECT mime_type, image_data, etag FROM business_logos WHERE business_id = ? LIMIT 1',
    [businessId],
  );
}

export async function deleteBusinessLogo(businessId) {
  await execute('DELETE FROM business_logos WHERE business_id = ?', [businessId]);
  await execute('UPDATE businesses SET has_logo = 0 WHERE id = ?', [businessId]);
  return { removed: true };
}

/**
 * Send an image with caching headers.
 *
 * The ETag is the content hash, so a changed avatar invalidates itself while
 * an unchanged one is served from cache with a 304.
 */
export function sendImage(res, row, { fallbackStatus = 404 } = {}) {
  if (!row) return res.status(fallbackStatus).end();
  res.setHeader('Content-Type', row.mime_type);
  res.setHeader('ETag', `"${row.etag}"`);
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  // An image served from our own origin must never be sniffed as something
  // executable.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'");
  return res.send(row.image_data);
}

/** Compare the request's If-None-Match against the stored ETag. */
export const notModified = (req, row) =>
  Boolean(row && req.headers['if-none-match'] === `"${row.etag}"`);
