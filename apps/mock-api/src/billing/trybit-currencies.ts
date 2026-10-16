/**
 * Валюты и сети, в которых Trybit принимает оплату (support.trybit.com → «Валюты, сети и лимиты»,
 * коды — docs.trybit.com → «Создание счёта», add_fields.available_currencies).
 * Коды PEPE_BSC и XAUT_TON есть в API, но не в списке поддерживаемых сетей — их не предлагаем.
 */
export const TRYBIT_CURRENCIES = [
  'BTC',
  'LTC',
  'TRX',
  'SOL',
  'TON',
  'BNB',
  'ETH',
  'ETH_ARB',
  'ETH_BASE',
  'ETH_OPT',
  'USDT_TRC20',
  'USDT_BSC',
  'USDT_TON',
  'USDT_ERC20',
  'USDT_ARB',
  'USDT_OPT',
  'USDT_SOL',
  'USDC_BSC',
  'USDC_ERC20',
  'USDC_BASE',
  'USDC_ARB',
  'USDC_OPT',
  'USDC_SOL',
  'DAI_BSC',
  'DAI_ERC20',
  'DAI_BASE',
  'DAI_ARB',
  'DAI_OPT',
  'PYUSD_ERC20',
  'PYUSD_SOL',
  'USDD_TRC20',
  'XAUT_ERC20',
  'ARB_ARB',
  'OP_OPT',
  'SHIB_ERC20',
  'SHIB_BSC',
  'PEPE_ERC20',
  'TRUMP_SOL',
] as const;

export type TrybitCurrency = (typeof TRYBIT_CURRENCIES)[number];

export function isTrybitCurrency(value: unknown): value is TrybitCurrency {
  return typeof value === 'string' && (TRYBIT_CURRENCIES as readonly string[]).includes(value);
}
