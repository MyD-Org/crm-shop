/**
 * Piezas comunes de las páginas legales del Shop (/terminos, /privacidad,
 * /envios-y-pagos). Módulos puros: el contenido se arma acá y las páginas
 * solo lo pintan (`src/components/legales/PaginaLegal.tsx`), así los tests
 * cubren el texto sin DOM.
 *
 * Borrador sujeto a revisión legal: los textos cubren el mínimo que exige la
 * ley (Ley 24.240, CCyC arts. 1110–1116, Ley 25.326) y nada más. No agregar
 * plazos ni beneficios sin pasar por el abogado.
 */
import type { DatosLegales } from "@/data/home-defaults";

export type EnlaceLegal = { label: string; href: string; external?: boolean };

/** Una sección de una página legal: título, párrafos y enlaces opcionales al pie. */
export type Bloque = { titulo: string; parrafos: string[]; enlaces?: EnlaceLegal[] };

/** Ventanilla federal de reclamos de Defensa del Consumidor (redirige a la autogestión vigente). */
export const URL_DEFENSA_CONSUMIDOR = "https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario";

export const ENLACE_DEFENSA_CONSUMIDOR: EnlaceLegal = {
  label: "Ventanilla Federal de Defensa del Consumidor",
  href: URL_DEFENSA_CONSUMIDOR,
  external: true,
};

/**
 * Líneas de identificación del comercio, solo con los datos cargados en el
 * editor. Sin datos devuelve []: las páginas omiten la sección entera en vez
 * de mostrar etiquetas vacías o placeholders.
 */
export function identificacionComercio(d: DatosLegales): string[] {
  const lineas: string[] = [];
  if (d.razonSocial) lineas.push(`Razón social: ${d.razonSocial}`);
  if (d.cuit) lineas.push(`CUIT: ${d.cuit}`);
  if (d.domicilio) lineas.push(`Domicilio: ${d.domicilio}`);
  if (d.email) lineas.push(`Correo electrónico: ${d.email}`);
  return lineas;
}

/** Cómo contactar al comercio: el correo legal si está cargado, si no los medios del sitio. */
export function comoContactar(d: DatosLegales): string {
  return d.email
    ? `escribiendo a ${d.email}`
    : "por los medios de contacto indicados en este sitio";
}
