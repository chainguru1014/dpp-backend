const mongoose = require("mongoose");

const serialSchema = new mongoose.Schema({
    serial: {
        type: String,
        require: true
    },
    type:{
        type:String,
        require:true
    },
    qrcode_id:{
        type:Number,
        require:true
    },
    product_id:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
    },
    company_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company'
    },
    parent_qrcode_id:{
        type:Number,
        default:-1
    }
});

const QRcode = mongoose.model("Serial", serialSchema);
module.exports = QRcode;