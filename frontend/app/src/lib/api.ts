export const TOKEN_KEY = 'gi_token';
export const EXPIRED_EVENT = 'quenaris:session-expired';

export function token(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}
export class ApiError extends Error {
  constructor(public status: number, message: string, public fields: Record<string, string> = {}) { super(message); }
}
function messages(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(messages).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(messages).join(' ');
  return '';
}
export async function api<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const { auth = true, ...options } = init;
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (auth && token()) headers.set('Authorization', `Token ${token()}`);
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...options, headers, credentials: 'omit' }); }
  catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'No se pudo conectar con Queñaris. Revisa la conexión e inténtalo nuevamente.');
  }
  if (response.status === 204) return undefined as T;
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data: unknown = isJson ? await response.json() : null;
  if (!response.ok) {
    if (response.status === 401 && auth) {
      sessionStorage.removeItem(TOKEN_KEY);
      window.dispatchEvent(new Event(EXPIRED_EVENT));
    }
    const fields: Record<string, string> = {};
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      Object.entries(data).forEach(([k, v]) => { fields[k] = messages(v); });
    }
    const message = fields.detail || fields.non_field_errors || messages(data) ||
      (response.status === 404 ? 'No se encontró este recurso o no tienes acceso.' : 'El servidor no pudo completar la solicitud.');
    throw new ApiError(response.status, message, fields);
  }
  if (!isJson) throw new ApiError(response.status, 'La respuesta del servidor no es válida. Vuelve a intentarlo.');
  return data as T;
}

export function privateMapRequest(url: string) {
  const target = new URL(url, location.href);
  if (target.origin === location.origin && target.pathname.startsWith('/media/heatmaps/')) {
    const headers: Record<string, string> = {};
    if (token()) headers.Authorization = `Token ${token()}`;
    return { url: target.href, headers, credentials: 'same-origin' as const };
  }
  return { url };
}

export function privateImageExpired(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event(EXPIRED_EVENT));
}
