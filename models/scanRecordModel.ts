const mongoose = require('mongoose');

const scanRecordSchema = new mongoose.Schema(
    {
        product_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: true
        },
        // Optional: barcode/NFC/RFID/GS1-DL resolved scans have no per-unit
        // qrcode_id (a bare GTIN can't distinguish two physical units) — those
        // rows are keyed by pmc_code alone instead.
        qrcode_id: {
            type: Number,
            default: null
        },
        encrypt_data: {
            type: String,
            required: true
        },
        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        scanned_at: {
            type: Date,
            default: Date.now
        },
        /** How this row was created: physical QR scan vs opening a public product URL while logged in */
        source: {
            type: String,
            enum: ['scan', 'visit'],
            default: 'scan'
        },
        /** Requester IP captured server-side at record time. */
        ip: {
            type: String,
            default: ''
        },
        /** Detected location (client-provided coords and/or IP-derived geo). */
        location: {
            country: { type: String, default: '' },
            region: { type: String, default: '' },
            city: { type: String, default: '' },
            latitude: { type: Number, default: null },
            longitude: { type: Number, default: null },
            source: { type: String, default: '' } // 'gps' | 'ip'
        },
        /** Security QR result: true = passed/verified, false = failed, null = not applicable. */
        security_verified: {
            type: Boolean,
            default: null
        },
        security_qrcode_id: {
            type: Number,
            default: null
        },
        /** Canonical PMC for the scanned item, resolved at scan time — the join
         *  key analytics/AI tooling should use instead of qrcode_id. */
        pmc_code: {
            type: String,
            default: ''
        },
        /** Which identifier format this scan was captured from. */
        identifier_type: {
            type: String,
            enum: ['qr', 'barcode', 'nfc', 'rfid', 'gs1dl'],
            default: 'qr'
        }
    },
    {
        timestamps: true
    }
);

scanRecordSchema.index({ encrypt_data: 1, scanned_at: -1 });
scanRecordSchema.index({ product_id: 1, qrcode_id: 1, scanned_at: -1 });

const ScanRecord = mongoose.model('ScanRecord', scanRecordSchema);
module.exports = ScanRecord;
