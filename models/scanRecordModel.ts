const mongoose = require('mongoose');

const scanRecordSchema = new mongoose.Schema(
    {
        product_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: true
        },
        qrcode_id: {
            type: Number,
            required: true
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
