const RfidRead = require('../models/rfidReadModel');
const AppError = require('../utils/appError');

// Keep ingested reads around for a minute max — well beyond any realistic
// polling window, just enough that a slow request doesn't miss a read.
const RETENTION_MS = 60 * 1000;

// Called by a store's RFID reader/gateway (Albert's hardware, once the
// bridge service between the reader/multiplexer and this backend exists)
// whenever it detects a tag. Until that gateway is wired up, this can be
// exercised directly for development, e.g.:
//   curl -X POST {API_BASE_URL}rfid/ingest -H "Content-Type: application/json" \
//     -d '{"epc":"E2003411B802011467256537","antennaId":"1","rssi":-53}'
exports.ingest = async (req: any, res: any, next: any) => {
    try {
        const { epc, antennaId, rssi, pcBits } = req.body || {};
        const normalizedEpc = String(epc || '').trim();
        if (!normalizedEpc) {
            return next(new AppError(400, 'fail', 'epc is required'));
        }
        const now = new Date();
        const doc = await RfidRead.create({
            epc: normalizedEpc,
            antennaId: antennaId != null ? String(antennaId) : '',
            rssi: rssi != null ? Number(rssi) : null,
            pcBits: pcBits ? String(pcBits) : '',
            seenAt: now,
            expiresAt: new Date(now.getTime() + RETENTION_MS)
        });
        res.status(201).json({ status: 'success', data: doc });
    } catch (error) {
        next(error);
    }
};

// Polled by the mobile app's Capture screen while RFID mode is selected —
// both "is at least one tag currently near the reader" and "what's the
// latest one to capture" come from this same query. Dedupes to the latest
// read per EPC so a tag sitting in range for the whole window isn't listed
// N times.
exports.recent = async (req: any, res: any, next: any) => {
    try {
        const windowSeconds = Math.max(1, Math.min(60, Number(req.query?.windowSeconds) || 5));
        const since = new Date(Date.now() - windowSeconds * 1000);
        const filter: any = { seenAt: { $gte: since } };
        if (req.query?.antennaId) {
            filter.antennaId = String(req.query.antennaId);
        }

        const reads = await RfidRead.find(filter).sort({ seenAt: -1 }).limit(200);
        const latestByEpc = new Map();
        for (const read of reads) {
            if (!latestByEpc.has(read.epc)) latestByEpc.set(read.epc, read);
        }
        const tags = [...latestByEpc.values()].sort((a: any, b: any) => b.seenAt - a.seenAt);

        res.status(200).json({ status: 'success', data: { tags } });
    } catch (error) {
        next(error);
    }
};
