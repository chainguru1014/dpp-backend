// Talks DIRECTLY to the Impinj R700 over LLRP/TCP (port 5084, the reader's
// actual management interface — the reader has no separate REST API, see
// controllers/impinjRestController.ts's now-superseded attempt), instead of
// going through the .NET Octane-SDK reader-service that
// controllers/impinjController.ts proxies to. Uses the `llrpjs` npm
// package (pure-JS LLRP 1.0/1.1 client/encoder, no native deps) rather than
// hand-rolling the binary TLV framing ourselves.
//
// This mirrors the shape of impinjRestController.ts (status/connect/
// disconnect/start/stop/tags/recentTags/clearTags) so swapping which
// upstream the app eventually talks to is just a route-mount change, not
// a contract change. Same deal as the REST attempt: this is the thing
// being validated right now on the hosting server (which reaches the
// reader over a Tailscale subnet route), not yet a confirmed replacement
// for the .NET SDK proxy.
const { LLRPClient, LLRPCore } = require('llrpjs');

const READER_HOST = process.env.IMPINJ_LLRP_HOST || ''; // reader's LAN IP, reachable from this host via the Tailscale subnet route
const READER_PORT = Number(process.env.IMPINJ_LLRP_PORT || 5084);
const ROSPEC_ID = Number(process.env.IMPINJ_LLRP_ROSPEC_ID || 123);
const CONNECT_TIMEOUT_MS = 8000;
const TRANSACT_TIMEOUT_MS = 8000;

// Minimal "read everything, report immediately" ROSpec — the same shape as
// llrpjs's own bundled example and the standard LTK/sllurp sample ROSpec.
// AntennaIDs: [0] means "all antennas" per the LLRP spec.
function buildRoSpec() {
    return new LLRPCore.ROSpec({
        data: {
            ROSpecID: ROSPEC_ID,
            Priority: 0,
            CurrentState: 'Disabled',
            ROBoundarySpec: {
                ROSpecStartTrigger: { ROSpecStartTriggerType: 'Null' },
                ROSpecStopTrigger: { ROSpecStopTriggerType: 'Null', DurationTriggerValue: 0 },
            },
            AISpec: {
                AntennaIDs: [0],
                AISpecStopTrigger: { AISpecStopTriggerType: 'Null', DurationTrigger: 0 },
                InventoryParameterSpec: { InventoryParameterSpecID: 1234, ProtocolID: 'EPCGlobalClass1Gen2' },
            },
            ROReportSpec: {
                ROReportTrigger: 'Upon_N_Tags_Or_End_Of_AISpec',
                N: 1,
                TagReportContentSelector: {
                    EnableROSpecID: false,
                    EnableSpecIndex: false,
                    EnableInventoryParameterSpecID: false,
                    EnableAntennaID: true,
                    EnableChannelIndex: false,
                    EnablePeakRSSI: true,
                    EnableFirstSeenTimestamp: true,
                    EnableLastSeenTimestamp: true,
                    EnableTagSeenCount: false,
                    EnableAccessSpecID: false,
                },
            },
        },
    });
}

type TagRead = { epc: string; antennaId?: number; rssi?: number; seenAt: string };
const MAX_BUFFERED_TAGS = 2000;
let tagBuffer: TagRead[] = [];

let client: any = null;
let connected = false;

function attachTagReportListener(reader: any) {
    reader.on('RO_ACCESS_REPORT', (msg: any) => {
        let list = msg.getTagReportData();
        if (!Array.isArray(list)) list = [list];
        for (const tagReportData of list) {
            const epcParam = tagReportData.getEPCParameter?.();
            const epc = epcParam?.getEPC?.();
            if (!epc) continue;
            tagBuffer.push({
                epc,
                antennaId: tagReportData.getAntennaID?.()?.getAntennaID?.(),
                rssi: tagReportData.getPeakRSSI?.()?.getPeakRSSI?.(),
                seenAt: new Date().toISOString(),
            });
        }
        if (tagBuffer.length > MAX_BUFFERED_TAGS) {
            tagBuffer = tagBuffer.slice(tagBuffer.length - MAX_BUFFERED_TAGS);
        }
    });
    // The reader expects a KEEPALIVE_ACK promptly or it may drop the
    // connection as unresponsive.
    reader.on('KEEPALIVE', () => {
        reader.send(new LLRPCore.KEEPALIVE_ACK());
    });
    reader.on('disconnect', () => { connected = false; });
    reader.on('error', () => { connected = false; });
}

async function ensureConnected() {
    if (connected && client?.socketWritable) return client;
    if (!READER_HOST) throw Object.assign(new Error('IMPINJ_LLRP_HOST is not configured on this server'), { status: 500 });

    client = new LLRPClient({ host: READER_HOST, port: READER_PORT });
    attachTagReportListener(client);
    await client.connect();

    // The reader sends a READER_EVENT_NOTIFICATION right after the TCP
    // handshake to confirm the LLRP session itself succeeded (a bad
    // ConnectionAttemptEvent status here means "connected" at TCP level
    // but rejected at the protocol level, e.g. another client already
    // holds exclusive access).
    const notif = await client.recv(CONNECT_TIMEOUT_MS);
    if (!(notif instanceof LLRPCore.READER_EVENT_NOTIFICATION)) {
        throw new Error(`Unexpected message while confirming connection: ${notif?.getName?.() ?? notif}`);
    }
    const status = notif.getReaderEventNotificationData().getConnectionAttemptEvent()?.getStatus();
    if (status !== 'Success') {
        throw new Error(`Reader rejected the LLRP connection: ${status}`);
    }

    connected = true;
    return client;
}

exports.status = async (req: any, res: any) => {
    try {
        const reader = await ensureConnected();
        return res.status(200).json({ connected: true, host: READER_HOST, port: READER_PORT, bufferedTags: tagBuffer.length });
    } catch (error: any) {
        return res.status(error?.status || 502).json({ error: error?.message || 'Could not reach the Impinj R700 reader over LLRP' });
    }
};

exports.connect = async (req: any, res: any) => {
    try {
        await ensureConnected();
        return res.status(200).json({ ok: true });
    } catch (error: any) {
        return res.status(error?.status || 502).json({ error: error?.message || 'Could not connect to the Impinj R700 reader over LLRP' });
    }
};

exports.disconnect = async (req: any, res: any) => {
    try {
        if (client?.socketWritable) {
            await client.transact(new LLRPCore.CLOSE_CONNECTION(), TRANSACT_TIMEOUT_MS).catch(() => null);
            await client.disconnect();
        }
        connected = false;
        return res.status(200).json({ ok: true });
    } catch (error: any) {
        return res.status(502).json({ error: error?.message || 'Could not disconnect from the Impinj R700 reader' });
    }
};

exports.start = async (req: any, res: any) => {
    try {
        const reader = await ensureConnected();
        // Clean slate — mirrors impinjController.ts's "stop first" pattern
        // for the .NET proxy: an already-added ROSpec from a prior session
        // (crash, restart) would otherwise make ADD_ROSPEC fail.
        await reader.transact(new LLRPCore.DELETE_ROSPEC({ data: { ROSpecID: 0 } }), TRANSACT_TIMEOUT_MS);

        const roSpec = buildRoSpec();
        const addRsp = await reader.transact(new LLRPCore.ADD_ROSPEC().setROSpec(roSpec), TRANSACT_TIMEOUT_MS);
        const addStatus = addRsp?.getLLRPStatus?.()?.getStatusCode?.();
        if (addStatus && addStatus !== 'M_Success') {
            return res.status(502).json({ error: `ADD_ROSPEC failed: ${addStatus}` });
        }

        await reader.transact(new LLRPCore.ENABLE_ROSPEC({ data: { ROSpecID: ROSPEC_ID } }), TRANSACT_TIMEOUT_MS);
        const startRsp = await reader.transact(new LLRPCore.START_ROSPEC({ data: { ROSpecID: ROSPEC_ID } }), TRANSACT_TIMEOUT_MS);
        const startStatus = startRsp?.getLLRPStatus?.()?.getStatusCode?.();
        if (startStatus && startStatus !== 'M_Success') {
            return res.status(502).json({ error: `START_ROSPEC failed: ${startStatus}` });
        }

        tagBuffer = [];
        return res.status(200).json({ ok: true });
    } catch (error: any) {
        return res.status(error?.status || 502).json({ error: error?.message || 'Could not start the Impinj R700 reader over LLRP' });
    }
};

exports.stop = async (req: any, res: any) => {
    try {
        const reader = await ensureConnected();
        await reader.transact(new LLRPCore.STOP_ROSPEC({ data: { ROSpecID: ROSPEC_ID } }), TRANSACT_TIMEOUT_MS);
        await reader.transact(new LLRPCore.DELETE_ROSPEC({ data: { ROSpecID: ROSPEC_ID } }), TRANSACT_TIMEOUT_MS);
        return res.status(200).json({ ok: true });
    } catch (error: any) {
        return res.status(error?.status || 502).json({ error: error?.message || 'Could not stop the Impinj R700 reader over LLRP' });
    }
};

exports.tags = (req: any, res: any) => res.status(200).json(tagBuffer);

exports.recentTags = (req: any, res: any) => {
    const count = Math.max(1, Math.min(MAX_BUFFERED_TAGS, Number(req.query?.count) || 100));
    return res.status(200).json(tagBuffer.slice(-count));
};

exports.clearTags = (req: any, res: any) => {
    tagBuffer = [];
    res.status(200).json({ ok: true });
};
