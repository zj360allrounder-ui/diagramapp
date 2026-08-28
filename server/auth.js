import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const usersFile = path.join(rootDir, 'auth-users.json');

const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === 'production'
    ? null
    : 'zarus-diag-studio-dev-secret-change-me');

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

/** @type {{ username: string, passwordHash: string }[]} */
let users = [];

function defaultUsers() {
  const username = process.env.AUTH_USERNAME || 'admin';
  const password = process.env.AUTH_PASSWORD || 'changeme';
  return [
    {
      username,
      passwordHash: bcrypt.hashSync(password, 10),
    },
  ];
}

export function loadAuthUsers() {
  if (!JWT_SECRET) {
    throw new Error(
      'JWT_SECRET is required in production. Set it in the environment before starting the server.'
    );
  }

  if (fs.existsSync(usersFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('auth-users.json must be a non-empty array');
      }
      users = raw.map((row, i) => {
        const username = String(row?.username ?? '').trim();
        if (!username) throw new Error(`User at index ${i} is missing username`);
        if (row.passwordHash && typeof row.passwordHash === 'string') {
          return { username, passwordHash: row.passwordHash };
        }
        if (row.password && typeof row.password === 'string') {
          return { username, passwordHash: bcrypt.hashSync(row.password, 10) };
        }
        throw new Error(`User "${username}" needs password or passwordHash`);
      });
      console.log(`Auth: loaded ${users.length} user(s) from auth-users.json`);
      return;
    } catch (e) {
      console.error('Auth: failed to load auth-users.json —', e?.message || e);
      throw e;
    }
  }

  users = defaultUsers();
  const u = users[0].username;
  console.log(
    `Auth: no auth-users.json — using ${u} (set AUTH_PASSWORD / create auth-users.json for office use)`
  );
}

function findUser(username) {
  const key = String(username ?? '').trim().toLowerCase();
  return users.find((u) => u.username.toLowerCase() === key) || null;
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.username, username: user.username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Express middleware — requires `Authorization: Bearer <jwt>`.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = verifyToken(match[1].trim());
    req.user = {
      username: payload.username || payload.sub,
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export async function loginHandler(req, res) {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = findUser(username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = signToken(user);
  return res.json({
    token,
    user: { username: user.username },
    expiresIn: JWT_EXPIRES_IN,
  });
}

export function meHandler(req, res) {
  return res.json({ user: { username: req.user.username } });
}
