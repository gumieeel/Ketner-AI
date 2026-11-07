/**
 * Один PricingService на набор хранилищ: маршруты анализа, заявок и админки работают с одним
 * экземпляром (общий посев первой версии настроек).
 */

import type { DiscoveryStores } from '../discovery/runtime.js';
import { PricingService } from './service.js';

const services = new WeakMap<object, PricingService>();

export function pricingServiceFor(stores: DiscoveryStores | null): PricingService | null {
  const store = stores?.pricing;
  if (!store) return null;
  let service = services.get(store);
  if (!service) {
    service = new PricingService({ store });
    services.set(store, service);
  }
  return service;
}
