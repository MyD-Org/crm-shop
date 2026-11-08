"use client";

import { useRef } from "react";
import { AccentText, Button } from "@myd-org/ui";
import { linkNext } from "@/components/catalogo/link-next";
import { EscenaPiedraViva } from "@/components/home/HeroPiedra";
import { clasesVisibilidad, WHATSAPP_VISITENOS_POR_DEFECTO, type VisitenosContent } from "@/data/home-defaults";
import { CLASE_ENCENDIBLE } from "./escena-comun";
import { linkExterno } from "./link-externo";
import estilos from "./piedra.module.css";

/**
 * Banda "Visítenos" de la home sobre la misma escena de la piedra que el hero: la luz sigue al
 * cursor y el LA enciende al acercarse o tocarlo (la escena se pausa fuera de pantalla). Texto
 * compacto a la izquierda, con el velo de la Noche. Además del botón "Cómo llegar" puede llevar el llamado a
 * WhatsApp, que abre el mismo número de la sección `whatsapp` (`whatsappHref`).
 * Una pieza sin texto no se dibuja.
 */
export function VisitenosPiedra({ contenido, whatsappHref }: { contenido: VisitenosContent; whatsappHref?: string }) {
  const { eyebrow, titulo, tituloMobile, bajada, bajadaMobile, direccion, horarios, cta, whatsapp, visibilidadTextos } = contenido;
  const botonVisible = cta && cta.visibilidad !== "nunca" && cta.label && cta.href;
  // Sin el campo guardado (filas anteriores al botón) va el de por defecto: dirección y WhatsApp juntos.
  // Para no mostrarlo, el editor lo deja en "Nunca".
  const waCfg = whatsapp ?? WHATSAPP_VISITENOS_POR_DEFECTO;
  const wa = waCfg.visibilidad !== "nunca" && waCfg.label && whatsappHref ? waCfg : null;

  const raiz = useRef<HTMLElement>(null);

  return (
    <section ref={raiz} className={`${CLASE_ENCENDIBLE} ${estilos.visitenos}`} data-visitenos="">
      <div className={estilos.visitenosEscena}>
        <EscenaPiedraViva raiz={raiz} sinBruma />
      </div>
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
        {wa?.texto ? <p className={`${estilos.visitenosNota} ${clasesVisibilidad(wa.visibilidad)}`}>{wa.texto}</p> : null}
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
              <Button
                href={whatsappHref}
                renderLink={linkExterno}
                variant={botonVisible ? "outline" : "primary"}
                className={clasesVisibilidad(wa.visibilidad) || undefined}
              >
                {wa.label}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
