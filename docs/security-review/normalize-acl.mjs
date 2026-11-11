// Сортирует записи ACL в строках снимка каталога: acl={b=r/x,a=r/x} -> acl={a=r/x,b=r/x}.
// После REVOKE и повторного GRANT Postgres добавляет записи роли в конец списка: права те же, порядок другой.
import { readFileSync } from 'node:fs';
const text = readFileSync(0, 'utf8');
process.stdout.write(text.replace(/acl=\{([^}]*)\}/g, (_, items) => `acl={${items.split(',').sort().join(',')}}`));
