import { useState } from 'react';
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon, KeyIcon, PlusIcon } from '@/components/icons';
import { Callout } from '@/components/docs/callout';
import { DocSection } from '@/components/docs/doc-section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { RichText } from '@/components/ui/rich-text';
import { useTranslation } from '@/i18n';
import { copyText } from '@/lib/clipboard';

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
    <DocSection
      id="keys"
      icon={<KeyIcon className="size-5" />}
      title={t('apiDocs.keysTitle')}
      description={t('apiDocs.keysDesc')}
      aside={
        <Button
          variant="primary"
          size="sm"
          aria-expanded={showKeyForm}
          onClick={() => setShowKeyForm((v) => !v)}
          className="gap-1.5"
        >
          <PlusIcon className="size-3.5" />
          {t('apiDocs.createKey')}
        </Button>
      }
    >
      {showKeyForm ? (
        <form
          onSubmit={handleCreateKey}
          className="flex animate-fade-in flex-col items-stretch gap-2 rounded-xl border border-accent/30 bg-surface-2 p-3 @md:flex-row @md:items-center"
        >
          <Input
            type="text"
            required
            autoFocus
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder={t('apiDocs.keyNamePlaceholder')}
            aria-label={t('apiDocs.keyNamePlaceholder')}
            className="flex-1"
          />
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" size="md">
              {t('apiDocs.keyCreate')}
            </Button>
            <Button type="button" variant="outline" size="md" onClick={() => setShowKeyForm(false)}>
              {t('apiDocs.keyCancel')}
            </Button>
          </div>
        </form>
      ) : null}

      <ul className="flex flex-col gap-2.5">
        {keys.map((k) => {
          const isRevealed = Boolean(revealedKeyIds[k.id]);
          const isCopied = copiedKeyId === k.id;
          const displayKey = isRevealed ? k.key : `${k.key.slice(0, 15)}••••••••••••••••••••••••••••`;

          return (
            <li
              key={k.id}
              className="flex flex-col justify-between gap-3 rounded-xl border border-stroke bg-canvas p-3.5 transition-colors hover:border-stroke-strong @md:flex-row @md:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="truncate text-sm font-semibold text-text">{k.name}</span>
                  <Badge tone="success" className="px-2 py-0 text-[11px]">
                    {t('apiDocs.keyActive')}
                  </Badge>
                  <span className="font-mono text-xs text-subtle">{k.createdAt}</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-stroke bg-surface px-2.5 py-1.5 font-mono text-xs text-text select-all @md:flex-none">
                    {displayKey}
                  </code>
                  <IconButton
                    size="sm"
                    label={isRevealed ? t('apiDocs.keyHide') : t('apiDocs.keyShow')}
                    aria-pressed={isRevealed}
                    onClick={() => toggleReveal(k.id)}
                  >
                    {isRevealed ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                  </IconButton>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => handleCopyKey(k.id, k.key)} className="gap-1.5">
                  {isCopied ? (
                    <>
                      <CheckIcon className="size-3.5 text-accent" />
                      <span className="text-accent">{t('apiDocs.keyCopied')}</span>
                    </>
                  ) : (
                    <>
                      <CopyIcon className="size-3.5" />
                      <span>{t('apiDocs.keyCopy')}</span>
                    </>
                  )}
                </Button>
                {keys.length > 1 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onRevokeKey(k.id)}
                    className="text-danger hover:border-danger/40 hover:bg-danger-soft"
                  >
                    {t('apiDocs.revoke')}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <Callout tone="info" title={t('apiDocs.keysSecurityTitle')} className="my-0">
        <RichText text={t('apiDocs.keysSecurityText')} />
      </Callout>
    </DocSection>
  );
}
