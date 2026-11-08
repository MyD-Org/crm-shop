"use client";

import { useEffect, useRef } from "react";
import { AccentText, Button } from "@myd-org/ui";
import { linkNext } from "@/components/catalogo/link-next";
import { enlazarEncendido } from "@/components/home/escena-piedra-controlador";
import { clasesVisibilidad, type VisitenosContent } from "@/data/home-defaults";
import { PiedraDecorativa, RECORTES } from "./PiedraDecorativa";
import { CLASE_ENCENDIBLE, POLIGONO_LA } from "./escena-comun";
import { linkExterno } from "./link-externo";
import estilos from "./piedra.module.css";

/**
 * Banda "Visítenos" de la home: el local sobre la piedra, con el texto a la izquierda (velo de la
 * Noche) y el LA a la derecha, apagado hasta acercar el puntero o tocarlo; entonces enciende con el
 * parpadeo del hero. Sólo eventos: no hay cuadros de animación. Con movimiento reducido el CSS del
 * hero lo deja encendido y quieto. Además del botón "Cómo llegar" puede llevar el llamado a
 * WhatsApp, que abre el mismo número de la sección `whatsapp` (`whatsappHref`).
 * Una pieza sin texto no se dibuja.
 */
export function VisitenosPiedra({ contenido, whatsappHref }: { contenido: VisitenosContent; whatsappHref?: string }) {
  const { eyebrow, titulo, tituloMobile, bajada, bajadaMobile, direccion, horarios, cta, whatsapp, visibilidadTextos } = contenido;
  const botonVisible = cta && cta.visibilidad !== "nunca" && cta.label && cta.href;
  const wa = whatsapp && whatsapp.visibilidad !== "nunca" && whatsapp.label && whatsappHref ? whatsapp : null;

  const raiz = useRef<HTMLElement>(null);
  const la = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (!raiz.current || !la.current) return;
    const zona = la.current;
    const { encender, soltar } = enlazarEncendido({ hero: raiz.current, la: zona });
    // Acercar el mouse lo enciende; en el celular alcanza con tocarlo (click).
    const acercar = (ev: Event) => { if ((ev as PointerEvent).pointerType === "mouse") encender(); };
    zona.addEventListener("pointerenter", acercar);
    return () => {
      soltar();
      zona.removeEventListener("pointerenter", acercar);
    };
  }, []);

  return (
    <section ref={raiz} className={`${CLASE_ENCENDIBLE} ${estilos.visitenos}`} data-visitenos="">
      <PiedraDecorativa recorte="bloque" alineacion="xMaxYMid" conLA />
      <svg aria-hidden="true" focusable="false" className={estilos.toque} viewBox={RECORTES.bloque} preserveAspectRatio="xMaxYMid slice">
        <path ref={la} className={estilos.laToque} d={POLIGONO_LA} />
      </svg>
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
        {botonVisible || wa ? (
          <div className={estilos.acciones}>
            {botonVisible ? (
              <Button
                href={cta.href}
                renderLink={cta.href.startsWith("/") ? linkNext : linkExterno}
                className={clasesVisibilidad(cta.visibilidad) || undefined}
              >
                {cta.label}
              </Button>
            ) : null}
            {wa ? (
              <div className={`${estilos.visitenosWhatsapp} ${clasesVisibilidad(wa.visibilidad)}`}>
                {wa.texto ? <p className={estilos.visitenosBajada}>{wa.texto}</p> : null}
                <Button href={whatsappHref} renderLink={linkExterno} variant={botonVisible ? "outline" : "primary"}>
                  {wa.label}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
