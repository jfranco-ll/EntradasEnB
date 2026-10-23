const QRCode = require('qrcode');

// Función para generar un QR en formato Data URL (imagen en Base64)
async function generateQRCode(text) {
  try {
    const qrDataUrl = await QRCode.toDataURL(text);
    return qrDataUrl;
  } catch (error) {
    console.error('Error al generar QR:', error);
    throw error;
  }
}

module.exports = { generateQRCode };