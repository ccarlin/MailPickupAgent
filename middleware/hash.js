const crypto = require('crypto');

function verifyPassword(password, stored) {
  const parts = stored.split(':');
  if (parts.length !== 2) {
    return false;
  }
  const [salt, key] = parts;
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(key));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

module.exports = { verifyPassword, hashPassword };
