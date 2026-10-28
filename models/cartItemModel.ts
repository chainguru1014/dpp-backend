const mongoose = require('mongoose');

// A consumer's shopping cart line — added from the scan summary page's
// Add to Cart button. One row per user + product + item (token_id), same
// keying as AlbumItem. The product itself is re-read on list so price
// changes made in the admin panel show up in the cart.
const cartItemSchema = new mongoose.Schema(
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
        quantity: {
            type: Number,
            default: 1,
            min: 1
        }
    },
    { timestamps: true }
);

cartItemSchema.index({ user_id: 1, product_id: 1, token_id: 1 }, { unique: true });

module.exports = mongoose.model('CartItem', cartItemSchema);
