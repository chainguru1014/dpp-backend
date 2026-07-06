const mongoose = require("mongoose");
const { SOURCE_TYPES } = require('../utils/pmcConstants');

// Admin-curated mapping: "this barcode/GTIN/NFC tag/RFID tag belongs to this
// product." Without this, a scanned barcode or NFC UID carries no product_id
// at all — unlike our own minted QR codes, which encode it directly. A
// company registers these ahead of time (via the admin panel); PmcIdentifier
// (pmcIdentifierModel.ts) then records actual scans against the resolved
// product/PMC.
const productIdentifierSchema = new mongoose.Schema({
    product_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    company_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    source_type: {
        type: String,
        enum: SOURCE_TYPES,
        required: true
    },
    // Exact string this mapping was registered under (a specific NFC/RFID tag
    // ID, or a barcode value when the company wants an exact match rather
    // than GTIN-based matching).
    raw_value: {
        type: String,
        default: ''
    },
    // Normalized GTIN (utils/gs1.ts) — when set, ANY unit's barcode/GS1
    // Digital Link sharing this GTIN resolves to this product even if the
    // exact printed string differs from raw_value.
    gtin: {
        type: String,
        default: ''
    },
    note: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

productIdentifierSchema.index({ raw_value: 1 }, { unique: true, partialFilterExpression: { raw_value: { $gt: '' } } });
productIdentifierSchema.index({ gtin: 1 }, { partialFilterExpression: { gtin: { $gt: '' } } });
productIdentifierSchema.index({ product_id: 1 });

module.exports = mongoose.model("ProductIdentifier", productIdentifierSchema);
