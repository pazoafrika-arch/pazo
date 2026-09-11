import QRCode from 'qrcode';

/**
 * QR codes are generated server-side from the referral link (PRD 2.6).
 * - PNG at 1000x1000 for download/print.
 * - A data URL for in-app display.
 * Colours follow the Pazo palette: navy modules on white.
 */
const BASE_OPTIONS = {
  errorCorrectionLevel: 'H',
  margin: 2,
  color: { dark: '#0D2137', light: '#FFFFFF' },
};

export async function qrPngBuffer(text, size = 1000) {
  return QRCode.toBuffer(text, { ...BASE_OPTIONS, type: 'png', width: size });
}

export async function qrDataUrl(text, size = 320) {
  return QRCode.toDataURL(text, { ...BASE_OPTIONS, width: size });
}

export async function qrSvg(text) {
  return QRCode.toString(text, { ...BASE_OPTIONS, type: 'svg' });
}
