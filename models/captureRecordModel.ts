const mongoose = require("mongoose");

// One row per corporate "Worker Operations" scan capture. Distinct from
// ScanRecord (consumer product-detail scans) — this is an operational audit
// trail tied to a company's process steps, terminals, and workers, not a
// product-detail lookup. stepEntity/stepType/terminalId/workerLabel are
// snapshotted at capture time so historic records stay accurate even if the
// Company's processSteps or the Employee's terminalId change later.
const captureRecordSchema = new mongoose.Schema({
    company_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    employee_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true
    },
    stepIndex: {
        type: Number,
        required: true
    },
    stepEntity: {
        type: String,
        default: ''
    },
    stepType: {
        type: String,
        default: ''
    },
    // Ref number pieces, e.g. "COL-4-20260729-041".
    refCode: {
        type: String,
        default: ''
    },
    seq: {
        type: Number,
        required: true
    },
    dateKey: {
        type: String,
        required: true
    },
    refNumber: {
        type: String,
        required: true
    },
    rawValue: {
        type: String,
        default: ''
    },
    identifierType: {
        type: String,
        enum: ['qr', 'barcode', 'nfc', 'rfid', 'gs1dl'],
        default: 'qr'
    },
    imagePath: {
        type: String,
        default: ''
    },
    // Resolved at capture time (see captureController.create's Result-screen
    // navigation needs) — the same product a worker's scan already had to
    // resolve to before Capture was even enabled (see the app's
    // verifyScannedCode). Optional: only set when the scanned code carried a
    // product/qrcode identifier (a QR does; a bare barcode looked up via
    // pmc/lookup may not).
    productId: {
        type: String,
        default: ''
    },
    qrcodeId: {
        type: String,
        default: ''
    },
    // Snapshot of the resolved product's first image at capture time — RFID
    // and NFC captures have no photo of their own (unlike qr/barcode, which
    // store one in imagePath), so the app's RFID recent-captures card shows
    // this instead. Blank when the identifier didn't resolve to a product.
    productImage: {
        type: String,
        default: ''
    },
    // Best-effort — blank when the device/browser couldn't provide it.
    location: {
        latitude: { type: Number, default: null },
        longitude: { type: Number, default: null },
        accuracy: { type: Number, default: null },
        // Reverse-geocoded human-readable address (e.g. "New York, US"),
        // resolved app-side at capture time — see app/src/utils/deviceCapture.ts.
        address: { type: String, default: '' }
    },
    device: {
        model: { type: String, default: '' },
        os: { type: String, default: '' },
        osVersion: { type: String, default: '' }
    },
    terminalId: {
        type: String,
        default: ''
    },
    workerLabel: {
        type: String,
        default: ''
    },
    flagged: {
        type: Boolean,
        default: false
    },
    capturedAt: {
        type: Date,
        default: Date.now
    },
    // Set by the app (one id per Capture press, kept on retries) so a save
    // repeated after a lost response returns the first record instead of
    // creating a second one. Absent on records from older app versions.
    clientCaptureId: {
        type: String
    }
});

captureRecordSchema.index({ company_id: 1, stepIndex: 1, dateKey: 1 });
captureRecordSchema.index({ employee_id: 1, capturedAt: -1 });
// Partial: only records that carry an id take part, so the existing records
// (none have one) cannot conflict when the index is built.
captureRecordSchema.index(
    { employee_id: 1, clientCaptureId: 1 },
    { unique: true, partialFilterExpression: { clientCaptureId: { $type: 'string' } } }
);

const CaptureRecord = mongoose.model("CaptureRecord", captureRecordSchema);
module.exports = CaptureRecord;
