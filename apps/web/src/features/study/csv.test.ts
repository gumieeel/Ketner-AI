import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('CSV результата', () => {
  it('кавычки, запятые и переводы строк экранируются', () => {
    expect(csvCell('просто')).toBe('просто');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('он сказал "да"')).toBe('"он сказал ""да"""');
    expect(csvCell('строка\nвторая')).toBe('"строка\nвторая"');
  });

  it('текст, похожий на формулу, не выполнится в таблице', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell('+7 999')).toBe("'+7 999");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('строки через CRLF, заголовок первым', () => {
    expect(toCsv(['Термин', 'Определение'], [['Ядро', 'Хранит ДНК']])).toBe(
      'Термин,Определение\r\nЯдро,Хранит ДНК',
    );
  });
});
