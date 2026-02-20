const mongoose = require("mongoose");

const securityQRCodeSchema = new mongoose.Schema({
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
    security_qrcode_id: {
        type: Number,
        required: true
    },
    encrypted_key: {
        type: String,
        required: true
    },
    created_at: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Compound index to ensure uniqueness
securityQRCodeSchema.index({ product_id: 1, security_qrcode_id: 1 }, { unique: true });

const SecurityQRCode = mongoose.model("SecurityQRCode", securityQRCodeSchema);
module.exports = SecurityQRCode;
