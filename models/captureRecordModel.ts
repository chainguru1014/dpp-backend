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
        enum: ['qr', 'barcode'],
        default: 'qr'
    },
    imagePath: {
        type: String,
        default: ''
    },
    // Best-effort — blank when the device/browser couldn't provide it.
    location: {
        latitude: { type: Number, default: null },
        longitude: { type: Number, default: null },
        accuracy: { type: Number, default: null }
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
    }
});

captureRecordSchema.index({ company_id: 1, stepIndex: 1, dateKey: 1 });
captureRecordSchema.index({ employee_id: 1, capturedAt: -1 });

const CaptureRecord = mongoose.model("CaptureRecord", captureRecordSchema);
module.exports = CaptureRecord;
