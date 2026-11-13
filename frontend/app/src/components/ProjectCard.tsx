import { Link } from 'react-router-dom';
import { ArrowUpRight, MapPin } from 'lucide-react';
import { StudyLabel } from './UI';
import { date, number } from '../lib/format';
import type { ProjectSummary } from '../types';
import s from '../styles/App.module.css';

export default function ProjectCard({ project, children }: { project: ProjectSummary; children?: React.ReactNode }) {
  const points = project.aoi?.coordinates[0] || [], xs = points.map(c => c[0]), ys = points.map(c => c[1]);
  const west = Math.min(...xs), south = Math.min(...ys), dx = Math.max(...xs) - west || 1, dy = Math.max(...ys) - south || 1;
  return <article className={`${s.card} ${s.projectCard}`}>
    <div className={s.projectPreview} aria-hidden="true">{project.thumbnail_url ? <img src={project.thumbnail_url} alt="" loading="lazy" /> : <svg viewBox="0 0 360 148" preserveAspectRatio="xMidYMid slice"><path d="M-20 62Q55-2 128 52T380 22M-20 87Q55 23 128 77T380 47M-20 112Q55 48 128 102T380 72M-20 137Q55 73 128 127T380 97" fill="none" stroke="#c1d8c9" strokeWidth="1"/>{points.length > 0 && <polygon points={points.map(([x,y]) => `${125 + (x-west)/dx*110},${120 - (y-south)/dy*95}`).join(' ')} fill="#8dbb9b66" stroke="#34774a" strokeWidth="2" />}</svg>}<span><MapPin size={13} />{project.study_type ? <StudyLabel value={project.study_type} /> : 'Enlace guardado'}</span></div>
    <div className={s.projectBody}><h2>{project.share_path ? <Link to={project.share_path}>{project.name || 'Análisis sin nombre'}<ArrowUpRight size={17} aria-hidden="true" /></Link> : project.name || 'Análisis sin nombre'}</h2>
      {project.description && <p>{project.description}</p>}
      {project.date_start && project.date_end && <p className={s.small}>{date(project.date_start)} → {date(project.date_end)} · fin excluido<br />{number(project.area_ha, 2)} ha</p>}
      {!project.share_path && <p className={s.small}>El propietario retiró el acceso o el análisis ya no está disponible.</p>}
      {children}
    </div>
  </article>;
}
