// Spots labels that behave like copies. A genuine label is on one physical
// item, so its scans follow one item around the world. A copied label shows
// up in places the real item cannot have reached in time, or is scanned by
// far more devices than one item ever would be.
//
// Locations come from GPS when the app has it, otherwise from the scanner's
// IP address — which can be wrong (VPNs, mobile carriers). So these are
// reasons to look at an item, never proof on their own; the brand decides
// (see the item "blocked" flag on qrcodeModel).

// Faster than this between two scans means the same item could not have
// made the trip (a long-haul flight averages ~800-900 km/h gate to gate).
const MAX_PLAUSIBLE_KMH = 1000;
// Ignore short hops: IP geolocation routinely misplaces a device by a few
// hundred kilometres.
const MIN_JUMP_KM = 500;
// One item scanned by this many different devices is unusual for a garment.
const MANY_DEVICES = 10;

const toRad = (deg: number) => (deg * Math.PI) / 180;

const distanceKm = (a: any, b: any) => {
    const R = 6371;
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
};

const hasCoords = (loc: any) => typeof loc?.latitude === 'number' && typeof loc?.longitude === 'number';
const placeName = (loc: any) => [loc?.city, loc?.country].filter(Boolean).join(', ') || 'an unknown place';

/**
 * Looks at one item's scans ([{ at, ip, location, security_verified }], any
 * order) and returns why it deserves a look, if at all.
 *   level: 'high' (an impossible journey or a failed security check),
 *          'medium' (scanned by many devices), or 'none'.
 */
const assessItemScans = (scans: any[]) => {
    const ordered = [...scans].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    const reasons: { code: string; text: string }[] = [];

    let jumps = 0;
    let worstJump: any = null;
    let previous: any = null;
    ordered.forEach((scan) => {
        if (!hasCoords(scan.location)) return;
        if (previous) {
            const km = distanceKm(previous.location, scan.location);
            const hours = Math.max((new Date(scan.at).getTime() - new Date(previous.at).getTime()) / 3600000, 1 / 60);
            if (km >= MIN_JUMP_KM && km / hours > MAX_PLAUSIBLE_KMH) {
                jumps += 1;
                if (!worstJump || km > worstJump.km) worstJump = { km, hours, from: previous.location, to: scan.location };
            }
        }
        previous = scan;
    });
    if (worstJump) {
        const hoursText = worstJump.hours < 1 ? `${Math.max(1, Math.round(worstJump.hours * 60))} minutes` : `${Math.round(worstJump.hours * 10) / 10} hours`;
        reasons.push({
            code: 'impossible_travel',
            text: `Scanned in ${placeName(worstJump.from)} and then ${placeName(worstJump.to)}, ${Math.round(worstJump.km).toLocaleString('en-US')} km apart, within ${hoursText}${jumps > 1 ? ` (${jumps} such jumps)` : ''}.`
        });
    }

    const securityFailed = ordered.filter((s) => s.security_verified === false).length;
    if (securityFailed > 0) {
        reasons.push({
            code: 'security_failed',
            text: `Failed the Security QR check ${securityFailed} time${securityFailed === 1 ? '' : 's'}.`
        });
    }

    const devices = new Set(ordered.map((s) => s.ip).filter(Boolean)).size;
    if (devices >= MANY_DEVICES) {
        reasons.push({ code: 'many_devices', text: `Scanned from ${devices} different devices or networks.` });
    }

    const level = worstJump || securityFailed > 0 ? 'high' : devices >= MANY_DEVICES ? 'medium' : 'none';
    return { level, reasons, devices, securityFailed, jumps };
};

module.exports = { assessItemScans };
