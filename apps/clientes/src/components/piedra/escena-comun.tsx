import { COLORES, ESCENA, EXTREMOS_TUBO, PIEDRA } from "@/components/home/escena-piedra";
import hero from "@/components/home/HeroPiedra.module.css";

/**
 * Piezas del dibujo de la piedra que comparten el hero y los bloques quietos (login, pie, 404,
 * carrito vacío, "Visítenos"). Todo sale de los datos de `escena-piedra.ts`; el encendido del LA
 * y su parpadeo son el CSS del hero (`HeroPiedra.module.css`), sin copiarlo.
 */

/** Id de un recurso del SVG, único por instancia: `id("la")`, `url("la")`. */
export function idsDe(uid: string) {
  const id = (nombre: string) => `${uid}-${nombre}`;
  return { id, url: (nombre: string) => `url(#${id(nombre)})` };
}

/** Clase del contenedor que enciende el LA cuando recibe `data-encendido` (CSS del hero). */
export const CLASE_ENCENDIBLE = hero.root;

/** Recorte del LA, máscara que lo deja afuera de las juntas y los dos desenfoques de su brillo. */
export function DefinicionesPiedra({ uid }: { uid: string }) {
  const { id } = idsDe(uid);
  return (
    <defs>
      <clipPath id={id("la")}><path d={PIEDRA.poligonoLA} /></clipPath>
      <mask id={id("sinLA")} maskUnits="userSpaceOnUse" x="0" y="0" width={ESCENA.ancho} height={ESCENA.alto}>
        <rect width={ESCENA.ancho} height={ESCENA.alto} fill="#fff" />
        <path d={PIEDRA.poligonoLA} fill="#000" stroke="#fff" strokeWidth="14.52" />
      </mask>
      <filter id={id("desenfoque")} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9" /></filter>
      <filter id={id("halo")} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="70" /></filter>
    </defs>
  );
}

/** Las juntas y los bordes del LA, en el color de la junta. Con LA, las juntas pasan por detrás de él. */
export function JuntasPiedra({ uid, conLA = true, opacidad }: { uid: string; conLA?: boolean; opacidad?: number }) {
  const { url } = idsDe(uid);
  return (
    <g opacity={opacidad}>
      <path d={PIEDRA.juntas} stroke={COLORES.junta} strokeWidth="6.6" fill="none" strokeLinejoin="bevel" mask={conLA ? url("sinLA") : undefined} />
      {conLA ? <path d={PIEDRA.bordes} stroke={COLORES.junta} strokeWidth="6.6" fill="none" /> : null}
    </g>
  );
}

/** El letrero LA: apagado (dibujo en color de junta) y, encima, la capa encendida y el halo. */
export function CapaLA({ uid }: { uid: string }) {
  const { url } = idsDe(uid);
  return (
    <>
      <ellipse className={hero.halo} cx="1860" cy="700" rx="380" ry="260" fill={COLORES.sodio} filter={url("halo")} />
      <g clipPath={url("la")}>
        <path d={PIEDRA.laApagado} stroke={COLORES.junta} strokeWidth="6.6" fill="none" />
        <g className={hero.laOn}>
          <path d={PIEDRA.laBrillo} stroke={COLORES.sodio} strokeWidth="19.8" fill="none" opacity=".6" filter={url("desenfoque")} />
          <path d={PIEDRA.laNucleo} stroke={COLORES.filamento} strokeWidth="7.92" fill="none" strokeLinecap="square" />
          {EXTREMOS_TUBO.map(r => <rect key={r.x} x={r.x} y={r.y} width={r.ancho} height={r.alto} fill={COLORES.sodio} />)}
        </g>
      </g>
    </>
  );
}

/** Polígono del LA, para la zona que se toca. */
export const POLIGONO_LA = PIEDRA.poligonoLA;
