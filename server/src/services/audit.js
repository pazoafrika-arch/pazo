import { execute } from '../db/pool.js';

/**
 * Record an admin or privileged action, per spec 8.2.
 * Never throws: an audit failure must not break the action it describes.
 */
export async function recordAudit({
  actor = null,
  action,
  resourceType = null,
  resourceId = null,
  detail = null,
  ip = null,
}) {
  try {
    await execute(
      `INSERT INTO audit_log
         (actor_user_id, actor_name, actor_role, action, resource_type, resource_id, detail, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actor?.id ?? null,
        actor?.name ?? null,
        actor?.role ?? null,
        action,
        resourceType,
        resourceId ? String(resourceId) : null,
        detail ? JSON.stringify(detail) : null,
        ip,
      ],
    );
  } catch (err) {
    console.error('[pazo] audit write failed:', err.message);
  }
}

/** Express helper: pull the caller IP in a proxy-safe way. */
export const clientIp = (req) =>
  (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').trim() || null;
