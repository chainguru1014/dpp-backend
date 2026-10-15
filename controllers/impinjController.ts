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
const READER_SERVICE_BASE_URL = 'http://localhost:5284';
const REQUEST_TIMEOUT_MS = 8000;

async function forward(req: any, res: any, method: string, path: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const upstream = await fetch(`${READER_SERVICE_BASE_URL}${path}`, { method, signal: controller.signal });
        if (upstream.status === 204) {
            return res.status(204).send();
        }
        const data = await upstream.json().catch(() => null);
        return res.status(upstream.status).json(data);
    } catch (error: any) {
        const message = error?.name === 'AbortError'
            ? 'Timed out reaching the Impinj reader service'
            : (error?.message || 'Could not reach the Impinj reader service');
        return res.status(502).json({ error: message });
    } finally {
        clearTimeout(timer);
    }
}

exports.status = (req: any, res: any) => forward(req, res, 'GET', '/api/reader/status');
exports.connect = (req: any, res: any) => forward(req, res, 'POST', '/api/reader/connect');
exports.disconnect = (req: any, res: any) => forward(req, res, 'POST', '/api/reader/disconnect');
exports.start = (req: any, res: any) => forward(req, res, 'POST', '/api/reader/start');
exports.stop = (req: any, res: any) => forward(req, res, 'POST', '/api/reader/stop');
exports.tags = (req: any, res: any) => forward(req, res, 'GET', '/api/tags');
exports.recentTags = (req: any, res: any) => {
    const count = Math.max(1, Math.min(1000, Number(req.query?.count) || 100));
    return forward(req, res, 'GET', `/api/tags/recent?count=${count}`);
};
exports.clearTags = (req: any, res: any) => forward(req, res, 'DELETE', '/api/tags');
