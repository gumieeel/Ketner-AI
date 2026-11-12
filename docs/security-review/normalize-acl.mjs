// Нормализует строки снимка каталога для сравнения «до» и «после отката»:
// 1) сортирует записи ACL: acl={b=r/x,a=r/x} -> acl={a=r/x,b=r/x} (после REVOKE и повторного GRANT
//    Postgres добавляет запись роли в конец списка: права те же, порядок другой);
// 2) у функции встроенные права (acl=-, то есть proacl = NULL) записывает явно: EXECUTE у PUBLIC и всё у
//    владельца. Откат возвращает те же права, но уже явной записью — PostgreSQL не умеет вернуть NULL.
import { readFileSync } from 'node:fs';
const text = readFileSync(0, 'utf8');
const lines = text.split('\n').map((line) => {
  if (line.startsWith('function | ') && / acl=-$/.test(line)) {
    const owner = / owner=(\S+) /.exec(line)?.[1];
    if (owner) line = line.replace(/ acl=-$/, ` acl={=X/${owner},${owner}=X/${owner}}`);
  }
  return line.replace(
    /acl=\{([^}]*)\}/g,
    (_, items) => `acl={${items.split(',').sort().join(',')}}`,
  );
});
process.stdout.write(lines.join('\n'));
