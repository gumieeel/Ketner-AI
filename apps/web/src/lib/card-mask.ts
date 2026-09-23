/**
 * Утилиты масок и валидации платёжной карты для заглушки оплаты.
 */

export function cleanDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function formatCardNumber(value: string): string {
  const digits = cleanDigits(value).slice(0, 16);
  const parts = digits.match(/.{1,4}/g);
  return parts ? parts.join(' ') : digits;
}

export function formatCardExpiry(value: string): string {
  const digits = cleanDigits(value).slice(0, 4);
  if (digits.length <= 2) {
    return digits;
  }
  return `${digits.slice(0, 2)} / ${digits.slice(2)}`;
}

export function formatCardCvc(value: string): string {
  return cleanDigits(value).slice(0, 4);
}

export function validateCardNumber(value: string): boolean {
  const digits = cleanDigits(value);
  return digits.length === 16;
}

export function validateCardExpiry(value: string): boolean {
  const digits = cleanDigits(value);
  if (digits.length !== 4) {
    return false;
  }

  const month = parseInt(digits.slice(0, 2), 10);
  const year = 2000 + parseInt(digits.slice(2, 4), 10);

  if (month < 1 || month > 12) {
    return false;
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (year < currentYear) {
    return false;
  }
  if (year === currentYear && month < currentMonth) {
    return false;
  }

  return true;
}

export function validateCardCvc(value: string): boolean {
  const digits = cleanDigits(value);
  return digits.length >= 3 && digits.length <= 4;
}
