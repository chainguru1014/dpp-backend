const mongoose = require("mongoose");

// A brand a company sells under. A company can have several; each has its
// own details (what a new product of that brand starts with) and its own
// product page design. Products carry a copy of the details in
// product.brandInfo and are matched to their brand by name.
const brandSchema = new mongoose.Schema({
    company_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    name: { type: String, required: true, trim: true },
    // Lowercased name: one brand per name within a company, whatever the capitals.
    nameKey: { type: String, required: true },
    detail: { type: String, default: '' },
    websiteUrl: { type: String, default: '' },
    logoUrl: { type: String, default: '' },
    coverUrl: { type: String, default: '' },
    // The brand's product page design — always read through
    // utils/dppTheme.normalizeDppTheme. Unset means the Yometel defaults.
    dppTheme: { type: mongoose.Schema.Types.Mixed, default: undefined }
}, { timestamps: true });

brandSchema.index({ company_id: 1, nameKey: 1 }, { unique: true });

module.exports = mongoose.model("Brand", brandSchema);
