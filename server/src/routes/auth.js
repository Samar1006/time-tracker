// auth.js — login, signup, and session endpoints for the frontend auth pages.

import { Router } from 'express';
import {
  authenticateUser,
  createAccessToken,
  DEMO_USER,
  publicUser,
  registerUser,
  AuthError,
} from '../services/authService.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

router.get('/demo-account', (_req, res) => {
  res.json({
    email: DEMO_USER.email,
    password: DEMO_USER.password,
    userId: DEMO_USER.id,
    note: 'Seeded demo account for local testing only.',
  });
});

router.post('/signup', async (req, res) => {
  try {
    const { fullName, email, password } = req.body ?? {};
    const user = await registerUser({ fullName, email, password });
    const token = createAccessToken(user);
    res.status(201).json({ token, user: publicUser(user) });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required.' });
    }

    const user = await authenticateUser({ email, password });
    const token = createAccessToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/logout', (_req, res) => {
  // Stateless JWT — client deletes the token.
  res.json({ ok: true });
});

export default router;
