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
    // Same {entity, type} shape as Company.processSteps (backend/models/
    // companyModel.ts) — reused here for the consumer app's Home page
    // location-type tiles, managed by the platform super admin instead of
    // a per-company Supervisor. `type` must be one of
    // CONSUMER_LOCATION_TYPE_KEYS (see platformSettingsController.ts).
    processSteps: {
        type: [{
            entity: { type: String, trim: true, default: '' },
            type: { type: String, trim: true, default: '' }
        }],
        default: []
    }
});

const PlatformSettings = mongoose.model("PlatformSettings", platformSettingsSchema);
module.exports = PlatformSettings;
