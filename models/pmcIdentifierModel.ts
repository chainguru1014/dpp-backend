const mongoose = require("mongoose");
const { SOURCE_TYPES } = require('../utils/pmcConstants');

// One row per raw identifier ever captured for an item (a QR URL, a raw
// barcode string, an NFC tag UID, an RFID EPC, or a GS1 Digital Link). The
// unique index on (source_type, raw_value) is what makes PMC resolution
// idempotent: re-scanning the same physical code always resolves to the same
// PMC instead of minting a duplicate.
const pmcIdentifierSchema = new mongoose.Schema({
    pmc_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PMC',
        required: true
    },
    source_type: {
        type: String,
        enum: SOURCE_TYPES,
        required: true
    },
    raw_value: {
        type: String,
        required: true
    },
    // Populated when raw_value parses as a GS1 element string / Digital Link
    // (GTIN + optional batch/lot, serial, expiry). Left blank for companies
    // that don't follow GS1 — the PMC still resolves fine off raw_value alone.
    gs1: {
        gtin: { type: String, default: '' },
        batchLot: { type: String, default: '' },
        serial: { type: String, default: '' },
        expiry: { type: String, default: '' }
    }
}, {
    timestamps: true
});

pmcIdentifierSchema.index({ source_type: 1, raw_value: 1 }, { unique: true });
pmcIdentifierSchema.index({ pmc_id: 1 });

const PmcIdentifier = mongoose.model("PmcIdentifier", pmcIdentifierSchema);
module.exports = PmcIdentifier;
