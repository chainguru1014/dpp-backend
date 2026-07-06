// Identifier formats PMC resolution understands today. 'barcode' and 'gs1dl'
// (GS1 Digital Link) are parsed as plain strings for now — GTIN/batch/serial
// extraction happens in pmcService.parseGs1() and can be filled in without
// touching callers once that's built out.
const SOURCE_TYPES = ['qr', 'barcode', 'nfc', 'rfid', 'gs1dl'];

module.exports = { SOURCE_TYPES };
