const mongoose = require("mongoose");

const ownerRef = {
    kind: { type: String, enum: ['Company', 'User'] },
    id: { type: mongoose.Schema.Types.ObjectId },
    name: { type: String, default: '' },
    email: { type: String, default: '' }
};

const ownershipTransferSchema = new mongoose.Schema({
    product_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    qrcode_id: {
        type: Number,
        default: null
    },
    // URL-safe secret embedded in the QR/confirmation link.
    code: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    // Ownership-transfer method ("buy type" / business case). Buyer's Buy
    // defaults to 'sale'; owner-initiated transfers pick a business method.
    method: {
        type: String,
        enum: [
            'sale', 'sell', 'distribute', 'distribute_to_shop',
            'export_to_country', 'export_to_store', 'export_to_shop',
            'gift', 'lease', 'return'
        ],
        default: 'sale'
    },
    // Number of minted units transferred (per-unit ownership ledger).
    quantity: {
        type: Number,
        default: 1
    },
    status: {
        type: String,
        enum: ['pending', 'confirmed', 'rejected', 'cancelled'],
        default: 'pending'
    },
    // True once the buyer actually pressed "Send" (the request was delivered to
    // the owner). A transfer is created on "Buy" to mint the QR, but the buyer's
    // button only shows "Requested" after this becomes true.
    requestSent: {
        type: Boolean,
        default: false
    },
    productSnapshot: {
        name: { type: String, default: '' },
        model: { type: String, default: '' },
        image: { type: String, default: '' },
        brandName: { type: String, default: '' }
    },
    // Current owner at the time the transfer was initiated.
    from_owner: ownerRef,
    // The party the product is being transferred to. Usually a registered User,
    // but may be an unregistered Email invite (id null until they register).
    to_owner: {
        kind: { type: String, enum: ['Company', 'User', 'Email'], default: 'User' },
        id: { type: mongoose.Schema.Types.ObjectId, default: null },
        name: { type: String, default: '' },
        email: { type: String, default: '' },
        phone: { type: String, default: '' },
        country: { type: String, default: '' }
    },
    confirmed_by: {
        kind: { type: String, enum: ['Company', 'User'] },
        id: { type: mongoose.Schema.Types.ObjectId }
    },
    confirmed_at: { type: Date, default: null }
}, { timestamps: true });

ownershipTransferSchema.index({ product_id: 1, status: 1, createdAt: -1 });
ownershipTransferSchema.index({ status: 1, createdAt: -1 });

const OwnershipTransfer = mongoose.model("OwnershipTransfer", ownershipTransferSchema);
module.exports = OwnershipTransfer;
