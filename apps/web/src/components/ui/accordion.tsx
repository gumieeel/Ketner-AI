import { useId, useState, type ReactNode } from 'react';
import { ChevronDownIcon } from '@/components/icons';
import { cn } from '@/lib/cn';

export interface AccordionItemData {
  id: string;
  title: ReactNode;
  content: ReactNode;
}

export interface AccordionProps {
  items: readonly AccordionItemData[];
  /** Открытые по умолчанию элементы. */
  defaultOpenIds?: readonly string[];
  /** Разрешить держать открытыми несколько элементов сразу. */
  multiple?: boolean;
  className?: string;
}

/**
 * Аккордеон на кнопках: aria-expanded / aria-controls, раскрытие через grid-rows
 * (без измерения высоты), закрытое содержимое выключено из tab-порядка и скринридера.
 */
export function Accordion({
  items,
  defaultOpenIds = [],
  multiple = false,
  className,
}: AccordionProps) {
  const baseId = useId();
  const [openIds, setOpenIds] = useState<readonly string[]>(defaultOpenIds);

  const toggle = (id: string) => {
    setOpenIds((current) => {
      if (current.includes(id)) {
        return current.filter((openId) => openId !== id);
      }
      return multiple ? [...current, id] : [id];
    });
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {items.map((item) => {
        const open = openIds.includes(item.id);
        const buttonId = `${baseId}-${item.id}-button`;
        const panelId = `${baseId}-${item.id}-panel`;

        return (
          <div
            key={item.id}
            data-open={open ? 'true' : 'false'}
            className={cn(
              'rounded-lg border transition-[background-color,border-color] duration-200 ease-out-expo',
              open ? 'border-stroke-strong bg-surface-2' : 'border-stroke bg-surface hover:bg-surface-2',
            )}
          >
            <h3 className="m-0">
              <button
                type="button"
                id={buttonId}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
                className="flex min-h-14 w-full items-center justify-between gap-4 rounded-lg px-5 py-4 text-left text-[16px] font-medium text-text"
              >
                <span className="text-balance">{item.title}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'inline-flex size-7 shrink-0 items-center justify-center text-muted',
                    'transition-[transform,color] duration-200 ease-out-expo',
                    open && 'rotate-180 text-text',
                  )}
                >
                  <ChevronDownIcon className="size-4" />
                </span>
              </button>
            </h3>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              inert={!open}
              className={cn(
                'grid transition-[grid-template-rows,opacity] duration-300 ease-out-expo',
                open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
              )}
            >
              <div className="overflow-hidden">
                <div className="max-w-[68ch] px-5 pb-5 text-[15px] leading-relaxed text-muted">{item.content}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
