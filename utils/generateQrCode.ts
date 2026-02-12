const qr = require('qr-image');
const fs = require('fs');

const generateQrCode = (metadata: any) => {
    let stringdata = JSON.stringify(metadata)
    const qrCode = qr.image(stringdata, { size: 2 }); // Adjust size as needed

    // Encode the QR code image as a data URL (PNG format)
    const dataURL = qrCode.pipe(require('concat-stream')((buffer: any) => {
        const base64 = buffer.toString('base64');
        const dataURL = `data:image/png;base64,${base64}`;
        return dataURL;
    }));
    return dataURL;
}

module.exports = { generateQrCode };