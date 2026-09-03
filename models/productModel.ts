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
    // @deprecated Free-text description — no longer shown in the consumer app
    // (Key Highlights uses detailFacts + the structured fields below instead).
    detail: {
        type: String,
    },
    // Consumer product-facts (Overview / Lifecycle > Details / Product Summary).
    productType: { type: String, default: '' },
    color: { type: String, default: '' },
    size: { type: String, default: '' },
    manufactureDate: { type: String, default: '' },
    // Warranty (Product Summary): status label + how many years it stays valid
    // from the date the product was registered.
    warrantyStatus: { type: String, default: '' },
    warrantyValidYears: { type: Number, default: 0 },
    // Structured product-detail facts shown as icon rows on the product card
    // (Material / Fit / Wash / Durability / Traceable product identity) —
    // additive alongside the free-text `detail` field above, not a replacement.
    detailFacts: {
        material: { type: String, default: '' },
        fit: { type: String, default: '' },
        wash: { type: String, default: '' },
        durability: { type: String, default: '' },
        traceableIdentity: { type: String, default: '' }
    },
    // Fixed category list (dashboard groups/filters by this) — mirrors the
    // pattern used for process-step "type" in companyController.ts.
    itemCategory: {
        type: String,
        enum: ['denim', 'tops', 'bottoms', 'outerwear', 'others'],
        default: 'others'
    },
    // Free-text style/SKU code (e.g. "DNM-2501-01"), shown on the dashboard's
    // Traceability Overview table and the products list.
    skuStyleNumber: {
        type: String,
        default: ''
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
        },
        // Optional wide banner shown on the Brand Detail page (app).
        coverUrl: {
            type: String,
            default: ''
        }
    },
    // Certification badge names shown on the Lifecycle > Materials tab.
    certifications: [{ type: String }],
    // Headline sustainability figures shown on the Lifecycle > Dispose tab
    // (free-text so brands can include units, e.g. "12.4 kg", "320 L").
    sustainabilityImpact: {
        co2Avoided: { type: String, default: '' },
        waterSaved: { type: String, default: '' },
        energySaved: { type: String, default: '' }
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
    // Mirrors printed_amount above, but for Security QR codes — a separate
    // counter because Security QR codes are their own id space
    // (security_qrcode_id, not qrcode_id — see securityQRCodeModel).
    security_printed_amount: {
        type: Number,
        default: 0
    },
    // Same idea again, one counter per externally-facing identifier type
    // (barcode/nfc/rfid/gs1dl — see productIdentifierModel) since each type
    // is its own printable list on the Generate & Print page.
    identifier_printed_amounts: {
        barcode: { type: Number, default: 0 },
        nfc: { type: Number, default: 0 },
        rfid: { type: Number, default: 0 },
        gs1dl: { type: Number, default: 0 }
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
            percent: { type: Number },
            // Optional country of origin for this material (Lifecycle > Materials).
            origin: { type: String, default: '' }
        }]
    },
    maintenance: {
        iconIds: { type: Array, default: [] },
        description: { type: String, default: '' },
        // Optional bullet-point care tips (Lifecycle > Care).
        tips: [{ type: String }]
    },
    disposal: {
        repairUrl: { type: String, default: '' },
        reuseUrl: { type: String, default: '' },
        rentalUrl: { type: String, default: '' },
        disposeUrl: { type: String, default: '' }
    },
    traceabilityEsg: {
        madeIn: { type: String, default: '' },
        // Explicit country of origin (Lifecycle > Traceability); falls back to madeIn.
        originCountry: { type: String, default: '' },
        materialOrigins: [{
            material: { type: String },
            companyName: { type: String },
            country: { type: String, default: '' }
        }],
        shippingLog: { type: String, default: '' },
        distance: { type: String, default: '' },
        co2Production: { type: String, default: '' },
        co2Transportation: { type: String, default: '' },
        // Shipping route detail (Lifecycle > Traceability / Journey > Transportation).
        route: {
            origin: { type: String, default: '' },
            destination: { type: String, default: '' },
            mode: { type: String, default: '' },
            emissions: { type: String, default: '' }
        }
    }
}, { timestamps: true });

const Product = mongoose.model("Product", productSchema);
module.exports = Product;