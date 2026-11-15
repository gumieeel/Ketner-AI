import qrcode from 'qrcode-generator';

/**
 * Настоящий QR-код (его можно отсканировать кошельком). Уровень коррекции H: значок в центре
 * закрывает часть модулей, а код всё равно читается.
 */
export function qrPath(text: string): { path: string; count: number } {
  const qr = qrcode(0, 'H');
  qr.addData(text, 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  let path = '';
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (qr.isDark(y, x)) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { path, count };
}

/** Белое поле вокруг кода по стандарту QR — 4 модуля: без него печатный код читается хуже. */
const QUIET_ZONE = 4;

/** QR-код отдельным SVG-файлом для печати: белый фон и поле вокруг. */
export function qrSvgMarkup(value: string): string {
  const { path, count } = qrPath(value);
  const size = count + QUIET_ZONE * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * 16}" height="${size * 16}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#ffffff"/>` +
    `<path transform="translate(${QUIET_ZONE} ${QUIET_ZONE})" d="${path}" fill="#09090b"/></svg>`
  );
}

/** QR-код картинкой PNG (`scale` пикселей на модуль); null — браузер не умеет рисовать на canvas. */
export async function qrPngBlob(value: string, scale = 24): Promise<Blob | null> {
  const qr = qrcode(0, 'H');
  qr.addData(value, 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const size = (count + QUIET_ZONE * 2) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  context.fillStyle = '#09090b';
  for (let y = 0; y < count; y++) {
    for (let x = 0; x < count; x++) {
      if (qr.isDark(y, x)) {
        context.fillRect((x + QUIET_ZONE) * scale, (y + QUIET_ZONE) * scale, scale, scale);
      }
    }
  }
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
