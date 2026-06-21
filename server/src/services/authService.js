// authService.js — email/password auth with JWT sessions and a seeded demo user.

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const DEMO_USER = {
  id: 'user-demo-1',
  email: 'demo@timetracker.test',
  password: 'Demo1234!',
  fullName: 'Demo User',
};

const JWT_DEFAULT_SECRET = 'dev-only-change-me-in-production';
const TOKEN_TTL = '7d';

/** @type {Map<string, { id: string, email: string, fullName: string, passwordHash: string }>} */
const usersByEmail = new Map();
/** @type {Map<string, { id: string, email: string, fullName: string, passwordHash: string }>} */
const usersById = new Map();

let demoSeeded = false;

function getJwtSecret() {
  return process.env.JWT_SECRET || JWT_DEFAULT_SECRET;
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
  };
}

export function createAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email },
    getJwtSecret(),
    { expiresIn: TOKEN_TTL },
  );
}

export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, getJwtSecret());
    const user = usersById.get(payload.sub);
    if (!user) return null;
    return { payload, user };
  } catch {
    return null;
  }
}

export async function registerUser({ fullName, email, password }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  if (!normalizedEmail || !password || !fullName) {
    throw new AuthError('fullName, email, and password are required.', 400);
  }
  if (password.length < 8) {
    throw new AuthError('Password must be at least 8 characters.', 400);
  }
  if (usersByEmail.has(normalizedEmail)) {
    throw new AuthError('An account with this email already exists.', 409);
  }

  const id = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id,
    email: normalizedEmail,
    fullName: String(fullName).trim(),
    passwordHash,
  };

  usersByEmail.set(normalizedEmail, user);
  usersById.set(id, user);
  return user;
}

export async function authenticateUser({ email, password }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const user = usersByEmail.get(normalizedEmail);
  if (!user) {
    throw new AuthError('Invalid email or password.', 401);
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    throw new AuthError('Invalid email or password.', 401);
  }

  return user;
}

export function findUserById(id) {
  return usersById.get(id) ?? null;
}

export async function ensureDemoUser() {
  if (demoSeeded) return usersByEmail.get(DEMO_USER.email);
  demoSeeded = true;

  if (usersByEmail.has(DEMO_USER.email)) {
    return usersByEmail.get(DEMO_USER.email);
  }

  const passwordHash = await bcrypt.hash(DEMO_USER.password, 10);
  const user = {
    id: DEMO_USER.id,
    email: DEMO_USER.email,
    fullName: DEMO_USER.fullName,
    passwordHash,
  };
  usersByEmail.set(user.email, user);
  usersById.set(user.id, user);
  return user;
}

/** Test helper — clears users and re-seeds demo account. */
export async function resetAuthStore() {
  usersByEmail.clear();
  usersById.clear();
  demoSeeded = false;
  return ensureDemoUser();
}

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

await ensureDemoUser();

export default {
  DEMO_USER,
  publicUser,
  createAccessToken,
  verifyAccessToken,
  registerUser,
  authenticateUser,
  findUserById,
  ensureDemoUser,
  resetAuthStore,
  AuthError,
};
