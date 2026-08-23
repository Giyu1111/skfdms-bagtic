const crypto = require('crypto');

const COOKIE_NAME = 'skfdms_auth';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function getSecret() {
  return process.env.SESSION_SECRET || 'skfdms_bagtic_secret';
}

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(payload) {
  return crypto
    .createHmac('sha256', getSecret())
    .update(payload)
    .digest('base64url');
}

function parseCookies(req) {
  return String(req.headers.cookie || '')
    .split(';')
    .map(cookie => cookie.trim())
    .filter(Boolean)
    .reduce((cookies, cookie) => {
      const splitAt = cookie.indexOf('=');
      if (splitAt === -1) return cookies;
      cookies[cookie.slice(0, splitAt)] = decodeURIComponent(cookie.slice(splitAt + 1));
      return cookies;
    }, {});
}

function encodeUser(user) {
  const expiresAt = Date.now() + MAX_AGE_MS;
  const payload = base64UrlEncode(JSON.stringify({ user, expiresAt }));
  return `${payload}.${sign(payload)}`;
}

function decodeUser(token) {
  if (!token || !token.includes('.')) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature || signature !== sign(payload)) return null;

  try {
    const data = JSON.parse(base64UrlDecode(payload));
    if (!data.expiresAt || Date.now() > data.expiresAt) return null;
    return data.user || null;
  } catch (err) {
    return null;
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE_MS,
    path: '/',
  };
}

function setAuthCookie(res, user) {
  const token = encodeUser(user);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  return token;
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

function getAuthCookieUser(req) {
  return decodeUser(parseCookies(req)[COOKIE_NAME]);
}

function getAuthHeaderUser(req) {
  const header = req.get ? req.get('x-skfdms-auth') : req.headers['x-skfdms-auth'];
  return decodeUser(header);
}

function getCurrentUser(req) {
  return (req.session && req.session.user) || getAuthCookieUser(req) || getAuthHeaderUser(req);
}

module.exports = {
  clearAuthCookie,
  getCurrentUser,
  setAuthCookie,
};
