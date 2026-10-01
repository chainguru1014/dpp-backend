const fetch = require('node-fetch');
const GeoCache = require('../models/geoCacheModel');

// The lifecycle a brand entered for a product (where its materials come
// from, where it was made, how it was shipped), as an ordered list of steps
// with map coordinates — shown on Product Activity beside the scans and
// work steps that were actually recorded.

const TIMEOUT_MS = 4000;
// Asking for a name not answered before goes to the public OpenStreetMap
// geocoder, which allows about one request a second; a product has only a
// handful of places and each is remembered, so this is paid once per place.
const MAX_NEW_LOOKUPS = 8;

const lookupOnline = async (query: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=en&q=${encodeURIComponent(query)}`,
            { headers: { 'User-Agent': 'DPP-Application/1.0', Accept: 'application/json' }, signal: controller.signal }
        );
        if (!res.ok) return undefined;
        const data = await res.json();
        const hit = Array.isArray(data) ? data[0] : null;
        if (!hit) return null;
        const latitude = Number(hit.lat);
        const longitude = Number(hit.lon);
        return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
    } catch (e) {
        // undefined = the service could not be reached (not remembered, so it is tried again later)
        return undefined;
    } finally {
        clearTimeout(timer);
    }
};

/**
 * Coordinates for each place name, from the cache where possible.
 * Returns a Map of lowercased name -> { latitude, longitude } for the names
 * that could be placed; never throws.
 */
const geocodePlaces = async (names: string[]) => {
    const wanted = Array.from(new Set(names.map((n) => String(n || '').trim().toLowerCase()).filter(Boolean)));
    const placed = new Map<string, { latitude: number; longitude: number }>();
    if (!wanted.length) return placed;
    try {
        const cached = await GeoCache.find({ query: { $in: wanted } }).lean();
        const known = new Set<string>();
        cached.forEach((row: any) => {
            known.add(row.query);
            if (row.found) placed.set(row.query, { latitude: row.latitude, longitude: row.longitude });
        });
        let lookups = 0;
        for (const query of wanted) {
            if (known.has(query) || lookups >= MAX_NEW_LOOKUPS) continue;
            if (lookups > 0) await new Promise((resolve) => setTimeout(resolve, 1100));
            lookups++;
            const hit = await lookupOnline(query);
            if (hit === undefined) continue;
            if (hit) placed.set(query, hit);
            await GeoCache.updateOne(
                { query },
                { $set: { query, found: !!hit, latitude: hit?.latitude ?? null, longitude: hit?.longitude ?? null } },
                { upsert: true }
            ).catch(() => {});
        }
    } catch (error) {
        console.error('geocodePlaces failed:', error);
    }
    return placed;
};

/**
 * The product's lifecycle steps in order: materials, manufacturing,
 * shipping, arrival. Each: { stage, title, detail, placeName, latitude,
 * longitude } — coordinates are null when the place could not be found.
 */
const buildProductLifecycle = async (product: any) => {
    const p = product?.toObject ? product.toObject() : (product || {});
    const esg = p.traceabilityEsg || {};
    const route = esg.route || {};
    const text = (v: any) => String(v ?? '').trim();
    const steps: any[] = [];

    // Materials: the supplier list when there is one, otherwise each
    // material's own country of origin.
    const suppliers = (Array.isArray(esg.materialOrigins) ? esg.materialOrigins : []).filter((m: any) => text(m?.country));
    if (suppliers.length) {
        suppliers.forEach((m: any) => steps.push({
            stage: 'materials',
            title: `${text(m.material) || 'Material'} sourced`,
            detail: [text(m.companyName), text(m.country)].filter(Boolean).join(', '),
            placeName: text(m.country)
        }));
    } else {
        (Array.isArray(p.materialSize?.materials) ? p.materialSize.materials : [])
            .filter((m: any) => text(m?.origin))
            .forEach((m: any) => steps.push({
                stage: 'materials',
                title: `${text(m.material) || 'Material'} sourced`,
                detail: [m.percent != null ? `${m.percent}%` : '', text(m.origin)].filter(Boolean).join(' · '),
                placeName: text(m.origin)
            }));
    }

    const madeIn = text(esg.madeIn) || text(esg.originCountry);
    if (madeIn) {
        steps.push({
            stage: 'manufacturing',
            title: 'Manufactured',
            detail: [madeIn, text(p.manufactureDate), text(esg.co2Production) && `CO2 ${text(esg.co2Production)}`].filter(Boolean).join(' · '),
            placeName: madeIn
        });
    }

    if (text(route.origin)) {
        steps.push({
            stage: 'transport',
            title: 'Shipped from',
            detail: [text(route.origin), text(route.mode) && `by ${text(route.mode)}`, text(esg.distance)].filter(Boolean).join(' · '),
            placeName: text(route.origin)
        });
    }
    if (text(route.destination)) {
        steps.push({
            stage: 'transport',
            title: 'Arrived in',
            detail: [text(route.destination), (text(route.emissions) || text(esg.co2Transportation)) && `CO2 ${text(route.emissions) || text(esg.co2Transportation)}`].filter(Boolean).join(' · '),
            placeName: text(route.destination)
        });
    }

    const placed = await geocodePlaces(steps.map((s) => s.placeName));
    return steps.map((s) => {
        const at = placed.get(s.placeName.toLowerCase());
        return { ...s, latitude: at ? at.latitude : null, longitude: at ? at.longitude : null };
    });
};

module.exports = { buildProductLifecycle, geocodePlaces };
