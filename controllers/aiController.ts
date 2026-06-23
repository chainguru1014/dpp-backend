const fetch = require('node-fetch');
const mongoose = require('mongoose');
const Product = require('../models/productModel');

// OpenAI is called server-side only — the API key never reaches the client.
// Configure OPENAI_API_KEY (and optionally OPENAI_MODEL) in the backend env.
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

async function callOpenAI(messages: any[], opts: any = {}) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
        const e: any = new Error('AI is not configured. Set OPENAI_API_KEY on the server.');
        e.statusCode = 503;
        throw e;
    }
    const resp = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
            model: MODEL,
            messages,
            temperature: opts.temperature ?? 0.6,
            max_tokens: opts.max_tokens ?? 600,
            ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        }),
    });
    if (!resp.ok) {
        const text = await resp.text();
        const e: any = new Error(`OpenAI request failed (${resp.status})`);
        e.statusCode = 502;
        e.detail = text;
        throw e;
    }
    const data: any = await resp.json();
    return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
}

// POST /chat — customer ⇄ brand assistant answered by OpenAI.
exports.chat = async (req: any, res: any) => {
    try {
        const { message, history = [] } = req.body || {};
        if (!message || !String(message).trim()) {
            return res.status(400).json({ status: 'fail', message: 'message is required' });
        }
        const system = {
            role: 'system',
            content:
                'You are the product assistant for a Digital Product Passport (DPP) platform. ' +
                'Help shoppers with questions about products: authenticity, materials, care instructions, ' +
                'sustainability / ESG, warranty, and where to buy. Be concise, friendly and factual. ' +
                'If you are unsure about a specific product detail, say so and suggest contacting the brand.',
        };
        const trimmed = (Array.isArray(history) ? history : [])
            .filter((h: any) => h && h.content && (h.role === 'user' || h.role === 'assistant'))
            .slice(-10)
            .map((h: any) => ({ role: h.role, content: String(h.content).slice(0, 2000) }));
        const reply = await callOpenAI([system, ...trimmed, { role: 'user', content: String(message).slice(0, 2000) }], {
            max_tokens: 500,
        });
        res.json({ status: 'success', reply });
    } catch (err: any) {
        res.status(err.statusCode || 500).json({ status: 'error', message: err.message });
    }
};

// POST /recommendations — rank a brand's catalogue for a shopper using OpenAI.
exports.recommendations = async (req: any, res: any) => {
    try {
        const { ownerId, ownerKind, preferences } = req.body || {};
        const filter: any = { is_deleted: false };
        // Brand-scoped recommendations recommend that brand's own catalogue.
        if (ownerKind === 'Company' && ownerId) {
            try {
                filter.company_id = mongoose.Types.ObjectId(String(ownerId));
            } catch (e) {
                filter.company_id = ownerId;
            }
        }
        const products = await Product.find(filter).limit(40).lean();
        if (!products.length) {
            return res.json({ status: 'success', data: [] });
        }

        const catalogue = products.map((p: any) => ({
            id: String(p._id),
            name: p.name || '',
            model: p.model || '',
            detail: String(p.detail || '').slice(0, 200),
        }));
        const system = {
            role: 'system',
            content:
                'You are a merchandising assistant. Given a product catalogue (JSON) and optional shopper ' +
                'preferences, choose and rank the best products to recommend. Respond ONLY as JSON: ' +
                '{"ranked":[{"id":"<id>","reason":"<short reason>"}]}. Include at most 8 items, most relevant first.',
        };
        const user = {
            role: 'user',
            content:
                `Preferences: ${preferences ? JSON.stringify(preferences) : 'none provided — recommend broadly appealing, high-quality items'}\n\n` +
                `Catalogue:\n${JSON.stringify(catalogue)}`,
        };
        const raw = await callOpenAI([system, user], { json: true, max_tokens: 700, temperature: 0.4 });

        let ranked: any[] = [];
        try {
            const parsed = JSON.parse(raw);
            ranked = Array.isArray(parsed) ? parsed : parsed.ranked || parsed.products || [];
        } catch (e) {
            ranked = [];
        }
        const byId: any = {};
        products.forEach((p: any) => {
            byId[String(p._id)] = p;
        });
        const reasons: any = {};
        const ordered = ranked
            .map((r: any) => {
                const id = typeof r === 'string' ? r : r && r.id;
                if (r && r.reason) reasons[id] = r.reason;
                return byId[id];
            })
            .filter(Boolean);
        const result = (ordered.length ? ordered : products.slice(0, 8)).map((p: any) => ({
            ...p,
            ai_reason: reasons[String(p._id)] || undefined,
        }));
        res.json({ status: 'success', data: result });
    } catch (err: any) {
        res.status(err.statusCode || 500).json({ status: 'error', message: err.message });
    }
};
