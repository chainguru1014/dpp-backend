const mongoose = require("mongoose");

// Ephemeral buffer of recent RFID tag detections coming from a store's
// reader/multiplexer gateway (Albert's RFIDspan hardware, once its bridge
// service exists) — polled by the mobile app's Capture flow to check "is a
// tag currently near the reader" and to resolve the latest one on Capture.
// Auto-expires via the TTL index below; this is NOT the system of record
// for tag history (that remains ProductIdentifier/PMC + CaptureRecord once
// an actual capture is made).
const rfidReadSchema = new mongoose.Schema({
    epc: { type: String, required: true },
    antennaId: { type: String, default: '' },
    rssi: { type: Number, default: null },
    pcBits: { type: String, default: '' },
    seenAt: { type: Date, default: Date.now },
    // TTL cleanup — reads are irrelevant to the polling window (a few
    // seconds) well before this fires; kept a bit longer only so a slow
    // client request doesn't miss a read that just landed.
    expiresAt: { type: Date, required: true, expires: 0 }
});

rfidReadSchema.index({ seenAt: -1 });
rfidReadSchema.index({ antennaId: 1, seenAt: -1 });

const RfidRead = mongoose.model("RfidRead", rfidReadSchema);
module.exports = RfidRead;
