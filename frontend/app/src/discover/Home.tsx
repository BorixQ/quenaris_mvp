import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Layers3, Share2, Star } from 'lucide-react';
import { useFeatured } from '../lib/queries';
import PublicHeader from '../components/PublicHeader';
import ProjectCard from '../components/ProjectCard';
import { Button, ErrorState, Loading, ScienceNote } from '../components/UI';
import s from '../styles/App.module.css';

export default function Home({ gallery = false }: { gallery?: boolean }) {
  const [page, setPage] = useState(1), query = useFeatured(gallery ? page : 1);
  useEffect(() => {
    document.title = `${gallery ? 'Proyectos destacados' : 'Explora el territorio'} · Queñaris`;
    document.querySelector<HTMLElement>('#page-title')?.focus({ preventScroll: true });
  }, [gallery]);
  const projects = gallery ? query.data?.results : query.data?.results.slice(0, 3);
  return <><a href="#main-content" className={s.skip}>Saltar al contenido</a><PublicHeader /><main className={s.homeMain} id="main-content" tabIndex={-1}>
    {!gallery ? <section className={s.homeHero}><div><p className={s.eyebrow}>OBSERVACIÓN DEL TERRITORIO</p><h1 id="page-title" tabIndex={-1}>Explora el territorio.<br /><em>Comparte lo que observas.</em></h1><p>Consulta análisis satelitales, conoce sus diferencias y comparte una lectura del terreno con mapas, datos y contexto.</p><div className={s.buttonRow}><Link className={s.button} to="/destacados">Ver proyectos destacados<ArrowRight size={16} aria-hidden="true" /></Link><Link className={`${s.button} ${s.secondary}`} to="/analisis/nuevo">Crear mi análisis</Link></div><p className={s.heroNote}>Acceso libre a los destacados. Resultados exploratorios, sin calibración de campo.</p></div>
      <div className={s.heroTerrain} aria-hidden="true"><svg viewBox="0 0 500 350" fill="none"><path d="M-30 300C40 40 120 320 220 140S410 260 540 30M-30 270C40 10 120 290 220 110S410 230 540 0M-30 330C40 70 120 350 220 170S410 290 540 60M-30 360C40 100 120 380 220 200S410 320 540 90M-30 390C40 130 120 410 220 230S410 350 540 120" stroke="#7ba78a" strokeWidth="1.5"/><path d="m132 180 85-83 112 38 27 87-126 54-104-47Z" fill="#6ca17d44" stroke="#2f7146" strokeWidth="2"/><path d="m132 180 103 23 94-68M235 203l-5 73" stroke="#34784c" strokeWidth="1.5"/><circle cx="217" cy="97" r="6" fill="#166534"/></svg><div className={s.heroMapLabel}><Layers3 size={18} /><span>Mapas, datos y contexto<strong>Una lectura compartida del territorio</strong></span></div></div>
    </section> : <section className={s.galleryHeading}><p className={s.eyebrow}>ABIERTOS PARA EXPLORAR</p><h1 id="page-title" tabIndex={-1}>Proyectos destacados</h1><p className={s.subtitle}>Una selección de análisis compartidos por sus propietarios y destacados por la administración. Puedes consultarlos sin crear una cuenta.</p><Link className={s.textButton} to="/">Volver al inicio</Link></section>}
    <section aria-labelledby="featured-heading" className={s.featuredSection}><div className={s.heading}><div><p className={s.eyebrow}>SELECCIÓN DE LA COMUNIDAD</p><h2 id="featured-heading">{gallery ? 'Análisis para conocer el territorio' : 'Proyectos destacados'}</h2></div>{!gallery && <Link className={s.textButton} to="/destacados">Ver todos<ArrowRight size={15} aria-hidden="true" /></Link>}</div>
      {query.isPending ? <Loading text="Consultando proyectos destacados…" /> : query.isError ? <ErrorState error={query.error} retry={() => query.refetch()} /> : !projects?.length ? <div className={`${s.card} ${s.empty}`}><Star aria-hidden="true" /><h3>Los primeros destacados están por llegar</h3><p>Cuando la administración seleccione proyectos compartidos, podrás explorarlos aquí.</p></div>
        : <div className={s.projectGrid}>{projects.map(project => <ProjectCard key={project.analysis_id} project={project}><Link className={s.textButton} to={project.share_path!}>Explorar análisis<ArrowRight size={15} aria-hidden="true" /></Link></ProjectCard>)}</div>}
      {gallery && query.data && (query.data.previous || query.data.next) && <nav className={s.pagination} aria-label="Páginas de destacados"><Button variant="secondary" disabled={!query.data.previous} onClick={() => setPage(page - 1)}>Anterior</Button><span>Página {page}</span><Button variant="secondary" disabled={!query.data.next} onClick={() => setPage(page + 1)}>Siguiente</Button></nav>}
    </section>
    {!gallery && <section className={s.homeSteps} aria-label="Cómo usar Queñaris">{[
      { Icon: Layers3, name: 'Observa', description: 'Delimita un terreno y consulta sus diferencias con imágenes satelitales.' },
      { Icon: Share2, name: 'Comparte', description: 'Activa un enlace de lectura y decide cuándo retirar el acceso.' },
      { Icon: Star, name: 'Explora', description: 'Conoce proyectos destacados y guarda los análisis que recibes.' },
    ].map(({ Icon, name, description }) => <div key={name}><Icon size={21} aria-hidden="true" /><h2>{name}</h2><p>{description}</p></div>)}</section>}
    <ScienceNote /><footer className={s.homeFooter}><span>Queñaris · Observación del territorio</span><Link to="/login">Entrar a mi cuenta</Link></footer>
  </main></>;
}
