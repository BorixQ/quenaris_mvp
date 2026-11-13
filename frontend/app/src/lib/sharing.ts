export function sharedTokenFromLink(value: string, origin = window.location.origin): string {
  let url: URL;
  try { url = new URL(value.trim(), origin); }
  catch { throw new Error('Introduce un enlace de análisis compartido válido.'); }
  const match = /^\/compartido\/([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})(?:\/(?:informe|3d))?\/?$/i.exec(url.pathname);
  if (url.origin !== origin || !/^https?:$/.test(url.protocol) || !match) throw new Error('Usa un enlace de análisis compartido de este servidor.');
  return match[1];
}
