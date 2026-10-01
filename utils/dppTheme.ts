// The look of the product page shoppers see after scanning (the "DPP
// experience"), set per company. Kept in sync with
// frontend/src/utils/dppTheme.js and app/src/utils/dppTheme.ts — the same
// defaults and the same clean-up, so a theme saved here always renders.

// One per tab of the app's Product Lifecycle screen, in its default order.
const DPP_SECTION_KEYS = ['journey', 'care', 'materials', 'dispose', 'traceability'];
const DPP_FONT_KEYS = ['system', 'serif', 'rounded', 'mono'];

const DEFAULT_DPP_THEME = {
    pageBg: '#f4f7fc',
    cardBg: '#ffffff',
    accent: '#1b4f72',
    buttonText: '#ffffff',
    textColor: '#33415c',
    buttonRadius: 12,
    fontFamily: 'system',
    sections: DPP_SECTION_KEYS.map((key) => ({ key, visible: true }))
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const color = (value: any, fallback: string) => (HEX.test(String(value || '').trim()) ? String(value).trim() : fallback);

// Fills in anything missing or invalid, and keeps the section list complete
// (every known section exactly once, in the brand's order).
const normalizeDppTheme = (raw: any) => {
    const t = raw && typeof raw === 'object' ? raw : {};
    const d = DEFAULT_DPP_THEME;
    const seen = new Set<string>();
    const sections: { key: string; visible: boolean }[] = [];
    (Array.isArray(t.sections) ? t.sections : []).forEach((s: any) => {
        if (!s || !DPP_SECTION_KEYS.includes(s.key) || seen.has(s.key)) return;
        seen.add(s.key);
        sections.push({ key: s.key, visible: s.visible !== false });
    });
    DPP_SECTION_KEYS.forEach((key) => {
        if (!seen.has(key)) sections.push({ key, visible: true });
    });
    const radius = Number(t.buttonRadius);
    return {
        pageBg: color(t.pageBg, d.pageBg),
        cardBg: color(t.cardBg, d.cardBg),
        accent: color(t.accent, d.accent),
        buttonText: color(t.buttonText, d.buttonText),
        textColor: color(t.textColor, d.textColor),
        buttonRadius: Number.isFinite(radius) ? Math.max(0, Math.min(30, Math.round(radius))) : d.buttonRadius,
        fontFamily: DPP_FONT_KEYS.includes(t.fontFamily) ? t.fontFamily : d.fontFamily,
        sections
    };
};

module.exports = { DEFAULT_DPP_THEME, normalizeDppTheme };
