import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { useAuth } from '../auth/Auth';
import { Brand } from './Layout';
import s from '../styles/App.module.css';

export default function PublicHeader() {
  const auth = useAuth();
  return <header className={s.sharedHeader} data-no-print><Brand home /><nav className={s.publicNav} aria-label="Navegación pública">
    <Link to="/destacados">Proyectos destacados</Link><Link className={`${s.button} ${s.secondary}`} to={auth.token ? '/analisis' : '/login'}>{auth.token ? 'Mis análisis' : 'Entrar a mi cuenta'}<ArrowUpRight size={15} aria-hidden="true" /></Link>
  </nav></header>;
}
