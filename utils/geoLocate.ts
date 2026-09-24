const fetch = require('node-fetch');

// Best-effort server-side location for scan records when the client didn't
// send one (the mobile app's scan calls don't include a location). Never
// throws — resolves to null on any failure/timeout so recording a scan is
// never blocked by geolocation.

const TIMEOUT_MS = 3000;

async function fetchJson(url: string, headers: any = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, { headers, signal: controller.signal });
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function isPrivateIp(ip: string) {
    const v = ip.replace(/^::ffff:/, '');
    return !v
        || v === '::1'
        || v.startsWith('127.')
        || v.startsWith('10.')
        || v.startsWith('192.168.')
        || /^172\.(1[6-9]|2\d|3[01])\./.test(v)
        || /^f[cd]/i.test(v)
        || /^fe80:/i.test(v);
}

// IP -> { country, region, city, latitude, longitude, source: 'ip' }
async function geolocateIp(ip: string) {
    const v = String(ip || '').replace(/^::ffff:/, '').trim();
    if (isPrivateIp(v)) return null;
    const data = await fetchJson(`http://ip-api.com/json/${encodeURIComponent(v)}?fields=status,country,regionName,city,lat,lon`);
    if (!data || data.status !== 'success' || !data.country) return null;
    return {
        country: data.country || '',
        region: data.regionName || '',
        city: data.city || '',
        latitude: data.lat != null ? Number(data.lat) : null,
        longitude: data.lon != null ? Number(data.lon) : null,
        source: 'ip'
    };
}

// GPS coords -> { country, region, city } via OpenStreetMap Nominatim.
async function reverseGeocode(latitude: number, longitude: number) {
    const data = await fetchJson(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1&accept-language=en`,
        { 'User-Agent': 'DPP-Application/1.0', Accept: 'application/json' }
    );
    const addr = data?.address;
    if (!addr?.country) return null;
    return {
        country: addr.country || '',
        region: addr.state || '',
        city: addr.city || addr.town || addr.village || addr.county || ''
    };
}

module.exports = { geolocateIp, reverseGeocode };
