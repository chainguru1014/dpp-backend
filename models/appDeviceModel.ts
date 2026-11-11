const mongoose = require("mongoose");

// A phone, tablet or browser the mobile app has finished a registration or
// sign-in on. The app makes up a random id once per install (kept in its own
// storage) and sends it here; when the app opens again, Start asks whether
// this id is known: yes = show Login, no = show the register flow. Also says
// whether an account used here has a face registered, so Login only shows
// Face login when it can work.
const appDeviceSchema = new mongoose.Schema({
    deviceId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    platform: { type: String },
    model: { type: String },
    osVersion: { type: String },
    appVersion: { type: String },
    userAgent: { type: String },
    // Every account that has finished registering or signing in here.
    accounts: [{
        _id: false,
        actorKind: { type: String, enum: ['User', 'Employee'] },
        actorId: { type: mongoose.Schema.Types.ObjectId },
        firstAt: { type: Date },
        lastAt: { type: Date }
    }],
    lastActorKind: { type: String },
    lastActorId: { type: mongoose.Schema.Types.ObjectId },
    lastSeenAt: { type: Date }
}, {
    timestamps: true
});

const AppDevice = mongoose.model("AppDevice", appDeviceSchema);
module.exports = AppDevice;
