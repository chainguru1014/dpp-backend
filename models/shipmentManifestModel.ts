const mongoose = require("mongoose");

// A shipment's expected-item list — created by a Supervisor/super admin
// ahead of time, printed as a QR code on the physical box, then scanned by
// staff at the RFID gate to compare against what the R700 actually reads.
// V1 is scoped to one product per manifest (matches the brief's "Items #1
// to #100" example — a single SKU shipment) rather than mixed-product
// manifests; that's the simplest correct shape to start from and can be
// extended to multiple line items later without a breaking migration if
// that turns out to be needed.
const shipmentManifestSchema = new mongoose.Schema({
    company_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    // Short, unique, human-typeable-if-needed code encoded in the printed
    // QR — deliberately NOT reusing the product QR system (QRcode model),
    // since this identifies a shipment/box, not a physical product unit.
    manifest_code: {
        type: String,
        required: true,
        unique: true
    },
    product_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    // The specific physical units expected in this shipment, by qrcode_id —
    // each one's RFID tag must already be paired to that exact unit (see
    // productIdentifierController.pair) for a gate scan to ever match it;
    // a tag only bulk-registered to the product in general (no qrcode_id)
    // can't satisfy a specific expected item.
    expected_qrcode_ids: {
        type: [Number],
        required: true
    },
    // Free-text reference for whoever created it (a PO number, carrier note,
    // etc.) — not interpreted by any logic here.
    label: {
        type: String,
        default: ''
    },
    created_by_employee_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        default: null
    },
    status: {
        type: String,
        enum: ['pending', 'complete', 'mismatch'],
        default: 'pending'
    },
    latest_inspection_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'InspectionRecord',
        default: null
    }
}, {
    timestamps: true
});

shipmentManifestSchema.index({ company_id: 1, createdAt: -1 });

module.exports = mongoose.model("ShipmentManifest", shipmentManifestSchema);
