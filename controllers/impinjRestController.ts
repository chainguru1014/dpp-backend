const https = require('https');
const fetch = require('node-fetch');

// Talks DIRECTLY to the Impinj R700's own built-in REST API (the reader's
// firmware exposes this itself — see Impinj's "Reader REST API" guide),
// instead of going through the separate .NET Octane-SDK reader-service that
// controllers/impinjController.ts proxies to. This is the thing being
// validated right now: the hosting server reaches the reader's LAN IP over
// a Tailscale subnet route (the reader itself is not Tailscale-joined —
// a friend's laptop on the reader's LAN is, and advertises that subnet).
//
// If this checks out end-to-end, the app could eventually call these same
// REST semantics without this backend having to also run/maintain the
// .NET SDK process — but the app still can't reach the reader's LAN IP
// directly today, so until/unless that changes this stays a backend-side
// proxy too, just to a different upstream.
//
// Endpoint paths below follow the documented Impinj Reader REST API v1
// shape (profiles/inventory/presets/{preset}/start|stop, status/reader,
// data/stream for tag events). These are NOT yet confirmed against this
// specific reader/firmware — that confirmation is the point of this round
// of testing. If a path 404s or responds with an unexpected shape when
// tested for real, adjust the *_PATH constants below; the request/response
// plumbing underneath should not need to change.
const READER_HOST = process.env.IMPINJ_REST_HOST || ''; // reader's LAN IP, reachable from this host via the Tailscale subnet route
const READER_PORT = process.env.IMPINJ_REST_PORT || '443';
const READER_USERNAME = process.env.IMPINJ_REST_USERNAME || 'root';
const READER_PASSWORD = process.env.IMPINJ_REST_PASSWORD || 'impinj123';
// R700s ship with a self-signed cert on the management/REST interface —
// there's no CA-signed cert to verify against, so TLS verification is off
// by default. Set IMPINJ_REST_REJECT_UNAUTHORIZED=true if the reader's cert
// is ever replaced with one that should be verified.
const REJECT_UNAUTHORIZED = process.env.IMPINJ_REST_REJECT_UNAUTHORIZED === 'true';
const INVENTORY_PRESET = process.env.IMPINJ_REST_PRESET || 'default';

const BASE_URL = () => `https://${READER_HOST}:${READER_PORT}/api/v1`;
const STATUS_PATH = '/status/reader';
const START_PATH = () => `/profiles/inventory/presets/${INVENTORY_PRESET}/start`;
const STOP_PATH = () => `/profiles/inventory/presets/${INVENTORY_PRESET}/stop`;
const STREAM_PATH = '/data/stream';

const REQUEST_TIMEOUT_MS = 15000;
// Rolling buffer of tag-inventory events collected from the reader's SSE
// stream while an inventory run is active — mirrors the "recent tags" shape
// the app/other backend proxy already expose, so callers don't need to
// know this one is fed by a push stream instead of a poll.
const MAX_BUFFERED_TAGS = 2000;
let tagBuffer: Array<{ epc: string; antennaPort?: number; rssi?: number; seenAt: string }> = [];
let streamRequest: any = null;

function httpsAgent() {
    return new https.Agent({ rejectUnauthorized: REJECT_UNAUTHORIZED });
}

function authHeader() {
    const token = Buffer.from(`${READER_USERNAME}:${READER_PASSWORD}`).toString('base64');
    return `Basic ${token}`;
}

function configError() {
    return { status: 500, body: { error: 'IMPINJ_REST_HOST is not configured on this server' } };
}

async function callReader(method: string, path: string, body?: any): Promise<{ status: number; body: any }> {
    if (!READER_HOST) return configError();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const upstream = await fetch(`${BASE_URL()}${path}`, {
            method,
            agent: httpsAgent(),
            signal: controller.signal,
            headers: {
                Authorization: authHeader(),
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        if (upstream.status === 204) return { status: 204, body: null };
        const text = await upstream.text();
        let data: any = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        return { status: upstream.status, body: data };
    } catch (error: any) {
        const message = error?.name === 'AbortError'
            ? 'Timed out reaching the Impinj R700 reader'
            : (error?.message || 'Could not reach the Impinj R700 reader');
        return { status: 502, body: { error: message } };
    } finally {
        clearTimeout(timer);
    }
}

function sendResult(res: any, result: { status: number; body: any }) {
    if (result.status === 204) return res.status(204).send();
    return res.status(result.status).json(result.body);
}

// Opens (if not already open) a long-lived HTTPS request to the reader's
// SSE tag-event stream and parses "data: {...}" frames as they arrive,
// pushing parsed tag reads into tagBuffer. One subscription is reused for
// the whole process — tags/recentTags just read out of the buffer.
function ensureStreamSubscribed() {
    if (streamRequest || !READER_HOST) return;
    let pending = '';
    const req = https.request(
        {
            hostname: READER_HOST,
            port: Number(READER_PORT),
            path: STREAM_PATH,
            method: 'GET',
            agent: httpsAgent(),
            headers: { Authorization: authHeader(), Accept: 'text/event-stream' },
        },
        (upstream: any) => {
            upstream.setEncoding('utf8');
            upstream.on('data', (chunk: string) => {
                pending += chunk;
                let boundary = pending.indexOf('\n\n');
                while (boundary !== -1) {
                    const rawEvent = pending.slice(0, boundary);
                    pending = pending.slice(boundary + 2);
                    boundary = pending.indexOf('\n\n');
                    const dataLine = rawEvent
                        .split('\n')
                        .find((line) => line.startsWith('data:'));
                    if (!dataLine) continue;
                    try {
                        const payload = JSON.parse(dataLine.slice('data:'.length).trim());
                        const epc = payload?.epc || payload?.epcHex || payload?.idHex;
                        if (!epc) continue;
                        tagBuffer.push({
                            epc,
                            antennaPort: payload?.antennaPort,
                            rssi: payload?.peakRssi ?? payload?.rssi,
                            seenAt: new Date().toISOString(),
                        });
                        if (tagBuffer.length > MAX_BUFFERED_TAGS) {
                            tagBuffer = tagBuffer.slice(tagBuffer.length - MAX_BUFFERED_TAGS);
                        }
                    } catch {
                        // Not a JSON tag-event frame (e.g. a keep-alive comment) — ignore.
                    }
                }
            });
            upstream.on('end', () => { streamRequest = null; });
            upstream.on('error', () => { streamRequest = null; });
        },
    );
    req.on('error', () => { streamRequest = null; });
    req.end();
    streamRequest = req;
}

function unsubscribeStream() {
    if (streamRequest) {
        try { streamRequest.destroy(); } catch { /* already closed */ }
        streamRequest = null;
    }
}

exports.status = async (req: any, res: any) => sendResult(res, await callReader('GET', STATUS_PATH));

// Pure REST has no persistent "connection" to open — this just confirms
// the reader is reachable and answering, the same role connect() plays
// for the .NET-SDK proxy.
exports.connect = async (req: any, res: any) => sendResult(res, await callReader('GET', STATUS_PATH));

exports.disconnect = async (req: any, res: any) => {
    unsubscribeStream();
    sendResult(res, { status: 200, body: { ok: true } });
};

exports.start = async (req: any, res: any) => {
    const result = await callReader('POST', START_PATH());
    if (result.status < 300) ensureStreamSubscribed();
    return sendResult(res, result);
};

exports.stop = async (req: any, res: any) => {
    const result = await callReader('POST', STOP_PATH());
    unsubscribeStream();
    return sendResult(res, result);
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
