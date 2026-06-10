const mongoose = require('mongoose');

const productReactionSchema = new mongoose.Schema(
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
        reaction: {
            type: String,
            enum: ['like', 'dislike', 'buy'],
            required: true
        }
    },
    { timestamps: true }
);

productReactionSchema.index({ user_id: 1, product_id: 1, token_id: 1 }, { unique: true });

module.exports = mongoose.model('ProductReaction', productReactionSchema);
