import {
  AlertIcon,
  CheckIcon,
  LockIcon,
  ShieldIcon,
  TerminalIcon,
} from '@/components/icons';
import { DocHeading } from '@/components/docs/doc-heading';
import { Kbd } from '@/components/ui/kbd';

export function SecuritySection() {
  return (
    <section id="security" className="flex flex-col gap-6 rounded-xl border border-stroke bg-surface p-5 md:p-7 shadow-sm">
      <div className="flex items-center gap-3 border-b border-stroke pb-4">
        <div className="grid size-9 place-items-center rounded-lg bg-surface-2 border border-stroke text-accent">
          <ShieldIcon className="text-lg" />
        </div>
        <div>
          <DocHeading level={2} id="security" className="text-base md:text-lg font-semibold text-text">
            Политика безопасности и контроль доступа на машине
          </DocHeading>
          <p className="mt-0.5 text-xs text-muted">
            Многоуровневая изоляция при локальном выполнении команд и работе с файлами
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-stroke bg-canvas p-4.5 flex flex-col gap-2">
          <h4 className="font-semibold text-sm text-text flex items-center gap-2">
            <CheckIcon className="text-accent text-sm" />
            Режим подтверждения (Human-in-the-loop)
          </h4>
          <p className="text-xs text-muted leading-relaxed">
            По умолчанию агент <strong className="text-text">не может</strong> исполнять деструктивные
            команды без вашего подтверждения в терминале. При попытке выполнить операции вроде{' '}
            <code className="text-text font-mono">git push</code>, <code className="text-text font-mono">rm</code>{' '}
            или установку глобальных пакетов терминал запрашивает подтверждение клавишей{' '}
            <Kbd>Y</Kbd>.
          </p>
        </div>

        <div className="rounded-lg border border-stroke bg-canvas p-4.5 flex flex-col gap-2">
          <h4 className="font-semibold text-sm text-text flex items-center gap-2">
            <LockIcon className="text-accent text-sm" />
            Защита секретов и токенов
          </h4>
          <p className="text-xs text-muted leading-relaxed">
            Агент автоматически маскирует и исключает из контекста отправки файлы секретов:{' '}
            <code className="text-text font-mono">.env</code>,{' '}
            <code className="text-text font-mono">id_rsa</code>,{' '}
            <code className="text-text font-mono">credentials.json</code> и каталог{' '}
            <code className="text-text font-mono">.git/config</code>. Ваши приватные ключи никогда
            не покидают компьютер.
          </p>
        </div>

        <div className="rounded-lg border border-stroke bg-canvas p-4.5 flex flex-col gap-2">
          <h4 className="font-semibold text-sm text-text flex items-center gap-2">
            <TerminalIcon className="text-accent text-sm" />
            Изоляция через Docker / Dev Containers
          </h4>
          <p className="text-xs text-muted leading-relaxed">
            Для 100% изоляции вы можете запустить Ketner Agent внутри изолированного
            Docker-контейнера:
            <code className="mt-2 block rounded bg-surface p-2 text-accent font-mono text-[11px] border border-stroke">
              docker run -v $(pwd):/workspace ketner/agent:latest
            </code>
          </p>
        </div>

        <div className="rounded-lg border border-stroke bg-canvas p-4.5 flex flex-col gap-2">
          <h4 className="font-semibold text-sm text-text flex items-center gap-2">
            <AlertIcon className="text-accent text-sm" />
            Чёрный список команд (Blacklist)
          </h4>
          <p className="text-xs text-muted leading-relaxed">
            Системный фильтр ядра блокирует любые попытки изменения системных разделов
            (форматирование, модификация BIOS/EFI, изменение прав суперпользователя).
          </p>
        </div>
      </div>
    </section>
  );
}
