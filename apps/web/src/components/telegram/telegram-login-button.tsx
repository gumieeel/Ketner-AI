import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TelegramIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-store';
import { TelegramAuthDialog } from './telegram-auth-dialog';

/** «Войти через Telegram»: нового человека бот зарегистрирует сам, знакомого — впустит в его аккаунт. */
export function TelegramLoginButton({
  label,
  redirectUrl,
  disabled,
}: {
  label: string;
  redirectUrl: string;
  disabled?: boolean;
}) {
  const navigate = useNavigate();
  const applySession = useAuth((state) => state.applySession);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="lg"
        fullWidth
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="gap-2 text-sm font-medium"
      >
        <TelegramIcon className="size-4 shrink-0 text-[#229ED9]" />
        <span>{label}</span>
      </Button>
      {open ? (
        <TelegramAuthDialog
          mode="login"
          onClose={() => setOpen(false)}
          onLogin={async (session) => {
            await applySession(session);
            setOpen(false);
            navigate(redirectUrl, { replace: true });
          }}
        />
      ) : null}
    </>
  );
}
