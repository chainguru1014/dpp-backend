const mongoose = require("mongoose");

/**
 * Per-unit ownership ledger. Each row records how many minted units of a product
 * a given owner currently holds. Ownership can be split across many owners, and
 * an owner may be a Company, a registered User, or an unregistered Email invite
 * (claimed and converted to a User when that email registers/logs in).
 */
const productHoldingSchema = new mongoose.Schema({
    product_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    owner: {
        kind: { type: String, enum: ['Company', 'User', 'Email'], required: true },
        id: { type: mongoose.Schema.Types.ObjectId, default: null },
        email: { type: String, default: '' },
        name: { type: String, default: '' }
    },
    quantity: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

productHoldingSchema.index({ product_id: 1, 'owner.kind': 1, 'owner.id': 1 });
productHoldingSchema.index({ product_id: 1, 'owner.email': 1 });
productHoldingSchema.index({ 'owner.id': 1 });
productHoldingSchema.index({ 'owner.email': 1 });

const ProductHolding = mongoose.model("ProductHolding", productHoldingSchema);
module.exports = ProductHolding;
