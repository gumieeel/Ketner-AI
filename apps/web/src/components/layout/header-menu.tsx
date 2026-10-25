import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpenIcon,
  CheckIcon,
  CodeIcon,
  MenuIcon,
  MessagesIcon,
  MoonIcon,
  SettingsIcon,
  SunIcon,
  TerminalIcon,
  UserIcon,
} from '@/components/icons';
import { useAuth } from '@/features/auth/auth-store';
import { usePreferences } from '@/features/preferences/preferences-store';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

const itemClass =
  'flex min-h-10 w-full items-center gap-3 rounded-md px-2.5 text-left text-[14px] text-text outline-none transition-colors duration-150 hover:bg-surface-3 focus-visible:bg-surface-3 max-md:min-h-11';

const sectionLabelClass = 'px-2.5 pt-1.5 pb-1 text-[12px] text-subtle';

/**
 * Меню в правом верхнем углу (три полоски): тема и быстрые переходы.
 * Обычное меню с клавиатуры: стрелки ходят по пунктам, Escape закрывает и возвращает фокус.
 */
export function HeaderMenu({ className }: { className?: string }) {
  const { t } = useTranslation();
  const theme = usePreferences((state) => state.theme);
  const setTheme = usePreferences((state) => state.setTheme);
  const signedIn = useAuth((state) => state.status === 'authenticated' && Boolean(state.user));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = (): HTMLElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    // Фокус на выбранную тему: первое осмысленное действие в меню.
    const all = items();
    (all.find((item) => item.getAttribute('aria-checked') === 'true') ?? all[0])?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      all[(index + 1) % all.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      all[(index - 1 + all.length) % all.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      all[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      all[all.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  const themes: Array<{ id: 'dark' | 'light'; label: string; icon: ReactNode }> = [
    { id: 'dark', label: t('settings.themeDark'), icon: <MoonIcon className="size-4" /> },
    { id: 'light', label: t('settings.themeLight'), icon: <SunIcon className="size-4" /> },
  ];
  const links: Array<{ to: string; label: string; icon: ReactNode }> = [
    { to: '/chat', label: t('nav.chat'), icon: <MessagesIcon className="size-4" /> },
    { to: '/code', label: t('nav.code'), icon: <CodeIcon className="size-4" /> },
    { to: '/docs/api', label: t('nav.apiDocs'), icon: <TerminalIcon className="size-4" /> },
    { to: '/docs', label: t('nav.docs'), icon: <BookOpenIcon className="size-4" /> },
    signedIn
      ? { to: '/settings', label: t('nav.settings'), icon: <SettingsIcon className="size-4" /> }
      : { to: '/login', label: t('nav.login'), icon: <UserIcon className="size-4" /> },
  ];

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={t('nav.menu')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          'grid size-9 place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text max-md:size-11',
          open && 'bg-surface-2 text-text',
        )}
      >
        <MenuIcon className="size-5" />
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t('nav.menu')}
          onKeyDown={onMenuKeyDown}
          className="absolute top-full right-0 z-[var(--z-dropdown)] mt-2 w-64 origin-top-right animate-scale-in rounded-lg border border-stroke-strong bg-surface-2 p-1.5 shadow-popover"
        >
          <div role="group" aria-label={t('settings.theme')}>
            <p aria-hidden="true" className={sectionLabelClass}>
              {t('settings.theme')}
            </p>
            {themes.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitemradio"
                aria-checked={theme === item.id}
                tabIndex={-1}
                onClick={() => setTheme(item.id)}
                className={itemClass}
              >
                <span className="text-muted">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {theme === item.id ? <CheckIcon className="size-4 text-accent" /> : null}
              </button>
            ))}
          </div>

          <div role="separator" className="my-1.5 border-t border-stroke" />

          {links.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              role="menuitem"
              tabIndex={-1}
              onClick={() => close(false)}
              className={itemClass}
            >
              <span className="text-muted">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
