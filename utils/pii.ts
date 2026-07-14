const crypto = require('crypto');

/** Lowercase/trim an email the same way authLink.normalizeEmail does, so a
 * hash computed here always matches one computed there for the same address. */
const normalizeEmail = (value: any) => String(value || '').trim().toLowerCase();

/** Domain portion of a normalized email, e.g. "user@Hm.com" -> "hm.com". */
const emailDomain = (value: any) => {
    const normalized = normalizeEmail(value);
    const at = normalized.lastIndexOf('@');
    return at === -1 ? '' : normalized.slice(at + 1);
};

/**
 * One-way SHA-256 hash of a normalized email. This is the ONLY representation
 * of an employee's corporate email address ever written to the database —
 * the raw string is used in-memory just long enough to send the OTP mail and
 * is never persisted. Deterministic so a returning employee re-hashes to the
 * same value and is recognized without us ever storing their real address.
 */
const hashEmail = (value: any) => crypto.createHash('sha256').update(normalizeEmail(value)).digest('hex');

module.exports = {
    normalizeEmail,
    emailDomain,
    hashEmail
};
