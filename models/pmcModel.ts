const mongoose = require("mongoose");

// The canonical, format-agnostic identifier for one physical item. A PMC is
// created the first time ANY identifier (our own minted QR code, or an
// externally captured barcode/NFC/RFID/GS1 Digital Link) is seen for that
// item, and every subsequent identifier discovered for the same item attaches
// to this same record instead of creating a new one — see
// PmcIdentifier (pmcIdentifierModel.ts) and services/pmcService.ts.
const pmcSchema = new mongoose.Schema({
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
    pmc_code: {
        type: String,
        required: true,
        unique: true
    },
    // Set when this item was minted through our own platform (links back to
    // the QRcode/Serial rows for that item). Null when the PMC originates
    // purely from an externally captured identifier that was never minted here.
    qrcode_id: {
        type: Number,
        default: null
    }
}, {
    timestamps: true
});

pmcSchema.index({ product_id: 1, qrcode_id: 1 });

const PMC = mongoose.model("PMC", pmcSchema);
module.exports = PMC;
