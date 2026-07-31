const mongoose = require("mongoose");

// Generic atomic sequence counter, keyed by an arbitrary string. Reused for
// unrelated sequences (per-company terminal IDs, per-company/step/day ref
// numbers) rather than building a separate counter mechanism for each —
// callers pick the key shape (e.g. "terminal:{company_id}" or
// "ref:{company_id}:{stepIndex}:{dateKey}").
const counterSchema = new mongoose.Schema({
    key: {
        type: String,
        required: true,
        unique: true
    },
    seq: {
        type: Number,
        default: 0
    }
});

const Counter = mongoose.model("Counter", counterSchema);

// Atomically increments and returns the next sequence number for `key`,
// creating the counter on first use. Safe under concurrent callers.
const getNextSequence = async (key: string): Promise<number> => {
    const doc = await Counter.findOneAndUpdate(
        { key },
        { $inc: { seq: 1 } },
        { upsert: true, new: true }
    );
    return doc.seq;
};

module.exports = { Counter, getNextSequence };
