const mongoose = require("mongoose");

// Singleton-per-key document for platform-wide (not per-Company) config.
// Currently only one key is used ('consumerLocationSteps'), but the shape
// allows more without a schema migration — same generic-key pattern as
// counterModel.ts.
const platformSettingsSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        unique: true
    },
    // Name only (no type/category, unlike Company.processSteps) — the
    // consumer app's Home page location tiles, managed by the platform
    // super admin instead of a per-company Supervisor.
    processSteps: {
        type: [{
            entity: { type: String, trim: true, default: '' }
        }],
        default: []
    },
    // key 'itemCategories' — product item categories managed by the super
    // admin (see utils/itemCategories.ts).
    itemCategories: {
        type: [{
            _id: false,
            key: { type: String, trim: true, required: true },
            label: { type: String, trim: true, required: true },
            skuPrefix: { type: String, trim: true, default: '' }
        }],
        default: undefined
    }
});

const PlatformSettings = mongoose.model("PlatformSettings", platformSettingsSchema);
module.exports = PlatformSettings;
