const fetch = require('node-fetch');

// Proxies the DPP app's Impinj RFID calls to the reader-service (a small
// Octane SDK HTTP API, see /rfid-reader-service at the repo root) running
// on localhost on this same hosting server. The app itself can't call
// "localhost" directly for this — on a staff member's phone that would
// resolve to the phone, not the server — so this backend, which actually
// runs on the same machine as the reader-service, forwards the call.
//
// Request/response shapes are passed through as-is (the reader-service's
// own {error} convention on non-2xx matches what app/src/native/impinjRfid.ts
// already expects), except for a connectivity failure to the reader-service
// itself, which is reported the same way so the app's error handling
// doesn't need to special-case "backend unreachable" vs "reader unreachable".
//
// Explicit 127.0.0.1, not "localhost": confirmed live that `curl
// localhost:5284/...` from a shell on the hosting server works instantly,
// but this same fetch() call from the Node process hung until our own
// 8s timeout. Classic IPv4/IPv6 localhost-resolution mismatch — the
// reader-service is only actually bound to the IPv4 loopback address, and
// Node's DNS resolution for the bare hostname "localhost" was picking the
// IPv6 one (::1), which nothing answers on. Pinning the literal IPv4
// address sidesteps the resolution step entirely.
const READER_SERVICE_BASE_URL = 'http://127.0.0.1:5284';
// Connect/status calls can involve the Octane SDK talking live to the
// physical R700 (not just returning cached state), which can take longer
// than a typical API call — 8s was cutting that off. The app's own
// REQUEST_TIMEOUT_MS (src/native/impinjRfid.ts) is set well above this one
// (and above this file's own start() retry budget below) so it doesn't
// give up before this backend call would.
const REQUEST_TIMEOUT_MS = 20000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function callReaderService(method: string, path: string): Promise<{ status: number; body: any }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const upstream = await fetch(`${READER_SERVICE_BASE_URL}${path}`, { method, signal: controller.signal });
        if (upstream.status === 204) {
            return { status: 204, body: null };
        }
        const data = await upstream.json().catch(() => null);
        return { status: upstream.status, body: data };
    } catch (error: any) {
        const message = error?.name === 'AbortError'
            ? 'Timed out reaching the Impinj reader service'
            : (error?.message || 'Could not reach the Impinj reader service');
        return { status: 502, body: { error: message } };
    } finally {
        clearTimeout(timer);
    }
}

function sendResult(res: any, result: { status: number; body: any }) {
    if (result.status === 204) return res.status(204).send();
    return res.status(result.status).json(result.body);
}

async function forward(req: any, res: any, method: string, path: string) {
    return sendResult(res, await callReaderService(method, path));
}

exports.status = (req: any, res: any) => forward(req, res, 'GET', '/api/reader/status');
exports.connect = (req: any, res: any) => forward(req, res, 'POST', '/api/reader/connect');
exports.disconnect = (req: any, res: any) => forward(req, res, 'POST', '/api/reader/disconnect');

// start() has been seen to fail with a transient LLRP-level error
// ("A timeout occurred while sending the message: ENABLE_ROSPEC" — the
// reader not acknowledging the "begin reading" command in time, not a
// connectivity problem; the reader-service responds normally, it's just an
// error response). That kind of thing is often momentary — the reader busy
// finishing a prior operation, a brief hiccup — so retry once more a couple
// seconds later before actually giving up, rather than making a staff
// member tap Connect again themselves for something that would have
// resolved itself.
const START_RETRY_ATTEMPTS = 2;
const START_RETRY_DELAY_MS = 2000;

exports.start = async (req: any, res: any) => {
    // Always stop first. A previous session can leave the reader's ROSpec
    // genuinely Active server-side even after our own client state has
    // forgotten about it entirely (e.g. a page refresh, or just tapping
    // Connect again) — Octane/LLRP refuses to start an already-Active
    // ROSpec: seen live as "Cannot start ROSpec ... in state Active".
    // Stopping first guarantees a clean slate; stopping an already-stopped
    // reader is harmless, so its result is ignored either way.
    await callReaderService('POST', '/api/reader/stop');
    let result = await callReaderService('POST', '/api/reader/start');
    for (let attempt = 1; attempt < START_RETRY_ATTEMPTS && result.status >= 500; attempt++) {
        await sleep(START_RETRY_DELAY_MS);
        result = await callReaderService('POST', '/api/reader/start');
    }
    return sendResult(res, result);
};

exports.stop = (req: any, res: any) => forward(req, res, 'POST', '/api/reader/stop');
exports.tags = (req: any, res: any) => forward(req, res, 'GET', '/api/tags');
exports.recentTags = (req: any, res: any) => {
    const count = Math.max(1, Math.min(1000, Number(req.query?.count) || 100));
    return forward(req, res, 'GET', `/api/tags/recent?count=${count}`);
};
exports.clearTags = (req: any, res: any) => forward(req, res, 'DELETE', '/api/tags');
