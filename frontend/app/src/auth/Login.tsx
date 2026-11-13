import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, LockKeyhole, LoaderCircle } from 'lucide-react';
import { useAuth } from './Auth';
import { api } from '../lib/api';
import { Brand } from '../components/Layout';
import { Button, Field, Notice } from '../components/UI';
import s from '../styles/App.module.css';

declare global {
  interface Window { google?: { accounts: { id: { initialize: (options: { client_id: string; callback: (response: { credential: string }) => void; auto_select: boolean }) => void; renderButton: (parent: HTMLElement, options: { theme: string; size: string; width: number; locale: string }) => void } } } }
}
let googleScript: Promise<void> | null = null;
function loadGoogle(): Promise<void> {
  if (window.google) return Promise.resolve();
  if (!googleScript) googleScript = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    script.onload = () => resolve(); script.onerror = () => { script.remove(); googleScript = null; reject(new Error('No se pudo cargar Google. Revisa la conexión o los bloqueadores del navegador.')); };
    document.head.appendChild(script);
  });
  return googleScript;
}
export default function Login() {
  const auth = useAuth(), navigate = useNavigate(), location = useLocation();
  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => api<{ google_client_id: string; public_signup?: boolean; email_code_enabled?: boolean }>('/auth/config/', { auth: false }) });
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [emailMode, setEmailMode] = useState(false), [email, setEmail] = useState(''), [code, setCode] = useState(''), [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState(''), [googleError, setGoogleError] = useState(''), [busy, setBusy] = useState(false);
  const googleRef = useRef<HTMLDivElement>(null);
  const from: string = typeof location.state?.from === 'string' && location.state.from.startsWith('/') && !location.state.from.startsWith('//') ? location.state.from : '/analisis';
  const onGoogle = useCallback(async (response: { credential: string }) => {
    setError(''); setBusy(true);
    try { await auth.googleSignIn(response.credential); navigate(from, { replace: true }); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión con Google.'); } finally { setBusy(false); }
  }, [auth.googleSignIn, navigate, from]);
  useEffect(() => {
    document.title = 'Acceso · Queñaris';
    let live = true;
    if (config.data?.google_client_id) loadGoogle().then(() => {
      if (!live || !googleRef.current || !window.google) return;
      googleRef.current.replaceChildren();
      window.google.accounts.id.initialize({ client_id: config.data.google_client_id, callback: onGoogle, auto_select: false });
      window.google.accounts.id.renderButton(googleRef.current, { theme: 'outline', size: 'large', width: Math.min(360, googleRef.current.clientWidth || 300), locale: 'es' });
    }).catch(e => { if (live) setGoogleError(e.message); });
    return () => { live = false; };
  }, [config.data, onGoogle]);
  if (auth.token) return <Navigate to={from} replace />;
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return; setError(''); setBusy(true);
    try { await auth.signIn(username.trim(), password); navigate(from, { replace: true }); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión.'); } finally { setBusy(false); }
  }
  async function requestCode(e?: FormEvent) {
    e?.preventDefault(); if (busy) return; setError(''); setBusy(true);
    try { await api('/auth/email/request/', { method: 'POST', auth: false, body: JSON.stringify({ email: email.trim() }) }); setCode(''); setCodeSent(true); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo enviar el correo.'); } finally { setBusy(false); }
  }
  async function submitCode(e: FormEvent) {
    e.preventDefault(); if (busy) return; setError(''); setBusy(true);
    try { await auth.emailSignIn(email.trim(), code); navigate(from, { replace: true }); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo verificar el código.'); } finally { setBusy(false); }
  }
  return <div className={s.login}><aside className={s.loginAside}><Brand /><h1>Observa el terreno.<br /><em>Comprende sus diferencias.</em></h1>
    <p>Exploración satelital para acompañar el trabajo de agrónomos y técnicos. Del área de interés a los datos, con su contexto y sus límites.</p>
    <svg className={s.contour} viewBox="0 0 450 180" fill="none" aria-hidden="true"><path d="M-20 164C40 10 118 174 190 80S343 60 480 5M-20 149C44-3 123 157 189 64S350 46 480-10M-20 178C45 30 113 191 199 98S346 82 480 24M-20 191C56 50 122 205 207 116S361 101 480 39M-20 207C52 65 135 215 215 137S365 118 480 56" stroke="currentColor" strokeWidth="1.2"/><path d="m139 125 54-55 77 30-20 53-82 8Z" fill="#16653414" stroke="#166534" strokeWidth="2"/><circle cx="194" cy="70" r="4" fill="#166534"/></svg>
    <small>Sentinel-2 · Arequipa y ecosistemas altoandinos<br />Resultados exploratorios. La observación de campo sigue siendo esencial.</small>
  </aside><main className={s.loginMain}><div className={s.loginForm}><p className={s.eyebrow}>TU ESPACIO DE TRABAJO</p><h2>Bienvenido a Queñaris</h2><p>{config.data?.public_signup ? 'Entra o crea tu cuenta para consultar tus análisis.' : 'Accede para crear y consultar tus análisis.'}</p>
    {location.state?.notice && <Notice tone="warning">{String(location.state.notice)}</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
    <div className={s.google} ref={googleRef} role="group" aria-label="Acceso con Google" />
    {busy && <p className={s.small} role="status"><LoaderCircle className={s.spinner} aria-hidden="true" /> Iniciando sesión…</p>}
    {googleError && <Notice tone="warning">{googleError}</Notice>}
    {config.isError && <Notice tone="warning">No se pudo comprobar el acceso con Google. <button className={s.textButton} onClick={() => config.refetch()}>Volver a comprobar</button></Notice>}
    {config.data && !config.data.google_client_id && <p className={s.small}>Google no está habilitado en este servidor. Puedes usar tu cuenta local.</p>}
    {config.data?.email_code_enabled && <><div className={s.divider}>O CONTINÚA CON TU CORREO</div>{!emailMode ? <Button variant="secondary" className={s.full} onClick={() => { setEmailMode(true); setError(''); }}>Recibir un código por correo</Button> : !codeSent ? <form onSubmit={requestCode}>
      <Field id="email-code-address" label="Correo electrónico"><input type="email" name="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required value={email} onChange={e => setEmail(e.target.value)} disabled={busy} /></Field>
      <Button type="submit" className={s.full} disabled={busy}>{busy ? 'Enviando…' : 'Enviar código'}</Button>
    </form> : <form onSubmit={submitCode}>
      <p className={s.small} role="status">Si {email} puede usar este acceso, recibirá un mensaje. El código caduca en 10 minutos. Si ya tienes una cuenta anterior, usa tu método habitual.</p>
      <Field id="email-code" label="Código de 8 dígitos"><input autoFocus type="text" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} required value={code} onChange={e => setCode(e.target.value)} disabled={busy} /></Field>
      <Button type="submit" className={s.full} disabled={busy}>{busy ? 'Verificando…' : 'Verificar y entrar'}</Button>
      <p className={s.small}>Puedes pedir otro código después de un minuto.</p><Button variant="secondary" onClick={() => requestCode()} disabled={busy}>Reenviar código</Button> <button type="button" className={s.textButton} onClick={() => { setCodeSent(false); setCode(''); setError(''); }} disabled={busy}>Cambiar correo</button>
    </form>}</>}
    <div className={s.divider}>O USA TU CUENTA LOCAL</div><form onSubmit={submit}>
      <Field id="username" label="Correo o usuario"><input autoComplete="username" autoCapitalize="none" spellCheck={false} required value={username} onChange={e => setUsername(e.target.value)} disabled={busy} /></Field>
      <Field id="password" label="Contraseña"><input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></Field>
      <Button type="submit" className={s.full} disabled={busy}>Entrar a mi cuenta <ArrowRight aria-hidden="true" /></Button>
    </form>{!config.data?.public_signup && <p className={s.small}>Las cuentas y el acceso con Google se habilitan desde la administración.</p>}<p className={s.science}><LockKeyhole aria-hidden="true" />Tus análisis y mapas son privados. Solo se muestran a tu cuenta.</p>
  </div></main></div>;
}
