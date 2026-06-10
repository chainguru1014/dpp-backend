const mongoose = require('mongoose');

const albumItemSchema = new mongoose.Schema(
    {
        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        product_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: true
        },
        token_id: {
            type: Number,
            default: null
        },
        productSnapshot: {
            name: { type: String, default: '' },
            model: { type: String, default: '' },
            detail: { type: String, default: '' },
            images: { type: Array, default: [] },
            brandInfo: {
                name: { type: String, default: '' },
                detail: { type: String, default: '' },
                websiteUrl: { type: String, default: '' },
                logoUrl: { type: String, default: '' }
            }
        }
    },
    { timestamps: true }
);

albumItemSchema.index({ user_id: 1, product_id: 1, token_id: 1 }, { unique: true });

module.exports = mongoose.model('AlbumItem', albumItemSchema);
