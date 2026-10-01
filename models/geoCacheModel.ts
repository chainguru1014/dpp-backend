const mongoose = require("mongoose");

// Place name -> coordinates, remembered so each place ("Colombo", "Sri
// Lanka") is looked up from the geocoding service only once. `found: false`
// rows remember names the service did not recognise, so they are not asked
// for again on every page view.
const geoCacheSchema = new mongoose.Schema({
    query: { type: String, required: true, unique: true },
    found: { type: Boolean, default: false },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null }
}, { timestamps: true });

module.exports = mongoose.model("GeoCache", geoCacheSchema);
