import { forwardRef } from 'react';
import { Link, NavLink, type LinkProps, type NavLinkProps } from 'react-router-dom';
import { usePreferences } from '@/features/preferences/preferences-store';
import { localizePath } from '@/lib/locale-path';

/** Link, который ведёт на английскую версию страницы (/en/...), если выбран английский. */
export const LocalizedLink = forwardRef<HTMLAnchorElement, LinkProps>(function LocalizedLink(
  { to, ...props },
  ref,
) {
  const language = usePreferences((state) => state.language);
  return (
    <Link ref={ref} to={typeof to === 'string' ? localizePath(to, language) : to} {...props} />
  );
});

export const LocalizedNavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(
  function LocalizedNavLink({ to, ...props }, ref) {
    const language = usePreferences((state) => state.language);
    return (
      <NavLink ref={ref} to={typeof to === 'string' ? localizePath(to, language) : to} {...props} />
    );
  },
);
