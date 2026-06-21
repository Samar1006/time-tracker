// authMiddleware.js — optional Bearer JWT auth for protected routes.

import { verifyAccessToken } from '../services/authService.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }

  const verified = verifyAccessToken(match[1]);
  if (!verified) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  req.user = {
    id: verified.user.id,
    email: verified.user.email,
    fullName: verified.user.fullName,
  };
  next();
}

/** Attach req.user when a valid token is present; continue anonymously otherwise. */
export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match) {
    const verified = verifyAccessToken(match[1]);
    if (verified) {
      req.user = {
        id: verified.user.id,
        email: verified.user.email,
        fullName: verified.user.fullName,
      };
    }
  }
  next();
}

export default { requireAuth, optionalAuth };
