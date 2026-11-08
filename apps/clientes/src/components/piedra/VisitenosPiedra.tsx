import { AccentText, Button } from "@myd-org/ui";
import { linkNext } from "@/components/catalogo/link-next";
import { clasesVisibilidad, type VisitenosContent } from "@/data/home-defaults";
import { PiedraDecorativa } from "./PiedraDecorativa";
import { linkExterno } from "./link-externo";
import estilos from "./piedra.module.css";

/**
 * Banda "Visítenos" de la home: el local sobre la piedra, con las juntas que se encienden y se
 * apagan despacio (una capa propia que sólo cambia de opacidad) y sin LA. La dirección, los
 * horarios y el enlace "Cómo llegar" salen del contenido editable. Una pieza sin texto no se dibuja.
 */
export function VisitenosPiedra({ contenido }: { contenido: VisitenosContent }) {
  const { eyebrow, titulo, tituloMobile, bajada, bajadaMobile, direccion, horarios, cta, visibilidadTextos } = contenido;
  const botonVisible = cta && cta.visibilidad !== "nunca" && cta.label && cta.href;
  return (
    <section className={estilos.visitenos} data-visitenos="">
      <PiedraDecorativa brillo />
      <div className={estilos.visitenosTexto}>
        {eyebrow ? <p className={`${estilos.eyebrow} ${clasesVisibilidad(visibilidadTextos?.eyebrow)}`}>{eyebrow}</p> : null}
        {titulo || tituloMobile ? (
          <h2 className={`${estilos.visitenosTitulo} ${clasesVisibilidad(visibilidadTextos?.titulo)}`}>
            <AccentText text={titulo ?? ""} mobileText={tituloMobile} accentClassName="not-italic text-accent" />
          </h2>
        ) : null}
        {bajada || bajadaMobile ? (
          <p className={`${estilos.visitenosBajada} ${clasesVisibilidad(visibilidadTextos?.bajada)}`}>
            <AccentText text={bajada ?? ""} mobileText={bajadaMobile} />
          </p>
        ) : null}
        {direccion || horarios ? (
          <dl className={estilos.datos}>
            {direccion ? <div><dt>Dirección</dt><dd>{direccion}</dd></div> : null}
            {horarios ? <div><dt>Horarios</dt><dd>{horarios}</dd></div> : null}
          </dl>
        ) : null}
        {botonVisible ? (
          <Button
            href={cta.href}
            renderLink={cta.href.startsWith("/") ? linkNext : linkExterno}
            className={clasesVisibilidad(cta.visibilidad) || undefined}
          >
            {cta.label}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
