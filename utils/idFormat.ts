// Small formatting helpers shared by employee provisioning (terminal IDs) and
// capture recording (ref numbers) — both build human-readable IDs on top of
// counterModel's raw numeric sequences.

// 1 -> "A01", 99 -> "A99", 100 -> "B01", 198 -> "B99", 199 -> "C01" ...
const formatTerminalId = (seq: number): string => {
    const letter = String.fromCharCode(65 + Math.floor((seq - 1) / 99));
    const num = String(((seq - 1) % 99) + 1).padStart(2, '0');
    return `${letter}${num}`;
};

// "Colombo Plant" -> "COL". Falls back to "GEN" if the entity has no letters.
const deriveEntityCode = (entity: string): string => {
    const letters = String(entity || '').replace(/[^a-zA-Z]/g, '').toUpperCase();
    return letters.slice(0, 3) || 'GEN';
};

module.exports = { formatTerminalId, deriveEntityCode };
