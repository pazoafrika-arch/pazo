import express from 'express';
import { queryOne } from '../db/pool.js';
import { asyncRoute, badRequest, notFound, ok } from '../utils/http.js';
import { requireAuth } from '../middleware/auth.js';
import {
  deleteUserAvatar,
  getBusinessLogo,
  getUserAvatar,
  notModified,
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

export default router;
