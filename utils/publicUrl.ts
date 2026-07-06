const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || 'https://dpp.innosynch.com').replace(/\/+$/, '');

const buildPublicProductUrl = (productId: any, qrCodeId: any) => {
    return `${PUBLIC_APP_URL}/product/${encodeURIComponent(String(productId))}/${encodeURIComponent(String(qrCodeId))}`;
};

const extractProductFromQrUrl = (qrUrl: string) => {
    if (!qrUrl || typeof qrUrl !== 'string') {
        return null;
    }

    let normalizedUrl = String(qrUrl).trim();

    // Support wrapped format:
    //   http://localhost:3000?qrcode=https%3A%2F%2Fhost%2Fproduct%2F:id%2F:qrcodeId
    const qrcodeParamIndex = normalizedUrl.indexOf('qrcode=');
    if (qrcodeParamIndex >= 0) {
        const encodedValue = normalizedUrl.substring(qrcodeParamIndex + 'qrcode='.length).split('&')[0];
        try {
            normalizedUrl = decodeURIComponent(encodedValue);
        } catch (error) {
            normalizedUrl = encodedValue;
        }
    }

    const match = normalizedUrl.match(/\/product\/([^/?#]+)\/([^/?#]+)/i);
    if (!match) {
        return null;
    }

    const productId = decodeURIComponent(match[1]);
    const qrcodeId = Number(decodeURIComponent(match[2]));
    if (!productId || !Number.isFinite(qrcodeId)) {
        return null;
    }

    return { productId, qrcodeId };
};

module.exports = { PUBLIC_APP_URL, buildPublicProductUrl, extractProductFromQrUrl };
