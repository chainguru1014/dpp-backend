// Talks DIRECTLY to the Impinj R700 over LLRP/TCP (port 5084, the reader's
// actual management interface — the reader has no separate REST API, see
// controllers/impinjRestController.ts's now-superseded attempt), instead of
// going through the .NET Octane-SDK reader-service that
// controllers/impinjController.ts proxies to. Uses the `llrpjs` npm
// package (pure-JS LLRP 1.0/1.1 client/encoder, no native deps) rather than
// hand-rolling the binary TLV framing ourselves.
//
// Response shapes here match app/src/native/impinjRfid.ts's ImpinjReaderStatus/
// ImpinjTagRead/ImpinjReaderSettings exactly (field-for-field, same as what
// the .NET proxy forwards) — not just impinjRestController.ts's looser shape
// — because this one IS wired into the app (see impinjRfid.ts's `impinj-llrp`
// base path), while impinjRestController.ts never was. Screens call
// getImpinjReaderStatus()/connectImpinjReader() expecting a 200 response
// with isConnected reflecting success/failure, never a thrown error for an
// ordinary "reader didn't answer" case — see CorporateScannerScreen.tsx's
// `if (!status.isConnected) throw new Error(status.lastError ...)` pattern.
const { LLRPClient, LLRPCore } = require('llrpjs');

let READER_HOST = process.env.IMPINJ_LLRP_HOST || ''; // reader's LAN IP, reachable from this host via the Tailscale subnet route
let READER_PORT = Number(process.env.IMPINJ_LLRP_PORT || 5084);
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

// Matches app/src/native/impinjRfid.ts's ImpinjTagRead exactly, plus an
// internal-only _lastSeenAtMs (stripped before responding) used for the
// "in view" freshness window and sort order — a local wall-clock stamp
// rather than trusting the reader-reported lastSeenTimeUtc for that,
// since this needs to work even if the reader's own clock/timestamp
// parameter turns out to be unreliable.
type TagRead = {
    epc: string;
    antennaPort: number | null;
    peakRssiInDbm: number | null;
    tagSeenCount: number | null;
    firstSeenTimeUtc: string | null;
    lastSeenTimeUtc: string | null;
    phaseAngleInRadians: number | null;
    _lastSeenAtMs: number;
};
// Keyed by EPC, not an append log — the reader re-reports the same tag on
// every inventory round while it's in range, so without dedup the same EPC
// would pile up repeatedly (seen live: duplicate rows, "New" badge on
// already-seen tags, and a sort that couldn't fix it because the real
// problem was duplicate rows, not wrong order).
let tagsByEpc = new Map<string, TagRead>();
// Matches the "in view" contract getImpinjTagsInView() already documents
// in app/src/native/impinjRfid.ts (CorporateScannerScreen's capture-enabled
// check depends on a tag currently being in range, not just ever seen).
const TAG_IN_VIEW_WINDOW_MS = 10000;

function stripInternal(tag: TagRead) {
    const { _lastSeenAtMs, ...rest } = tag;
    return rest;
}

let client: any = null;
let connected = false;
let started = false;
let lastError: string | null = null;
let lastErrorAtUtc: string | null = null;

function recordError(message: string) {
    lastError = message;
    lastErrorAtUtc = new Date().toISOString();
}

// The R700 only accepts one LLRP client at a time. If the app that started
// a read session stops calling /tags (closed, crashed, lost its network)
// without ever calling /stop or /disconnect, the session would otherwise
// sit open indefinitely — blocking every other phone/device with "a client
// initiated connection already exists" until someone notices and manually
// power-cycles the reader. This watchdog frees it automatically instead.
const TAG_POLL_IDLE_DISCONNECT_MS = 15000; // ~10x the app's own poll interval (RFID_POLL_MS = 1500ms)
const IDLE_WATCHDOG_INTERVAL_MS = 5000;
let lastTagsPollAtMs: number | null = null;

function markTagsPolled() {
    lastTagsPollAtMs = Date.now();
}

async function disconnectForIdle() {
    try {
        if (client?.socketWritable) {
            await client.transact(new LLRPCore.STOP_ROSPEC({ data: { ROSpecID: ROSPEC_ID } }), TRANSACT_TIMEOUT_MS).catch(() => null);
            await client.transact(new LLRPCore.DELETE_ROSPEC({ data: { ROSpecID: ROSPEC_ID } }), TRANSACT_TIMEOUT_MS).catch(() => null);
            await client.transact(new LLRPCore.CLOSE_CONNECTION(), TRANSACT_TIMEOUT_MS).catch(() => null);
            await client.disconnect().catch(() => {});
        }
    } catch {
        // Best effort — the goal is freeing the reader's slot, not a clean
        // LLRP teardown; fall through to resetting local state regardless.
    } finally {
        connected = false;
        started = false;
        lastTagsPollAtMs = null;
    }
}

const idleWatchdogTimer = setInterval(() => {
    if (!started || lastTagsPollAtMs == null) return;
    if (Date.now() - lastTagsPollAtMs < TAG_POLL_IDLE_DISCONNECT_MS) return;
    disconnectForIdle();
}, IDLE_WATCHDOG_INTERVAL_MS);
idleWatchdogTimer.unref?.();

// Matches app/src/native/impinjRfid.ts's ImpinjReaderStatus exactly.
// firmwareVersion/modelName/temperatureInCelsius are always null here —
// neither screen that consumes this (CorporateScannerScreen,
// ShipmentInspectionScreen) reads them, so GET_READER_CAPABILITIES (the
// LLRP message that would populate them) wasn't worth the extra round trip.
function buildStatus() {
    return {
        isConnected: connected && !!client?.socketWritable,
        isStarted: started,
        address: READER_HOST ? `${READER_HOST}:${READER_PORT}` : null,
        firmwareVersion: null,
        modelName: null,
        temperatureInCelsius: null,
        lastError,
        lastErrorAtUtc,
    };
}

// LLRP timestamps arrive as microseconds-since-epoch (possibly a BigInt via
// llrpjs's json-bigint dependency) — Number() handles both cleanly, and a
// microsecond epoch value is comfortably within Number.MAX_SAFE_INTEGER.
function microsToIso(micros: any): string | null {
    if (micros == null) return null;
    try {
        return new Date(Number(micros) / 1000).toISOString();
    } catch {
        return null;
    }
}

function microsFromTimestampParam(param: any): any {
    return param?.getMicroseconds ? param.getMicroseconds() : undefined;
}

function attachTagReportListener(reader: any) {
    reader.on('RO_ACCESS_REPORT', (msg: any) => {
        let list = msg.getTagReportData();
        if (!Array.isArray(list)) list = [list];
        const nowMs = Date.now();
        for (const tagReportData of list) {
            const epcParam = tagReportData.getEPCParameter?.();
            const epc = epcParam?.getEPC?.();
            if (!epc) continue;
            const existing = tagsByEpc.get(epc);
            const lastSeenTimeUtc = microsToIso(microsFromTimestampParam(tagReportData.getLastSeenTimestampUTC?.())) || new Date(nowMs).toISOString();
            tagsByEpc.set(epc, {
                epc,
                antennaPort: tagReportData.getAntennaID?.()?.getAntennaID?.() ?? null,
                peakRssiInDbm: tagReportData.getPeakRSSI?.()?.getPeakRSSI?.() ?? null,
                tagSeenCount: null,
                // Kept from the first sighting, not overwritten on repeat reads.
                firstSeenTimeUtc: existing?.firstSeenTimeUtc
                    ?? microsToIso(microsFromTimestampParam(tagReportData.getFirstSeenTimestampUTC?.()))
                    ?? lastSeenTimeUtc,
                lastSeenTimeUtc,
                phaseAngleInRadians: null,
                _lastSeenAtMs: nowMs,
            });
        }
    });
    // The reader expects a KEEPALIVE_ACK promptly or it may drop the
    // connection as unresponsive.
    reader.on('KEEPALIVE', () => {
        reader.send(new LLRPCore.KEEPALIVE_ACK());
    });
    reader.on('disconnect', () => { connected = false; started = false; });
    reader.on('error', () => { connected = false; started = false; });
}

async function ensureConnected() {
    if (connected && client?.socketWritable) return client;
    if (!READER_HOST) throw new Error('IMPINJ_LLRP_HOST is not configured on this server');

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

// status never attempts a connection itself — screens call this first,
// specifically to check current state before deciding whether to call
// connect() (see CorporateScannerScreen.tsx's handleConnectPress), so this
// just reflects in-memory state.
exports.status = (req: any, res: any) => res.status(200).json(buildStatus());

exports.connect = async (req: any, res: any) => {
    try {
        await ensureConnected();
    } catch (error: any) {
        recordError(error?.message || 'Could not connect to the Impinj R700 reader over LLRP');
    }
    return res.status(200).json(buildStatus());
};

exports.disconnect = async (req: any, res: any) => {
    try {
        if (client?.socketWritable) {
            await client.transact(new LLRPCore.CLOSE_CONNECTION(), TRANSACT_TIMEOUT_MS).catch(() => null);
            await client.disconnect();
        }
    } catch (error: any) {
        recordError(error?.message || 'Could not disconnect from the Impinj R700 reader');
    } finally {
        connected = false;
        started = false;
        lastTagsPollAtMs = null;
    }
    return res.status(200).json(buildStatus());
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
            throw new Error(`ADD_ROSPEC failed: ${addStatus}`);
        }

        await reader.transact(new LLRPCore.ENABLE_ROSPEC({ data: { ROSpecID: ROSPEC_ID } }), TRANSACT_TIMEOUT_MS);
        const startRsp = await reader.transact(new LLRPCore.START_ROSPEC({ data: { ROSpecID: ROSPEC_ID } }), TRANSACT_TIMEOUT_MS);
        const startStatus = startRsp?.getLLRPStatus?.()?.getStatusCode?.();
        if (startStatus && startStatus !== 'M_Success') {
            throw new Error(`START_ROSPEC failed: ${startStatus}`);
        }

        tagsByEpc = new Map();
        started = true;
        // Baseline the idle clock on start, not on the first poll — otherwise
        // the watchdog has no reference point until a /tags call happens to
        // land, which could itself be more than TAG_POLL_IDLE_DISCONNECT_MS
        // away from start() under a slow first request.
        markTagsPolled();
    } catch (error: any) {
        started = false;
        recordError(error?.message || 'Could not start the Impinj R700 reader over LLRP');
    }
    return res.status(200).json(buildStatus());
};

exports.stop = async (req: any, res: any) => {
    try {
        const reader = await ensureConnected();
        await reader.transact(new LLRPCore.STOP_ROSPEC({ data: { ROSpecID: ROSPEC_ID } }), TRANSACT_TIMEOUT_MS);
        await reader.transact(new LLRPCore.DELETE_ROSPEC({ data: { ROSpecID: ROSPEC_ID } }), TRANSACT_TIMEOUT_MS);
    } catch (error: any) {
        recordError(error?.message || 'Could not stop the Impinj R700 reader over LLRP');
    } finally {
        started = false;
        lastTagsPollAtMs = null;
    }
    return res.status(200).json(buildStatus());
};

// "Currently in view" — only tags re-read within the last
// TAG_IN_VIEW_WINDOW_MS, newest-first. This is what CorporateScannerScreen's
// Passing Tags card and capture-enabled check both rely on.
exports.tags = (req: any, res: any) => {
    markTagsPolled();
    const cutoff = Date.now() - TAG_IN_VIEW_WINDOW_MS;
    const inView = Array.from(tagsByEpc.values())
        .filter((t) => t._lastSeenAtMs >= cutoff)
        .sort((a, b) => b._lastSeenAtMs - a._lastSeenAtMs)
        .map(stripInternal);
    return res.status(200).json(inView);
};

// Full history since the last start()/clear, not windowed — every distinct
// EPC seen this session, newest-first, capped to `count`.
exports.recentTags = (req: any, res: any) => {
    markTagsPolled();
    const count = Math.max(1, Math.min(2000, Number(req.query?.count) || 100));
    const all = Array.from(tagsByEpc.values())
        .sort((a, b) => b._lastSeenAtMs - a._lastSeenAtMs)
        .slice(0, count)
        .map(stripInternal);
    return res.status(200).json(all);
};

exports.clearTags = (req: any, res: any) => {
    tagsByEpc = new Map();
    res.status(200).json({ ok: true });
};

// Matches app/src/native/impinjRfid.ts's ImpinjReaderSettings — only
// ipAddress/port are actually backed by real state (READER_HOST/PORT);
// the rest are fixed/derived values so the settings form (CorporateScannerScreen)
// has something sensible to show instead of blanks. Changing ipAddress/port
// here drops the current connection, since a live LLRP session can't be
// repointed at a different host.
function buildSettings() {
    return {
        readerName: 'Impinj R700 (LLRP)',
        ipAddress: READER_HOST,
        port: READER_PORT,
        connectionTimeoutMs: CONNECT_TIMEOUT_MS,
        autoReconnect: false,
        reconnectIntervalMs: 5000,
        maxReconnectAttempts: 0,
        unlimitedReconnectAttempts: false,
        autoConnectOnStartup: false,
        availableAntennaPorts: null,
        enabledAntennaPorts: null,
    };
}

exports.getSettings = (req: any, res: any) => res.status(200).json(buildSettings());

exports.updateSettings = async (req: any, res: any) => {
    const body = req.body || {};
    const nextHost = typeof body.ipAddress === 'string' && body.ipAddress.trim() ? body.ipAddress.trim() : READER_HOST;
    const nextPort = Number(body.port) > 0 ? Number(body.port) : READER_PORT;
    if (nextHost !== READER_HOST || nextPort !== READER_PORT) {
        if (client?.socketWritable) {
            await client.disconnect().catch(() => {});
        }
        connected = false;
        started = false;
        READER_HOST = nextHost;
        READER_PORT = nextPort;
    }
    return res.status(200).json(buildSettings());
};
