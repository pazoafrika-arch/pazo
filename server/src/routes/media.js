import express from 'express';
import { queryOne } from '../db/pool.js';
import { asyncRoute, badRequest, notFound, ok } from '../utils/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  deleteBusinessLogo,
  deleteUserAvatar,
  getBusinessLogo,
  getUserAvatar,
  notModified,
  saveBusinessLogo,
  saveUserAvatar,
  sendImage,
} from '../services/images.js';
import { recordAudit, clientIp } from '../services/audit.js';

const router = express.Router();

/* ------------------------------------------------------------------ */
/* GET /media/avatar/:userId                                           */
/*                                                                     */
/* Readable by any signed-in user, because avatars appear in partner    */
/* tables and detail panels. It exposes only the picture someone chose  */
/* to represent themselves, never a name, contact or balance.           */
/* ------------------------------------------------------------------ */
router.get(
  '/avatar/:userId',
  requireAuth,
  asyncRoute(async (req, res) => {
    const row = await getUserAvatar(req.params.userId);
    if (!row) return res.status(404).end();
    if (notModified(req, row)) return res.status(304).end();
    return sendImage(res, row);
  }),
);

/* ------------------------------------------------------------------ */
/* PUT /media/avatar  — set my own picture                             */
/* ------------------------------------------------------------------ */
router.put(
  '/avatar',
  requireAuth,
  asyncRoute(async (req, res) => {
    const { image } = req.body || {};
    if (!image) throw badRequest('Choose an image to upload');

    const result = await saveUserAvatar(req.user.id, image);
    await recordAudit({
      actor: req.user,
      action: 'profile.avatar_updated',
      resourceType: 'user',
      resourceId: req.user.id,
      ip: clientIp(req),
    });
    return ok(res, { updated: true, ...result });
  }),
);

/* ------------------------------------------------------------------ */
/* DELETE /media/avatar — go back to initials                          */
/* ------------------------------------------------------------------ */
router.delete(
  '/avatar',
  requireAuth,
  asyncRoute(async (req, res) => {
    await deleteUserAvatar(req.user.id);
    await recordAudit({
      actor: req.user,
      action: 'profile.avatar_removed',
      resourceType: 'user',
      resourceId: req.user.id,
      ip: clientIp(req),
    });
    return ok(res, { removed: true });
  }),
);

/* ------------------------------------------------------------------ */
/* GET /media/business-logo/:businessId                                */
/* ------------------------------------------------------------------ */
router.get(
  '/business-logo/:businessId',
  requireAuth,
  asyncRoute(async (req, res) => {
    const row = await getBusinessLogo(req.params.businessId);
    if (!row) return res.status(404).end();
    if (notModified(req, row)) return res.status(304).end();
    return sendImage(res, row);
  }),
);

/* ================================================================== */
/* Admin: manage anyone's picture                                      */
/*                                                                     */
/* Pazo staff onboard partners and businesses on their behalf, so they  */
/* need to set a logo or picture without asking that person to log in.  */
/* Every change is audited with the actor and the target.               */
/* ================================================================== */

const adminOnly = [requireAuth, requireRole('admin', 'super_admin')];

/** Set any user's profile picture. */
router.put(
  '/admin/avatar/:userId',
  ...adminOnly,
  asyncRoute(async (req, res) => {
    const { image } = req.body || {};
    if (!image) throw badRequest('Choose an image to upload');

    const target = await queryOne('SELECT id, name FROM users WHERE id = ? LIMIT 1', [
      req.params.userId,
    ]);
    if (!target) throw notFound('That account no longer exists');

    const result = await saveUserAvatar(target.id, image);
    await recordAudit({
      actor: req.user,
      action: 'admin.avatar_updated',
      resourceType: 'user',
      resourceId: target.id,
      detail: { name: target.name },
      ip: clientIp(req),
    });
    return ok(res, { updated: true, ...result });
  }),
);

/** Remove any user's profile picture, returning them to a monogram. */
router.delete(
  '/admin/avatar/:userId',
  ...adminOnly,
  asyncRoute(async (req, res) => {
    const target = await queryOne('SELECT id, name FROM users WHERE id = ? LIMIT 1', [
      req.params.userId,
    ]);
    if (!target) throw notFound('That account no longer exists');

    await deleteUserAvatar(target.id);
    await recordAudit({
      actor: req.user,
      action: 'admin.avatar_removed',
      resourceType: 'user',
      resourceId: target.id,
      detail: { name: target.name },
      ip: clientIp(req),
    });
    return ok(res, { removed: true });
  }),
);

/** Set a business logo. */
router.put(
  '/admin/business-logo/:businessId',
  ...adminOnly,
  asyncRoute(async (req, res) => {
    const { image } = req.body || {};
    if (!image) throw badRequest('Choose an image to upload');

    const business = await queryOne('SELECT id, name FROM businesses WHERE id = ? LIMIT 1', [
      req.params.businessId,
    ]);
    if (!business) throw notFound('Business not found');

    const result = await saveBusinessLogo(business.id, image);
    await recordAudit({
      actor: req.user,
      action: 'admin.business_logo_updated',
      resourceType: 'business',
      resourceId: business.id,
      detail: { name: business.name },
      ip: clientIp(req),
    });
    return ok(res, { updated: true, ...result });
  }),
);

/** Remove a business logo. */
router.delete(
  '/admin/business-logo/:businessId',
  ...adminOnly,
  asyncRoute(async (req, res) => {
    const business = await queryOne('SELECT id, name FROM businesses WHERE id = ? LIMIT 1', [
      req.params.businessId,
    ]);
    if (!business) throw notFound('Business not found');

    await deleteBusinessLogo(business.id);
    await recordAudit({
      actor: req.user,
      action: 'admin.business_logo_removed',
      resourceType: 'business',
      resourceId: business.id,
      detail: { name: business.name },
      ip: clientIp(req),
    });
    return ok(res, { removed: true });
  }),
);

export default router;
