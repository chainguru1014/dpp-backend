const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
    company_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company'
    },
    // Legacy whole-product owner pointer. Ownership is now tracked per-unit in the
    // ProductHolding ledger (see utils/ownership.getPrimaryOwner / moveHolding);
    // this field is retained for backward compatibility only.
    current_owner: {
        kind: {
            type: String,
            enum: ['Company', 'User'],
            default: 'Company'
        },
        id: {
            type: mongoose.Schema.Types.ObjectId
        }
    },
    name: {
        type: String,
        require: true
    },
    model: {
        type: String,
    },
    detail: {
        type: String,
    },
    brandInfo: {
        name: {
            type: String,
            required: true,
            trim: true
        },
        detail: {
            type: String,
            required: true,
            trim: true
        },
        websiteUrl: {
            type: String,
            required: true,
            trim: true
        },
        logoUrl: {
            type: String,
            required: true,
            trim: true
        }
    },
    images: {
        type: Array,
    },
    files: {
        type: Array,
    },
    videos: {
        type: Array,
    },
    serials:{
        type:Array
    },
    warrantyAndGuarantee: {
        images: {
            type: Array
        },
        files: {
            type: Array
        },
        videos: {
            type: Array
        },
        warranty: {
            period: {
                type: Number
            },
            unit: {
                type: Number
            },
            notime: {
                type: Boolean
            },
            lifetime: {
                type: Boolean
            }
        },
        guarantee: {
            period: {
                type: Number
            },
            unit: {
                type: Number
            },
            notime: {
                type: Boolean
            },
            lifetime: {
                type: Boolean
            }
        }
    },
    manualsAndCerts: {
        images: {
            type: Array
        },
        files: {
            type: Array
        },
        videos: {
            type: Array
        },
        public: {
            type: String
        },
        private: {
            type: String
        }
    },
    status: {
        type: String,
        default: ""
    },
    contract_address: {
        type: Array
    },
    total_minted_amount: {
        type: Number,
        default: 0
    },
    printed_amount: {
        type: Number,
        default: 0
    },
    is_deleted: {
        type: Boolean,
        default: false
    },
    parent: {
        type: mongoose.Schema.Types.ObjectId
    },
    parentCount:{
        type:Number,
        default:0
    },
    materialSize: {
        size: { type: String, default: '' },
        materials: [{
            material: { type: String },
            percent: { type: Number }
        }]
    },
    maintenance: {
        iconIds: { type: Array, default: [] },
        description: { type: String, default: '' }
    },
    disposal: {
        repairUrl: { type: String, default: '' },
        reuseUrl: { type: String, default: '' },
        rentalUrl: { type: String, default: '' },
        disposeUrl: { type: String, default: '' }
    },
    traceabilityEsg: {
        madeIn: { type: String, default: '' },
        materialOrigins: [{
            material: { type: String },
            companyName: { type: String }
        }],
        shippingLog: { type: String, default: '' },
        distance: { type: String, default: '' },
        co2Production: { type: String, default: '' },
        co2Transportation: { type: String, default: '' }
    }
});

const Product = mongoose.model("Product", productSchema);
module.exports = Product;