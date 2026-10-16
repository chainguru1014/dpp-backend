const mongoose = require("mongoose");

// One gate-scan attempt against a ShipmentManifest. A manifest can be
// re-inspected (e.g. the missing item gets found and added to the box, staff
// re-scans) — each attempt gets its own row here rather than overwriting the
// last one, so there's a full audit trail of every scan, not just the
// latest result.
const inspectionRecordSchema = new mongoose.Schema({
    manifest_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ShipmentManifest',
        required: true
    },
    company_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    inspected_by_employee_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        default: null
    },
    // Every EPC the R700 reported during this gate-scan session, as-is —
    // kept even for ones that resolved to nothing or to an unexpected item,
    // so a disputed result can be investigated later.
    scanned_epcs: {
        type: [String],
        default: []
    },
    matched_qrcode_ids: {
        type: [Number],
        default: []
    },
    missing_qrcode_ids: {
        type: [Number],
        default: []
    },
    // Scanned EPCs that didn't resolve to an expected item of this manifest
    // — either an unregistered/unpaired tag, or a real tag belonging
    // somewhere else entirely (wrong box, stray tag in range).
    unexpected_epcs: {
        type: [String],
        default: []
    },
    result: {
        type: String,
        enum: ['pass', 'fail'],
        required: true
    }
}, {
    timestamps: true
});

inspectionRecordSchema.index({ manifest_id: 1, createdAt: -1 });

module.exports = mongoose.model("InspectionRecord", inspectionRecordSchema);
