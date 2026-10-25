import { describe, expect, it } from 'vitest';
import { detectCategory, isReadableTextPath } from '../features/chat/attachment-utils';
import { extractOfficeText } from '../features/chat/office-text';

/**
 * Минимальные настоящие файлы (ZIP + deflate): документ.xml из python-docx / python-pptx /
 * openpyxl и вручную собранный xlsx в стиле Excel (sharedStrings, rich text, пропуски ячеек).
 */
const FIXTURES = {
  docx: 'UEsDBBQAAAAIAMSNRl1zEJyeDAMAAE0JAAARAAAAd29yZC9kb2N1bWVudC54bWy1Vs1u00AQvvMUliWaU+u1Y0Jwm1SQqqUSSFHLz3ljO7ZVe3e1u0kaTqXiBZAQByQOcOBcgZAQiPIKzivwJIzXf4laSmjgkN2dmZ1vvpkdb3Zr+ziJtbHPRURJp2FuoIbmE5d6EQk6jcePdtfbDU1ITDwcU+J3GlNfNLa7N7YmjkfdUeITqQECEc6EuR09lJI5hiHc0E+w2Egil1NBh3LDpYlBh8PI9Y0J5Z5hIROpFePU9YWAcD1MxljoBVxCl0NLsFsuLYTaIEekwrjIiDKfgHFIeYIliDwAD340YuuAybCMBlEcyWmG1apgxh19xIlTYKxXPDIfBwg44yQuN9Or9uZEi6n04MuQzF12ipIregb3YyBMiQgjVtftumhgDEuQKxOeS3bCTHu1Q9/heAJTDbgMfS93SuKc+dWIJlriRDKIymMZCosxSybzzTe5XmnmixusVts9TkesRotWQ9snRxUWXAR/g1Wc0XxqYjUyhyFm8AElrrMfEMrxIAZGUHEt60i9C7fTgHrTbGbZwLNBdtNX6Xn6CX4f0/PZiZb+gOn57DQ9A8XX9Iv288Vrzba2jGxvNnI1sgswH9LP6ff0zNFM7RZC2hpO2KZmoZvaWiw307cQ5t1aIDcvBZKDuJj6vFg81WCaMsgAjyTVQYIWRLpRmB9QegS6YcSF7NF4lJCObuql5oBOCjHGtR2VCmVWEqH378E1XklPckm5jnEMevuuCmosstvjkZctA5gBPmdnN62C4KVqY8FT5lBuPhbAbp21d4z1i/7FxoXCv1dndzY7uaS0Rh1i9UBvINC39axPfh/JqDL7Z/m9zMLOTv9zdiZCf8zKqDpV+K7scwCGJ4J3AG2CdnutO81dvVT1eaZELdRq9krlITgpbdNumS31QbLg8FlOz7QsWzVhCOtbbbvoJBY8xFkcSeFPwLTzLTwKQkAy20iJAyolTWpz7A/nrKGPPR/Y3LaUOKRUzonBSCqxCOfSWIBWMOz6+R6lhldN1rcZdkT8fiRdYNlslfXMq6GW+Q1j1A+h7i9QSwECFAMUAAAACADEjUZdcxCcngwDAABNCQAAEQAAAAAAAAAAAAAAgAEAAAAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAEAAQA/AAAAOwMAAAAA',
  pptx: 'UEsDBBQAAAAIAMSNRl1919UQuAEAAAsEAAAVAAAAcHB0L3NsaWRlcy9zbGlkZTEueG1srVPLThsxFN3zFdZsZlWcpFJVRZkgAYJNH5ESPsAd32RG9diW7abJsvARLPmFCLKAVPANzh9x7ckQVECKVBa+ftxzzr1zxu4dzCpBpmBsqWSWtvdbKQGZK17KSZaejU4+fE6JdUxyJpSELJ2DTQ/6ez3dtYITJEvbZVlSOKe7lNq8gIrZfaVBYm6sTMUcbs2EcsN+o2glaKfV+kQrVspkw9e78LUBC9Ixh42+JmJ2EVHjcZnDscp/VahVixgQUdQWpbZJH78sHwoeZqtHBiCs5PTU6KEemJj+Nh0YUvIsaSdEsgqyJKGbxAZGa1Jc0H/ok2cQq2vgS+lOIz0qnQDSfqpQQxlSv6j8pyVSoXZopS71hKjrh1kXxM01SrkglTQthSR9Xtw2XbnZoeLzUOQHzvGQdYV1QzcXEDc6hNiG6/tLv/A3/sH/xXGNY0XWf3Cz8Hd+6Rc9GkAhmhh1rNqUoI0HbzvxsXHiSEmHf40MBMuhUIKDIZ3/86Xksy3kHS25Wl/4e79anxP0Y+lv/f0rNrzNWaKPuxlHt7eUbi9uLsxXpr9PozQ+BQfmKB5pfIEbP7YQGt9y/xFQSwECFAMUAAAACADEjUZdfdfVELgBAAALBAAAFQAAAAAAAAAAAAAAgAEAAAAAcHB0L3NsaWRlcy9zbGlkZTEueG1sUEsFBgAAAAABAAEAQwAAAOsBAAAAAA==',
  xlsxInline:
    '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',
  xlsxShared:
    'UEsDBBQAAAAIAMSNRl2Sqpi5qwAAAMoAAAAPAAAAeGwvd29ya2Jvb2sueG1sNY5LCsIwGISvErJw2b+6UKhpu3HTY8T2rwltHiTxsfYUHkNwI4h6hXgjg9jVzPANw7D6pEZyQOel0SWdZzmtK3Y0btgaM5AEtS9cSUUItgDwrUDFfWYs6sR64xQPKbodmL6XLW5Mu1eoAyzyfAkORx7SsBfSeloxLxCD/yvRXGFJ4+Vzjq94i3cy48quSXzHR7zGJyW/WtOlW5S4Qibjmm5FoWIwLcF0tfoCUEsDBBQAAAAIAMSNRl0LPfpRWAAAAHUAAAAaAAAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHOzsa/IzVEoSy0qzszPs1Uy1DNQsrezCUrNSSwBChRnZBYUo3IVPFNslYo8U8yVFEIqC1JtlSqAjMSi9NQSW6Xy/KLs4ozU1JJifTBlqAc0XEnfzkYf1UAAUEsDBBQAAAAIAMSNRl2In8CVggAAALUAAAAUAAAAeGwvc2hhcmVkU3RyaW5ncy54bWyzsa/IzVEoSy0qzszPs1Uy1DNQsrezKS4uUUjOL80rsVUyVgJyM+1sSuwuzLiw52K/jX6JnY0+SASEi6ASmyDCRRARBaCZVsUFicmptkoFRanFqUVlqUp2FzZc2KuAos7uwvwLWy82XWy4sA/JBLjhJXamCmo5JdYK5ghL9YFOswMAUEsDBBQAAAAIAMSNRl0qwD3PdQAAANsAAAAYAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sXY5dCoMwEISvEvYArll8XFeqXkQkYGltIAmxx28Uf2KfdnZm+BhuvvNbReP8035q0EUJjfBi3ctPxgTh7fRDGISdXZRLHRAeV/HQoEINPv1RSsYojOOedXlGZ4aJcYLoALWUlfUfiDa3orvdE+CBw2wjXtN/UEsBAhQDFAAAAAgAxI1GXZKqmLmrAAAAygAAAA8AAAAAAAAAAAAAAIABAAAAAHhsL3dvcmtib29rLnhtbFBLAQIUAxQAAAAIAMSNRl0LPfpRWAAAAHUAAAAaAAAAAAAAAAAAAACAAdgAAAB4bC9fcmVscy93b3JrYm9vay54bWwucmVsc1BLAQIUAxQAAAAIAMSNRl2In8CVggAAALUAAAAUAAAAAAAAAAAAAACAAWgBAAB4bC9zaGFyZWRTdHJpbmdzLnhtbFBLAQIUAxQAAAAIAMSNRl0qwD3PdQAAANsAAAAYAAAAAAAAAAAAAACAARwCAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWxQSwUGAAAAAAQABAANAQAAxwIAAAAA',
  xlsxSharedStored:
    'UEsDBBQAAAAAAMSNRl2Sqpi5ygAAAMoAAAAPAAAAeGwvd29ya2Jvb2sueG1sPD94bWwgdmVyc2lvbj0iMS4wIj8+PHdvcmtib29rIHhtbG5zOnI9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9vZmZpY2VEb2N1bWVudC8yMDA2L3JlbGF0aW9uc2hpcHMiPjxzaGVldHM+PHNoZWV0IG5hbWU9ItCY0YLQvtCz0LggJmFtcDsg0L/Qu9Cw0L0iIHNoZWV0SWQ9IjEiIHI6aWQ9InJJZDciLz48L3NoZWV0cz48L3dvcmtib29rPlBLAwQUAAAAAADEjUZdCz36UXUAAAB1AAAAGgAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzPD94bWwgdmVyc2lvbj0iMS4wIj8+PFJlbGF0aW9uc2hpcHM+PFJlbGF0aW9uc2hpcCBJZD0icklkNyIgVHlwZT0ieCIgVGFyZ2V0PSJ3b3Jrc2hlZXRzL3NoZWV0MS54bWwiLz48L1JlbGF0aW9uc2hpcHM+UEsDBBQAAAAAAMSNRl2In8CVtQAAALUAAAAUAAAAeGwvc2hhcmVkU3RyaW5ncy54bWw8P3htbCB2ZXJzaW9uPSIxLjAiPz48c3N0IGNvdW50PSIzIj48c2k+PHQ+0JjQvNGPPC90Pjwvc2k+PHNpPjxyPjx0PtCY0LI8L3Q+PC9yPjxyPjx0IHhtbDpzcGFjZT0icHJlc2VydmUiPtCw0L0gPC90Pjwvcj48cj48dD7Qn9C10YLRgNC+0LI8L3Q+PC9yPjwvc2k+PHNpPjx0PjUgJmx0OyA3PC90Pjwvc2k+PC9zc3Q+UEsDBBQAAAAAAMSNRl0qwD3P2wAAANsAAAAYAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sPD94bWwgdmVyc2lvbj0iMS4wIj8+PHdvcmtzaGVldD48c2hlZXREYXRhPjxyb3cgcj0iMSI+PGMgcj0iQTEiIHQ9InMiPjx2PjA8L3Y+PC9jPjxjIHI9IkMxIiB0PSJzIj48dj4yPC92PjwvYz48L3Jvdz48cm93IHI9IjIiPjxjIHI9IkIyIiB0PSJzIj48dj4xPC92PjwvYz48YyByPSJDMiI+PHY+NDI8L3Y+PC9jPjxjIHI9IkQyIi8+PC9yb3c+PC9zaGVldERhdGE+PC93b3Jrc2hlZXQ+UEsBAhQDFAAAAAAAxI1GXZKqmLnKAAAAygAAAA8AAAAAAAAAAAAAAIABAAAAAHhsL3dvcmtib29rLnhtbFBLAQIUAxQAAAAAAMSNRl0LPfpRdQAAAHUAAAAaAAAAAAAAAAAAAACAAfcAAAB4bC9fcmVscy93b3JrYm9vay54bWwucmVsc1BLAQIUAxQAAAAAAMSNRl2In8CVtQAAALUAAAAUAAAAAAAAAAAAAACAAaQBAAB4bC9zaGFyZWRTdHJpbmdzLnhtbFBLAQIUAxQAAAAAAMSNRl0qwD3P2wAAANsAAAAYAAAAAAAAAAAAAACAAYsCAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWxQSwUGAAAAAAQABAANAQAAnAMAAAAA',
} as const;

function toBlob(base64: string): Blob {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return { size: bytes.length, arrayBuffer: async () => buffer } as unknown as Blob;
}

describe('office-text: extractOfficeText', () => {
  it('достаёт текст из DOCX, включая таблицы и спецсимволы XML', async () => {
    const text = await extractOfficeText(toBlob(FIXTURES.docx), 'docx');
    expect(text).toContain('Договор поставки № 42');
    expect(text).toContain('Цена: 1 500 & 20% <НДС>');
    expect(text).toContain('Болт');
    expect(text).not.toContain('<w:');
  });

  it('достаёт текст слайдов из PPTX с нумерацией', async () => {
    const text = await extractOfficeText(toBlob(FIXTURES.pptx), 'pptx');
    expect(text).toContain('## Слайд 1');
    expect(text).toContain('Заголовок слайда');
    expect(text).toContain('Пункт два');
  });

  it('читает XLSX с inline-строками: листы, порядок колонок, числа', async () => {
    const text = await extractOfficeText(toBlob(FIXTURES.xlsxInline), 'xlsx');
    expect(text).toContain('## Продажи');
    expect(text).toContain('Месяц\tВыручка');
    expect(text).toContain('Февраль\t1350.5');
    // Лист «План»: значения в колонках B и D, колонка A пустая.
    expect(text).toContain('## План');
    expect(text).toContain('\tЦель\t\t99');
  });

  it('читает XLSX в стиле Excel: sharedStrings, rich text, имя листа с &', async () => {
    for (const key of ['xlsxShared', 'xlsxSharedStored'] as const) {
      const text = await extractOfficeText(toBlob(FIXTURES[key]), 'xlsx');
      expect(text).toContain('## Итоги & план');
      expect(text).toContain('Имя\t\t5 < 7');
      expect(text).toContain('\tИван Петров\t42');
    }
  });

  it('возвращает null для не-архивов, пустых документов и неверного формата', async () => {
    const garbage = {
      size: 4,
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    } as unknown as Blob;
    expect(await extractOfficeText(garbage, 'docx')).toBeNull();
    // PPTX-файл как DOCX: нет word/document.xml
    expect(await extractOfficeText(toBlob(FIXTURES.pptx), 'docx')).toBeNull();
  });

  it('обрезает слишком длинный текст с пометкой', async () => {
    const text = await extractOfficeText(toBlob(FIXTURES.docx), 'docx', 30);
    expect(text).toContain('[текст документа обрезан]');
  });
});

describe('attachment-utils', () => {
  it('файлы .ts — это код, даже если браузер отдаёт MIME video/mp2t', () => {
    expect(detectCategory({ name: 'app.ts', type: 'video/mp2t' })).toBe('code');
    expect(detectCategory({ name: 'clip.mp4', type: 'video/mp4' })).toBe('video');
  });

  it('PDF и офисные форматы — документы, изображения — изображения', () => {
    expect(detectCategory({ name: 'a.pdf', type: 'application/pdf' })).toBe('document');
    expect(detectCategory({ name: 'a.docx', type: '' })).toBe('document');
    expect(detectCategory({ name: 'a.png', type: 'image/png' })).toBe('image');
  });

  it('isReadableTextPath отличает исходники от бинарников', () => {
    expect(isReadableTextPath('src/app.tsx')).toBe(true);
    expect(isReadableTextPath('Dockerfile')).toBe(true);
    expect(isReadableTextPath('docs/readme.md')).toBe(true);
    expect(isReadableTextPath('assets/logo.png')).toBe(false);
    expect(isReadableTextPath('report.pdf')).toBe(false);
  });
});
