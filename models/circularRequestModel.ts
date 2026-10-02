const mongoose = require("mongoose");

// A shopper's request for one of a product's end-of-life services (repair,
// resell, rent, recycle), sent from the app. The brand answers it in the
// admin panel; every change of status is kept in `history`.
const circularRequestSchema = new mongoose.Schema({
    // Short reference both sides can quote, e.g. "SR-7K2M9Q".
    ref: { type: String, required: true, unique: true },
    kind: { type: String, enum: ['repair', 'resell', 'rent', 'recycle'], required: true },
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    company_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    // The physical item, when the request was made from a scanned code.
    qrcode_id: { type: Number, default: null },
    productName: { type: String, default: '' },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    contact: {
        name: { type: String, default: '' },
        email: { type: String, default: '' },
        phone: { type: String, default: '' }
    },
    // What the shopper wrote: the fault, the item's condition, dates wanted…
    message: { type: String, default: '' },
    status: {
        type: String,
        enum: ['new', 'accepted', 'in_progress', 'completed', 'declined', 'cancelled'],
        default: 'new',
        index: true
    },
    // The brand's latest answer to the shopper.
    reply: { type: String, default: '' },
    history: [{
        _id: false,
        status: { type: String },
        note: { type: String, default: '' },
        by: { type: String, default: '' },
        at: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

module.exports = mongoose.model("CircularRequest", circularRequestSchema);
