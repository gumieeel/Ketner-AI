import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-classes';
import { Modal } from '@/components/ui/modal';
import { Spinner } from '@/components/ui/spinner';
import { formatFileSize } from '@/features/chat/attachment-utils';
import { DiscoveryApiError } from '@/features/discovery/api';
import {
  deleteMaterial,
  fetchMaterial,
  listMaterials,
  uploadMaterial,
  type MaterialDetails,
  type MaterialSummary,
  type MaterialUsage,
} from '@/features/study/api';
import {
  extractDocument,
  fittingRange,
  MATERIAL_ACCEPT,
  MATERIAL_LIMITS,
  selectRange,
  type ExtractedDocument,
  type ExtractFailure,
} from '@/features/study/extract';
import { useTranslation, type TranslationKey } from '@/i18n';
import { formatDateTime } from '@/lib/format-date';
import { ErrorNotice } from '@/pages/analysis/error-notice';

/** Ошибки сервера при загрузке, которые сайт объясняет своими словами. */
const UPLOAD_ERRORS: Record<string, TranslationKey> = {
  material_no_text: 'study.materials.error.noText',
  material_too_large: 'study.materials.error.tooLarge',
  materials_limit: 'study.materials.error.limit',
  materials_storage_limit: 'study.materials.error.storage',
  invalid_material: 'study.materials.error.invalid',
};

const EXTRACT_ERRORS: Record<ExtractFailure, TranslationKey> = {
  unsupported: 'study.materials.error.unsupported',
  file_too_big: 'study.materials.error.fileTooBig',
  unreadable: 'study.materials.error.unreadable',
  encrypted: 'study.materials.error.encrypted',
  too_many_pages: 'study.materials.error.tooManyPages',
  no_text: 'study.materials.error.noText',
};

type Step =
  | { kind: 'idle' }
  | { kind: 'reading'; name: string }
  | {
      kind: 'oversize';
      document: ExtractedDocument;
      charCount: number;
      emptySections: number;
      from: number;
      to: number;
    }
  | { kind: 'uploading'; name: string };

type Notice = { tone: 'success' | 'warning'; text: string } | null;

export function MaterialsPanel({
  solutionId,
  onChange,
}: {
  solutionId: string;
  /** Документы добавили или удалили: другие разделы страницы обновляют выбор. */
  onChange?: () => void;
}) {
  const translator = useTranslation();
  const { t, language } = translator;
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [materials, setMaterials] = useState<MaterialSummary[] | null>(null);
  const [usage, setUsage] = useState<MaterialUsage | null>(null);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [notice, setNotice] = useState<Notice>(null);
  const [error, setError] = useState<unknown>(null);
  const [viewing, setViewing] = useState<MaterialSummary | null>(null);
  const [removing, setRemoving] = useState<MaterialSummary | null>(null);

  const number = (value: number) => value.toLocaleString(language === 'en' ? 'en-US' : 'ru-RU');
  // Последний обработчик — в ref: новый обработчик на каждой отрисовке не перезапускает загрузку.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const refresh = useCallback(async () => {
    try {
      const result = await listMaterials(solutionId);
      setMaterials(result.materials);
      setUsage(result.usage);
      onChangeRef.current?.();
    } catch (caught) {
      setError(caught);
    }
  }, [solutionId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const labels = {
    page: (n: number) => t('study.materials.section.page', { n }),
    slide: (n: number) => t('study.materials.section.slide', { n }),
    part: (n: number) => t('study.materials.section.part', { n }),
  };

  const upload = async (document: ExtractedDocument, emptySections: number) => {
    setStep({ kind: 'uploading', name: document.name });
    try {
      const result = await uploadMaterial(solutionId, document);
      const skipped =
        emptySections > 0 ? ` ${t('study.materials.skipped', { count: emptySections })}` : '';
      setNotice(
        result.duplicate
          ? {
              tone: 'warning',
              text: t('study.materials.duplicate', { name: result.material.name }),
            }
          : {
              tone: emptySections > 0 ? 'warning' : 'success',
              text: `${t('study.materials.uploaded', { name: result.material.name })}${skipped}`,
            },
      );
      await refresh();
    } catch (caught) {
      const key = caught instanceof DiscoveryApiError ? UPLOAD_ERRORS[caught.code] : undefined;
      if (key)
        setNotice({
          tone: 'warning',
          text: t(key, { max: number(MATERIAL_LIMITS.materialChars) }),
        });
      else setError(caught);
    } finally {
      setStep({ kind: 'idle' });
    }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setNotice(null);
    setError(null);
    setStep({ kind: 'reading', name: file.name });
    const result = await extractDocument(file, labels).catch(
      () => ({ ok: false, reason: 'unreadable' }) as const,
    );
    if (!result.ok) {
      setStep({ kind: 'idle' });
      setNotice({
        tone: 'warning',
        text: t(EXTRACT_ERRORS[result.reason], {
          max: formatFileSize(MATERIAL_LIMITS.fileBytes),
          pages: number(MATERIAL_LIMITS.materialSections),
        }),
      });
      return;
    }
    if (result.charCount > MATERIAL_LIMITS.materialChars) {
      const range = fittingRange(result.document.sections);
      setStep({
        kind: 'oversize',
        document: result.document,
        charCount: result.charCount,
        emptySections: result.emptySections,
        ...range,
      });
      return;
    }
    await upload(result.document, result.emptySections);
  };

  const busy = step.kind === 'reading' || step.kind === 'uploading';
  const full = usage !== null && usage.count >= usage.maxCount;

  return (
    <section aria-labelledby="materials-title" className="mt-10 border-t border-stroke pt-8">
      <h2 id="materials-title" className="text-[20px] font-medium tracking-[-0.01em] text-text">
        {t('study.materials.title')}
      </h2>
      <p className="mt-2 text-[14px] leading-6 text-muted">{t('study.materials.lead')}</p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={MATERIAL_ACCEPT}
          className="sr-only"
          disabled={busy || full || step.kind === 'oversize'}
          onChange={(event) => void onFile(event)}
        />
        <label
          htmlFor={inputId}
          aria-disabled={busy || full || step.kind === 'oversize'}
          className={buttonClasses({
            variant: 'primary',
            size: 'md',
            className:
              busy || full || step.kind === 'oversize'
                ? 'pointer-events-none cursor-not-allowed opacity-50'
                : 'cursor-pointer',
          })}
        >
          {t('study.materials.upload')}
        </label>
        <span className="text-[13px] text-subtle">
          {t('study.materials.formats', { max: formatFileSize(MATERIAL_LIMITS.fileBytes) })}
        </span>
      </div>

      {step.kind === 'reading' || step.kind === 'uploading' ? (
        <p role="status" className="mt-4 flex items-center gap-2 text-[14px] text-muted">
          <Spinner />{' '}
          {t(step.kind === 'reading' ? 'study.materials.reading' : 'study.materials.uploading', {
            name: step.name,
          })}
        </p>
      ) : null}

      {step.kind === 'oversize' ? (
        <OversizePicker
          step={step}
          number={number}
          onChange={(from, to) => setStep({ ...step, from, to })}
          onCancel={() => setStep({ kind: 'idle' })}
          onUpload={(document) => void upload(document, step.emptySections)}
        />
      ) : null}

      {notice ? (
        <p
          role="status"
          className={`mt-4 rounded-xl px-4 py-3 text-[14px] leading-6 ${
            notice.tone === 'success' ? 'bg-success-soft text-text' : 'bg-warning-soft text-text'
          }`}
        >
          {notice.text}
        </p>
      ) : null}
      {error ? (
        <div className="mt-4">
          <ErrorNotice error={error} redirect={`/solutions/${solutionId}`} />
        </div>
      ) : null}

      {materials === null && !error ? (
        <p className="mt-6 flex items-center gap-2 text-[14px] text-muted">
          <Spinner /> {t('analysis.page.loading')}
        </p>
      ) : null}
      {materials && materials.length === 0 ? (
        <p className="mt-6 text-[14px] text-muted">{t('study.materials.empty')}</p>
      ) : null}
      {materials && materials.length > 0 ? (
        <ul aria-label={t('study.materials.title')} className="mt-6 flex flex-col gap-3">
          {materials.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-3 rounded-xl border border-stroke p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="flex min-w-0 items-center gap-2">
                  <Badge>{item.format.toUpperCase()}</Badge>
                  <span className="truncate text-[15px] font-medium text-text">{item.name}</span>
                </p>
                <p className="mt-1 text-[13px] text-subtle">
                  {t('study.materials.meta', {
                    sections: number(item.sections.length),
                    chars: number(item.charCount),
                    size: formatFileSize(item.sizeBytes),
                    date: formatDateTime(item.createdAt, language),
                  })}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" onClick={() => setViewing(item)}>
                  {t('study.materials.view')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setRemoving(item)}>
                  {t('study.materials.delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {usage ? (
        <p className="mt-4 text-[13px] text-subtle">
          {t('study.materials.usage', {
            count: number(usage.count),
            max: number(usage.maxCount),
            used: number(usage.userChars),
            total: number(usage.maxUserChars),
          })}
        </p>
      ) : null}

      {viewing ? (
        <MaterialViewer
          solutionId={solutionId}
          material={viewing}
          onClose={() => setViewing(null)}
        />
      ) : null}
      {removing ? (
        <DeleteMaterial
          solutionId={solutionId}
          material={removing}
          onClose={() => setRemoving(null)}
          onDeleted={() => {
            setRemoving(null);
            setNotice(null);
            void refresh();
          }}
        />
      ) : null}
    </section>
  );
}

/** Документ больше лимита: пользователь выбирает диапазон частей, который уложится. */
function OversizePicker({
  step,
  number,
  onChange,
  onCancel,
  onUpload,
}: {
  step: Extract<Step, { kind: 'oversize' }>;
  number: (value: number) => string;
  onChange: (from: number, to: number) => void;
  onCancel: () => void;
  onUpload: (document: ExtractedDocument) => void;
}) {
  const { t } = useTranslation();
  const fromId = useId();
  const toId = useId();
  const total = step.document.sections.length;
  const selected = selectRange(step.document, step.from, step.to);
  const valid =
    step.from >= 1 &&
    step.to <= total &&
    step.from <= step.to &&
    selected.charCount > 0 &&
    selected.charCount <= MATERIAL_LIMITS.materialChars;
  const clamp = (value: string) => Math.min(total, Math.max(1, Math.trunc(Number(value) || 1)));
  const first = step.document.sections[step.from - 1]?.label ?? '';
  const last = step.document.sections[step.to - 1]?.label ?? '';

  return (
    <div className="mt-5 rounded-xl border border-stroke p-4">
      <p className="text-[14px] leading-6 text-text">
        {t('study.materials.oversize', {
          name: step.document.name,
          chars: number(step.charCount),
          max: number(MATERIAL_LIMITS.materialChars),
        })}
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label htmlFor={fromId} className="flex flex-col gap-1 text-[13px] text-muted">
          {t('study.materials.rangeFrom')}
          <input
            id={fromId}
            type="number"
            min={1}
            max={total}
            value={step.from}
            onChange={(event) => onChange(clamp(event.target.value), step.to)}
            className="w-24 rounded-lg border border-stroke bg-transparent px-3 py-2 text-[15px] text-text"
          />
        </label>
        <label htmlFor={toId} className="flex flex-col gap-1 text-[13px] text-muted">
          {t('study.materials.rangeTo', { total: number(total) })}
          <input
            id={toId}
            type="number"
            min={1}
            max={total}
            value={step.to}
            onChange={(event) => onChange(step.from, clamp(event.target.value))}
            className="w-24 rounded-lg border border-stroke bg-transparent px-3 py-2 text-[15px] text-text"
          />
        </label>
      </div>
      <p className={`mt-3 text-[13px] ${valid ? 'text-subtle' : 'text-danger'}`}>
        {t('study.materials.rangeSummary', {
          first,
          last,
          chars: number(selected.charCount),
          max: number(MATERIAL_LIMITS.materialChars),
        })}
      </p>
      <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row">
        <Button variant="outline" onClick={onCancel}>
          {t('analysis.new.cancel')}
        </Button>
        <Button disabled={!valid} onClick={() => onUpload(selected.document)}>
          {t('study.materials.uploadRange')}
        </Button>
      </div>
    </div>
  );
}

/** Что Ketner прочитал из документа: текст по частям, как его увидит инструмент. */
function MaterialViewer({
  solutionId,
  material,
  onClose,
}: {
  solutionId: string;
  material: MaterialSummary;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [details, setDetails] = useState<MaterialDetails | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let alive = true;
    fetchMaterial(solutionId, material.id).then(
      (loaded) => alive && setDetails(loaded),
      (caught: unknown) => alive && setError(caught),
    );
    return () => {
      alive = false;
    };
  }, [solutionId, material.id]);

  return (
    <Modal labelledBy="material-viewer-title" size="lg" onClose={onClose}>
      <div className="flex max-h-[80vh] flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <h2
            id="material-viewer-title"
            className="min-w-0 text-[18px] font-medium break-words text-text"
          >
            {material.name}
          </h2>
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('study.materials.close')}
          </Button>
        </div>
        <p className="text-[13px] text-subtle">{t('study.materials.viewerLead')}</p>
        {error ? <ErrorNotice error={error} redirect={`/solutions/${solutionId}`} /> : null}
        {!details && !error ? (
          <p className="flex items-center gap-2 text-[14px] text-muted">
            <Spinner /> {t('analysis.page.loading')}
          </p>
        ) : null}
        {details ? (
          <div className="min-h-0 overflow-y-auto pr-1">
            {details.sections.map((section) => (
              <section key={section.id} className="border-t border-stroke py-3 first:border-t-0">
                <h3 className="text-[13px] font-medium text-subtle">{section.label}</h3>
                <p className="mt-1 text-[14px] leading-6 break-words whitespace-pre-wrap text-text">
                  {section.text}
                </p>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function DeleteMaterial({
  solutionId,
  material,
  onClose,
  onDeleted,
}: {
  solutionId: string;
  material: MaterialSummary;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal labelledBy="delete-material-title" size="sm" onClose={onClose}>
      <div className="flex flex-col gap-4 p-6">
        <h2 id="delete-material-title" className="text-[18px] font-medium text-text">
          {t('study.materials.deleteTitle')}
        </h2>
        <p className="text-[14px] leading-6 text-muted">
          {t('study.materials.deleteText', { name: material.name })}
        </p>
        {error ? <ErrorNotice error={error} redirect={`/solutions/${solutionId}`} /> : null}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            {t('analysis.new.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              deleteMaterial(solutionId, material.id).then(onDeleted, (caught: unknown) => {
                setError(caught);
                setBusy(false);
              });
            }}
          >
            {t('study.materials.delete')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
