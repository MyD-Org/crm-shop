"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { iniciarEscena } from "./escena-piedra-controlador";
import { COLORES, ESCENA, EXTREMOS_TUBO, LUZ_INICIAL, PIEDRA, RADIO_AMBIENTE, RADIO_LINTERNA } from "./escena-piedra";
import styles from "./HeroPiedra.module.css";

/** Deja el Hero del DS y su contenido intactos; sólo cambia el fondo por la escena de la piedra. */
export function HeroPiedra({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const luz = useRef<SVGCircleElement>(null);
  const ambiente = useRef<SVGCircleElement>(null);
  const la = useRef<SVGPathElement>(null);
  const uid = useId().replaceAll(":", "");

  useEffect(() => {
    const hero = root.current, lienzo = svg.current, c1 = luz.current, c2 = ambiente.current, boton = la.current;
    if (!enabled || !hero || !lienzo || !c1 || !c2 || !boton) return;
    return iniciarEscena({
      hero, la: boton, luz: c1, ambiente: c2,
      quieto: matchMedia("(prefers-reduced-motion: reduce)").matches,
      aEscena: ev => {
        const m = lienzo.getScreenCTM();
        if (!m) return null;
        const p = lienzo.createSVGPoint();
        p.x = ev.clientX; p.y = ev.clientY;
        return p.matrixTransform(m.inverse());
      },
      raf: cb => requestAnimationFrame(cb),
      caf: id => cancelAnimationFrame(id),
      observarVisible: cb => {
        const obs = new IntersectionObserver(([e]) => cb(e.isIntersecting));
        obs.observe(hero);
        return () => obs.disconnect();
      },
      observarPestana: cb => {
        document.addEventListener("visibilitychange", cb);
        return () => document.removeEventListener("visibilitychange", cb);
      },
      pestanaVisible: () => document.visibilityState !== "hidden",
    });
  }, [enabled]);

  if (!enabled) return <>{children}</>;

  const id = (nombre: string) => `${uid}-${nombre}`;
  const url = (nombre: string) => `url(#${id(nombre)})`;
  const vista = `0 0 ${ESCENA.ancho} ${ESCENA.alto}`;
  return <div ref={root} className={styles.root} data-hero-piedra="">
    {children}
    <div className={styles.scene}>
      <svg ref={svg} aria-hidden="true" className={styles.art} viewBox={vista} preserveAspectRatio="xMidYMid slice">
        <defs>
          <clipPath id={id("la")}><path d={PIEDRA.poligonoLA} /></clipPath>
          <mask id={id("sinLA")} maskUnits="userSpaceOnUse" x="0" y="0" width={ESCENA.ancho} height={ESCENA.alto}>
            <rect width={ESCENA.ancho} height={ESCENA.alto} fill="#fff" />
            <path d={PIEDRA.poligonoLA} fill="#000" stroke="#fff" strokeWidth="14.52" />
          </mask>
          <radialGradient id={id("cono")}>
            <stop offset="0" stopColor="#fff" /><stop offset=".45" stopColor="#fff" stopOpacity=".55" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <mask id={id("linterna")} maskUnits="userSpaceOnUse" x="0" y="0" width={ESCENA.ancho} height={ESCENA.alto}>
            <rect width={ESCENA.ancho} height={ESCENA.alto} fill="#000" />
            <circle ref={luz} cx={LUZ_INICIAL.x} cy={LUZ_INICIAL.y} r={RADIO_LINTERNA} fill={url("cono")} />
          </mask>
          <filter id={id("desenfoque")} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9" /></filter>
          <filter id={id("halo")} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="70" /></filter>
          <radialGradient id={id("ambiente")} cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor={COLORES.sodio} stopOpacity=".16" /><stop offset="1" stopColor={COLORES.sodio} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={ESCENA.ancho} height={ESCENA.alto} fill={COLORES.noche} />
        <circle ref={ambiente} cx={LUZ_INICIAL.x} cy={LUZ_INICIAL.y} r={RADIO_AMBIENTE} fill={url("ambiente")} />
        <path d={PIEDRA.juntas} stroke={COLORES.junta} strokeWidth="6.6" fill="none" strokeLinejoin="bevel" mask={url("sinLA")} />
        <path d={PIEDRA.bordes} stroke={COLORES.junta} strokeWidth="6.6" fill="none" />
        <g mask={url("linterna")}>
          <g mask={url("sinLA")}>
            <path d={PIEDRA.juntas} stroke={COLORES.sodio} strokeWidth="22" fill="none" strokeLinejoin="bevel" opacity=".55" filter={url("desenfoque")} />
            <path d={PIEDRA.juntas} stroke={COLORES.filamento} strokeWidth="6" fill="none" strokeLinejoin="bevel" />
          </g>
          <path d={PIEDRA.bordes} stroke={COLORES.filamento} strokeWidth="6" fill="none" />
        </g>
        <ellipse className={styles.halo} cx="1860" cy="700" rx="380" ry="260" fill={COLORES.sodio} filter={url("halo")} />
        <g clipPath={url("la")}>
          <path d={PIEDRA.laApagado} stroke={COLORES.junta} strokeWidth="6.6" fill="none" />
          <g className={styles.laOn}>
            <path d={PIEDRA.laBrillo} stroke={COLORES.sodio} strokeWidth="19.8" fill="none" opacity=".6" filter={url("desenfoque")} />
            <path d={PIEDRA.laNucleo} stroke={COLORES.filamento} strokeWidth="7.92" fill="none" strokeLinecap="square" />
            {EXTREMOS_TUBO.map(r => <rect key={r.x} x={r.x} y={r.y} width={r.ancho} height={r.alto} fill={COLORES.sodio} />)}
          </g>
        </g>
      </svg>
      {/* El LA es lo único interactivo y accesible de la escena. */}
      <svg className={styles.hit} viewBox={vista} preserveAspectRatio="xMidYMid slice">
        <path ref={la} className={styles.laHit} d={PIEDRA.poligonoLA} tabIndex={0} role="button" aria-label="Encender el LA" />
      </svg>
      <div className={styles.pista} aria-hidden="true">
        <i />
        <span className={styles.pistaMouse}>Mueva el cursor sobre la piedra y toque el LA</span>
        <span className={styles.pistaToque}>Toque el LA para encenderlo</span>
      </div>
    </div>
  </div>;
}
