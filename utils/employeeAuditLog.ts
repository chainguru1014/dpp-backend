const crypto = require('crypto');
const EmployeeAuditLog = require('../models/employeeAuditLogModel');

// Fixed starting point for the hash chain — every employee's very first log
// entry chains from this instead of an empty string, so an attacker can't
// forge a plausible-looking "first" entry with an empty prevHash.
const GENESIS_HASH = 'genesis';

const computeEntryHash = (prevHash: string, employeeId: any, action: string, metadata: any, createdAt: Date) => {
    const payload = JSON.stringify({ prevHash, employeeId: String(employeeId), action, metadata: metadata || {}, createdAt: createdAt.toISOString() });
    return crypto.createHash('sha256').update(payload).digest('hex');
};

/**
 * Appends one tamper-evident row to an employee's audit trail. Reads the
 * employee's own last entry (not a global chain) so concurrent employees
 * never contend on the same prevHash.
 */
const appendAuditLog = async (employeeId: any, action: string, metadata: any = {}, ip: string = '') => {
    const last = await EmployeeAuditLog.findOne({ employee_id: employeeId }).sort({ createdAt: -1 });
    const prevHash = last ? last.entryHash : GENESIS_HASH;
    const createdAt = new Date();
    const entryHash = computeEntryHash(prevHash, employeeId, action, metadata, createdAt);

    return EmployeeAuditLog.create({
        employee_id: employeeId,
        action,
        metadata,
        ip,
        prevHash,
        entryHash,
        createdAt,
        updatedAt: createdAt
    });
};

module.exports = {
    GENESIS_HASH,
    computeEntryHash,
    appendAuditLog
};
