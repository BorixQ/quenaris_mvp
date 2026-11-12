import { cloneElement, useEffect, useRef, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { CircleAlert, Info, LoaderCircle, CircleCheck, Clock3 } from 'lucide-react';
import { statusLabel, SCIENCE_NOTE, studyInfo } from '../data/studies';
import type { Statistics, Status } from '../types';
import s from '../styles/App.module.css';

export function Button({ variant, className = '', ...props }: ComponentProps<'button'> & { variant?: 'secondary' | 'danger' }) {
  return <button type="button" className={`${s.button} ${variant ? s[variant] : ''} ${className}`} {...props} />;
}
export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'warning' | 'success' }) {
  const Icon = tone === 'error' || tone === 'warning' ? CircleAlert : Info;
  return <div className={s.notice} data-tone={tone} role={tone === 'error' ? 'alert' : undefined}><Icon aria-hidden="true" /><div>{children}</div></div>;
}
export function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: ReactNode; children: ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }> }) {
  return <div className={s.field}><label htmlFor={id}>{label}</label>
    {cloneElement(children, { id, 'aria-invalid': !!error, 'aria-describedby': [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined })}
    {hint && <p className={s.hint} id={`${id}-hint`}>{hint}</p>}{error && <p className={s.fieldError} id={`${id}-error`}>{error}</p>}
  </div>;
}
export function StatusBadge({ status }: { status: Status }) {
  const Icon = status === 'COMPLETED' ? CircleCheck : status === 'FAILED' ? CircleAlert : status === 'PROCESSING' ? LoaderCircle : Clock3;
  return <span className={s.badge} data-status={status}><Icon aria-hidden="true" className={status === 'PROCESSING' ? s.spinner : undefined} />{statusLabel[status] || status}</span>;
}
export function StudyLabel({ value }: { value: string }) {
  const study = studyInfo(value);
  return <span>{study?.short || value}{study?.experimental && <span className={`${s.badge} ${s.experimental}`}>Experimental</span>}</span>;
}
export function ScienceNote() { return <p className={s.science} role="note" data-no-print><Info aria-hidden="true" />{SCIENCE_NOTE}</p>; }
export function AreaEstimateNotice({ statistics }: { statistics: Statistics }) {
  if (statistics.area_geometry_clipped === true) return null;
  return <Notice tone="warning">En este resultado, las áreas de los grupos se calcularon con celdas completas y pueden superar el terreno solicitado. Recalcula el análisis para recortar las áreas al polígono.</Notice>;
}
export function Loading({ text = 'Cargando datos…' }: { text?: string }) { return <div className={s.empty} role="status"><LoaderCircle className={s.spinner} aria-hidden="true" /><p>{text}</p></div>; }
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div className={`${s.card} ${s.empty}`}><CircleAlert aria-hidden="true" /><h2>No se pudo cargar esta información</h2><p>{error instanceof Error ? error.message : 'Vuelve a intentarlo.'}</p>{retry && <Button onClick={retry}>Volver a cargar</Button>}</div>;
}
export function ConfirmDialog({ open, title, children, confirm, cancel, busy = false, label = 'Confirmar' }: { open: boolean; title: string; children: ReactNode; confirm: () => void; cancel: () => void; busy?: boolean; label?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open && !ref.current?.open) ref.current?.showModal(); else if (!open && ref.current?.open) ref.current.close(); }, [open]);
  return <dialog className={s.dialog} ref={ref} aria-labelledby="confirm-title" onCancel={e => { e.preventDefault(); if (!busy) cancel(); }}><h2 id="confirm-title">{title}</h2><div>{children}</div><div className={s.buttonRow}><Button variant="secondary" autoFocus onClick={cancel} disabled={busy}>Volver</Button><Button variant="danger" onClick={confirm} disabled={busy}>{busy ? 'Espera…' : label}</Button></div></dialog>;
}
