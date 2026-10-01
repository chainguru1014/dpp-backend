// The design of the product page shoppers see after scanning (the "DPP
// experience"), set per company: colours, style, layout and a little brand
// content. The same shape and the same clean-up live in
// frontend/src/utils/dppTheme.js and app/src/utils/dppTheme.ts — change all
// three together, so a theme saved here always renders.

// Lifecycle tabs: one per tab of the app's Product Lifecycle screen.
const DPP_SECTIONS = [
    { key: 'journey', on: true },
    { key: 'care', on: true },
    { key: 'materials', on: true },
    { key: 'dispose', on: true },
    { key: 'traceability', on: true },
    { key: 'compliance', on: true }
];
// Blocks of the Product Overview screen; `on` = shown in the standard look.
const DPP_BLOCKS = [
    { key: 'highlights', on: true },
    { key: 'lifecycle', on: true },
    { key: 'about', on: false },
    { key: 'brand', on: false },
    { key: 'message', on: false },
    { key: 'cta', on: false },
    { key: 'feedback', on: true },
    { key: 'actions', on: true }
];
const CHOICES: Record<string, string[]> = {
    headerStyle: ['gradient', 'solid'],
    buttonStyle: ['gradient', 'solid', 'outline'],
    cardStyle: ['shadow', 'border', 'flat'],
    tabStyle: ['underline', 'pills'],
    textScale: ['small', 'normal', 'large'],
    heroLayout: ['side', 'top'],
    fontFamily: ['system', 'serif', 'rounded', 'mono']
};

const DEFAULT_DPP_THEME = {
    pageBg: '#f4f7fc',
    cardBg: '#ffffff',
    accent: '#1b4f72',
    buttonText: '#ffffff',
    textColor: '#33415c',
    headerColor: '',
    badgeColor: '',
    headerStyle: 'gradient',
    buttonStyle: 'gradient',
    buttonRadius: 12,
    cardStyle: 'shadow',
    cardRadius: 16,
    tabStyle: 'underline',
    textScale: 'normal',
    fontFamily: 'system',
    heroLayout: 'side',
    showProductId: true,
    blocks: DPP_BLOCKS.map((b) => ({ key: b.key, visible: b.on })),
    sections: DPP_SECTIONS.map((s) => ({ key: s.key, visible: true })),
    message: { title: '', body: '' },
    cta: { label: '', url: '' }
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const color = (value: any, fallback: string) => (HEX.test(String(value || '').trim()) ? String(value).trim() : fallback);
const choice = (value: any, name: string, fallback: string) => (CHOICES[name].includes(value) ? value : fallback);
const clampInt = (value: any, min: number, max: number, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
};
const text = (value: any, max: number) => String(value ?? '').slice(0, max);

// An ordered show/hide list: every known key exactly once, in the brand's
// order; keys the brand never saw get their standard visibility.
const orderedList = (raw: any, known: { key: string; on: boolean }[]) => {
    const seen = new Set<string>();
    const out: { key: string; visible: boolean }[] = [];
    (Array.isArray(raw) ? raw : []).forEach((item: any) => {
        const def = item && known.find((k) => k.key === item.key);
        if (!def || seen.has(def.key)) return;
        seen.add(def.key);
        out.push({ key: def.key, visible: item.visible !== false });
    });
    known.forEach((def) => {
        if (!seen.has(def.key)) out.push({ key: def.key, visible: def.on });
    });
    return out;
};

// Fills in anything missing or invalid, so a theme can always be drawn.
const normalizeDppTheme = (raw: any) => {
    const t = raw && typeof raw === 'object' ? raw : {};
    const d = DEFAULT_DPP_THEME;
    return {
        pageBg: color(t.pageBg, d.pageBg),
        cardBg: color(t.cardBg, d.cardBg),
        accent: color(t.accent, d.accent),
        buttonText: color(t.buttonText, d.buttonText),
        textColor: color(t.textColor, d.textColor),
        headerColor: color(t.headerColor, ''),
        badgeColor: color(t.badgeColor, ''),
        headerStyle: choice(t.headerStyle, 'headerStyle', d.headerStyle),
        buttonStyle: choice(t.buttonStyle, 'buttonStyle', d.buttonStyle),
        buttonRadius: clampInt(t.buttonRadius, 0, 30, d.buttonRadius),
        cardStyle: choice(t.cardStyle, 'cardStyle', d.cardStyle),
        cardRadius: clampInt(t.cardRadius, 0, 28, d.cardRadius),
        tabStyle: choice(t.tabStyle, 'tabStyle', d.tabStyle),
        textScale: choice(t.textScale, 'textScale', d.textScale),
        fontFamily: choice(t.fontFamily, 'fontFamily', d.fontFamily),
        heroLayout: choice(t.heroLayout, 'heroLayout', d.heroLayout),
        showProductId: t.showProductId !== false,
        blocks: orderedList(t.blocks, DPP_BLOCKS),
        sections: orderedList(t.sections, DPP_SECTIONS),
        message: { title: text(t.message?.title, 80), body: text(t.message?.body, 400) },
        cta: { label: text(t.cta?.label, 40), url: text(t.cta?.url, 300).trim() }
    };
};

module.exports = { DEFAULT_DPP_THEME, normalizeDppTheme };
