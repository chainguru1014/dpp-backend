const crypto = require('crypto');

// Staff passwords: scrypt with a random salt (Node's own crypto, no extra
// package). Stored as "scrypt$<salt hex>$<hash hex>".
const KEYLEN = 64;

const hashPassword = (password: string): string => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, KEYLEN).toString('hex');
    return `scrypt$${salt}$${hash}`;
};

const verifyPassword = (password: string, stored: string): boolean => {
    const [kind, salt, hash] = String(stored || '').split('$');
    if (kind !== 'scrypt' || !salt || !hash) return false;
    const test = crypto.scryptSync(String(password), salt, KEYLEN);
    const known = Buffer.from(hash, 'hex');
    return known.length === test.length && crypto.timingSafeEqual(known, test);
};

// At least 8 characters, with a letter and a digit.
const passwordProblem = (password: any): string => {
    const p = String(password || '');
    if (p.length < 8) return 'The password needs at least 8 characters.';
    if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'The password needs at least one letter and one number.';
    return '';
};

module.exports = { hashPassword, verifyPassword, passwordProblem };
