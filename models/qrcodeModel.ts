const mongoose = require("mongoose");

const qrcodeSchema = new mongoose.Schema({
    product_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
    },
    company_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company'
    },
    qrcode_id: {
        type: Number,
        require: true
    },
    parent_qrcode_id:{
        type:Number,
        default:-1
    }
});

// Guards against the mint-time ID reservation ever being bypassed (e.g. a
// direct POST to the generic /qrcode CRUD route, or a future bug): the same
// (product_id, qrcode_id) pair must never be created twice.
qrcodeSchema.index({ product_id: 1, qrcode_id: 1 }, { unique: true });

const QRcode = mongoose.model("QRcode", qrcodeSchema);
module.exports = QRcode;