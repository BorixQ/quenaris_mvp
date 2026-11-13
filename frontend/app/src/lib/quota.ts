import type { Quota } from '../types';

export const usesAreaQuota = (q: Quota) => q.area_allowance_ha != null && q.area_remaining_ha != null;
export const quotaRemaining = (q: Quota) => usesAreaQuota(q) ? Math.max(0, q.area_remaining_ha!) : Math.max(0, q.analyses_allowed - q.analyses_used);
export const maxTerrain = (q: Quota) => Math.min(5000, q.max_area_ha, usesAreaQuota(q) ? quotaRemaining(q) : Infinity);
export const periodLabel = (days: number) => `${days} días${days === 124 ? ' (aproximadamente 4 meses)' : ''}`;
