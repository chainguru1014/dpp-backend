// Minimal client for the self-hosted CompreFace recognition service
// (installed by deploy/compreface/install.sh, listening on 127.0.0.1 only).
// Each face-login user is one CompreFace "subject" named by their User _id;
// CompreFace keeps only the face embedding, never the photo
// (save_images_to_db=false).
const fetch = require('node-fetch');

const baseUrl = () => String(process.env.COMPREFACE_URL || '').replace(/\/+$/, '');
const apiKey = () => String(process.env.COMPREFACE_API_KEY || '');

const isConfigured = () => !!(baseUrl() && apiKey());

// Cosine-style similarity (0..1) a match must reach to count as the same person.
const similarityThreshold = () => {
    const n = Number(process.env.COMPREFACE_SIMILARITY);
    return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.9;
};

/** Accepts a data URL or bare base64; returns bare base64 or null if it isn't a plausible image. */
const toBase64Image = (image: any): string | null => {
    if (typeof image !== 'string') return null;
    const b64 = image.replace(/^data:image\/(jpeg|jpg|png|webp);base64,/i, '').trim();
    if (b64.length < 2000 || b64.length > 4 * 1024 * 1024) return null;
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(b64)) return null;
    return b64;
};

const call = async (path: string, method: string, body?: any) => {
    const r = await fetch(`${baseUrl()}/api/v1/recognition${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey() },
        body: body ? JSON.stringify(body) : undefined,
        timeout: 20000
    });
    const j: any = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body: j };
};

// CompreFace error code 28 = "No face is found in the given image".
const isNoFace = (res: any) => res?.body?.code === 28;

/**
 * Faces in the photo with their best-matching subject.
 * Returns { faces: number, subject: string|null, similarity: number } or
 * { error: 'noFace' | 'failed' }.
 */
const recognize = async (b64: string) => {
    const res = await call('/recognize?limit=0&prediction_count=1&det_prob_threshold=0.8', 'POST', { file: b64 });
    if (isNoFace(res)) return { error: 'noFace' as const };
    if (!res.ok) return { error: 'failed' as const };
    const faces = Array.isArray(res.body?.result) ? res.body.result : [];
    if (!faces.length) return { error: 'noFace' as const };
    const best = faces[0]?.subjects?.[0];
    return {
        faces: faces.length,
        subject: best?.subject ? String(best.subject) : null,
        similarity: Number(best?.similarity) || 0
    };
};

/** Stores this photo's face as an example of `subject`. */
const addFace = async (subject: string, b64: string) => {
    const res = await call(`/faces?subject=${encodeURIComponent(subject)}&det_prob_threshold=0.8`, 'POST', { file: b64 });
    if (isNoFace(res)) return { error: 'noFace' as const };
    return res.ok ? { ok: true } : { error: 'failed' as const };
};

/** Forgets every face stored for `subject`. */
const deleteSubject = async (subject: string) => {
    try {
        await call(`/subjects/${encodeURIComponent(subject)}`, 'DELETE');
    } catch (err) {
        console.error('CompreFace deleteSubject failed:', err);
    }
};

module.exports = { isConfigured, similarityThreshold, toBase64Image, recognize, addFace, deleteSubject };
