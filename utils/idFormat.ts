// Small formatting helpers shared by employee provisioning (terminal IDs) and
// capture recording (ref numbers) — both build human-readable IDs on top of
// counterModel's raw numeric sequences.

// Plain per-company incrementing employee number ("1", "2", "3", ...) —
// shown in the app as "Terminal {terminalId}". Previously a letter+2-digit
// code (e.g. "A07"); simplified to a bare number per explicit request.
const formatTerminalId = (seq: number): string => String(seq);

// "Colombo Plant" -> "COL". Falls back to "GEN" if the entity has no letters.
const deriveEntityCode = (entity: string): string => {
    const letters = String(entity || '').replace(/[^a-zA-Z]/g, '').toUpperCase();
    return letters.slice(0, 3) || 'GEN';
};

module.exports = { formatTerminalId, deriveEntityCode };
