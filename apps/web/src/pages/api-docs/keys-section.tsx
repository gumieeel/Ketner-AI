import { useState } from 'react';
import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  KeyIcon,
  PlusIcon,
} from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/docs/callout';
import { DocHeading } from '@/components/docs/doc-heading';
import { copyText } from '@/lib/clipboard';
import { useTranslation } from '@/i18n';

export interface ApiKeyItem {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  permissions: string;
}

interface KeysSectionProps {
  keys: ApiKeyItem[];
  onAddKey: (name: string) => void;
  onRevokeKey: (id: string) => void;
}

export function KeysSection({ keys, onAddKey, onRevokeKey }: KeysSectionProps) {
  const { t } = useTranslation();
  const [newKeyName, setNewKeyName] = useState('');
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [revealedKeyIds, setRevealedKeyIds] = useState<Record<string, boolean>>({});
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  const handleCreateKey = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newKeyName.trim() || `API Key #${keys.length + 1}`;
    onAddKey(name);
    setNewKeyName('');
    setShowKeyForm(false);
  };

  const toggleReveal = (id: string) => {
    setRevealedKeyIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopyKey = async (id: string, text: string) => {
    await copyText(text);
    setCopiedKeyId(id);
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  return (
    <section id="keys" className="flex flex-col gap-4 rounded-xl border border-stroke bg-surface p-5 md:p-6 shadow-sm @container">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stroke pb-4">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-surface-2 border border-stroke text-accent">
            <KeyIcon className="text-lg" />
          </div>
          <div>
            <DocHeading level={2} id="keys" className="text-base md:text-lg font-semibold text-text">
              Секретные API-ключи
            </DocHeading>
            <p className="text-xs text-muted mt-0.5">{t('apiDocs.keysDesc')}</p>
          </div>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={() => setShowKeyForm((v) => !v)}
          className="self-start sm:self-center gap-1.5"
        >
          <PlusIcon className="text-xs" />
          {t('apiDocs.createKey')}
        </Button>
      </div>

      {showKeyForm ? (
        <form
          onSubmit={handleCreateKey}
          className="flex flex-col @sm:flex-row items-stretch @sm:items-center gap-2 rounded-lg border border-accent/30 bg-surface-2 p-3 animate-fade-in"
        >
          <input
            type="text"
            required
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder={t('apiDocs.keyNamePlaceholder')}
            className="flex-1 rounded-md border border-stroke bg-canvas px-3 py-1.5 text-xs text-text outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm">
              Создать
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowKeyForm(false)}
            >
              Отмена
            </Button>
          </div>
        </form>
      ) : null}

      <div className="flex flex-col gap-2.5">
        {keys.map((k) => {
          const isRevealed = Boolean(revealedKeyIds[k.id]);
          const isCopied = copiedKeyId === k.id;
          const displayKey = isRevealed
            ? k.key
            : `${k.key.slice(0, 15)}••••••••••••••••••••••••••••`;

          return (
            <div
              key={k.id}
              className="flex flex-col @md:flex-row @md:items-center justify-between gap-3 rounded-lg border border-stroke bg-canvas p-3.5 transition-colors hover:border-stroke-strong"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-text truncate">{k.name}</span>
                  <Badge tone="brand" className="text-[10px] py-0 px-1.5">
                    {t('apiDocs.keyActive')}
                  </Badge>
                  <span className="text-[11px] text-muted hidden @lg:inline font-mono">
                    {k.createdAt}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 font-mono text-xs text-text">
                  <span className="rounded bg-surface px-2 py-0.5 border border-stroke select-all text-xs">
                    {displayKey}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleReveal(k.id)}
                    title={isRevealed ? 'Скрыть' : 'Показать'}
                    className="p-1 text-muted hover:text-text transition-colors"
                  >
                    {isRevealed ? (
                      <EyeOffIcon className="text-sm" />
                    ) : (
                      <EyeIcon className="text-sm" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopyKey(k.id, k.key)}
                  className="text-xs"
                >
                  {isCopied ? (
                    <>
                      <CheckIcon className="text-accent text-sm" />
                      <span className="text-accent">Скопировано</span>
                    </>
                  ) : (
                    <>
                      <CopyIcon className="text-sm" />
                      <span>Копировать</span>
                    </>
                  )}
                </Button>
                {keys.length > 1 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRevokeKey(k.id)}
                    className="text-xs text-danger hover:bg-danger/10 hover:border-danger/40"
                  >
                    {t('apiDocs.revoke')}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <Callout tone="info" title="Безопасность">
        Никогда не передавайте API-ключ в публичный доступ или git-репозиторий. Используйте
        переменные окружения (<code className="font-mono text-accent">KETNER_API_KEY</code>) или
        секреты вашей операционной системы.
      </Callout>
    </section>
  );
}
