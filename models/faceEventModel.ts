const mongoose = require('mongoose');

// FACEIO webhook events (ENROLL / AUTH), kept just long enough for the
// face sign-in endpoints to confirm that FACEIO's own servers reported the
// enrollment/authentication the app claims happened. Mongo's TTL monitor
// deletes each row ~10 minutes after it arrives.
const faceEventSchema = new mongoose.Schema({
    eventName: { type: String, required: true },
    facialId: { type: String, required: true, index: true },
    clientIp: { type: String, default: '' },
    payload: { type: mongoose.Schema.Types.Mixed },
    consumedAt: { type: Date },
    createdAt: { type: Date, default: Date.now, expires: 600 }
});

module.exports = mongoose.model('FaceEvent', faceEventSchema);
