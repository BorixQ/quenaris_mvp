export function number(value: unknown, digits = 1): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('es-PE', { maximumFractionDigits: digits }).format(value) : '—';
}
export function percent(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${number(value * 100)} %` : 'No registrada';
}
export function date(value: string): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return Number.isNaN(d.valueOf()) ? 'Fecha no disponible' : new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Lima' }).format(d);
}
export function limaToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (name: string) => parts.find(p => p.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function defaultDates(limit: number, now = new Date()) {
  const end = limaToday(now);
  return { date_start: shiftDate(end, -Math.max(0, Math.min(30, limit))), date_end: end };
}
export function dayCount(start: string, end: string): number {
  return (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000;
}
export function title(a: { name: string; created_at: string }) { return a.name || `Análisis del ${date(a.created_at)}`; }
export function downloadJson(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
