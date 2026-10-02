// The four end-of-life services a product can offer. One shape for all four,
// so the admin form, the previews and the app draw them the same way. The
// same normalizer lives in the admin panel (src/utils/circularity.js) and
// the app (src/utils/circularity.ts) — keep the three in step.
const SERVICE_KINDS = ['repair', 'resell', 'rent', 'recycle'];

// Each service's web link as products stored it before `circularity` existed.
const LEGACY_URL_FIELD: any = { repair: 'repairUrl', resell: 'reuseUrl', rent: 'rentalUrl', recycle: 'disposeUrl' };

const MAX_STEPS = 8;
const text = (value: any, max: number) => String(value == null ? '' : value).trim().slice(0, max);

const normalizeService = (raw: any, legacyUrl: string) => {
    const s = raw && typeof raw === 'object' ? raw : {};
    const url = text(s.url, 500) || text(legacyUrl, 500);
    const steps = (Array.isArray(s.steps) ? s.steps : [])
        .map((step: any) => text(step, 240))
        .filter(Boolean)
        .slice(0, MAX_STEPS);
    return {
        // A product that only ever had the link still offers the service.
        enabled: s.enabled === undefined ? !!url : !!s.enabled,
        summary: text(s.summary, 500),
        steps,
        partnerName: text(s.partnerName, 120),
        url,
        email: text(s.email, 200),
        phone: text(s.phone, 60),
        cost: text(s.cost, 160),
        time: text(s.time, 160),
        note: text(s.note, 500),
        // Shoppers can send a request for this service from the app.
        acceptRequests: !!s.acceptRequests
    };
};

const normalizeCircularity = (raw: any, disposal: any = {}) => {
    const out: any = {};
    SERVICE_KINDS.forEach((kind) => {
        out[kind] = normalizeService(raw && raw[kind], disposal && disposal[LEGACY_URL_FIELD[kind]]);
    });
    return out;
};

module.exports = { SERVICE_KINDS, LEGACY_URL_FIELD, normalizeCircularity };
