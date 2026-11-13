/**
 * Autocompletado de localidades con prioridad a las que atiende el comercio (change
 * `envio-por-zona-con-tarifa`, flag `envio-por-zona`). Módulo PURO.
 *
 * Georef devuelve por prefijo y no conoce las abreviaturas ("mdp"), así que "mar del" no encontraba
 * "Mar del Plata" antes de Villa del Mar... Acá se mezclan los resultados de Georef con las localidades
 * que atienden los métodos de envío ("locales"): primero las del comercio (por prefijo del nombre, por
 * prefijo de palabra o por abreviatura exacta), después Georef por prefijo, después el resto.
 *
 * Una localidad se identifica por provincia + nombre: si Georef y los locales coinciden, gana el local y
 * conserva su id Georef. Un local sin id sólo sube la posición de la coincidencia de Georef (no se puede
 * elegir sin id: la cookie de ubicación guarda el id de Georef).
 */
import type { MetodoEnvio } from "./envio-zona";
import { PROVINCIAS_AR } from "./provincias";
import { claveProvincia } from "./sucursales";
import { etiquetaLocalidad, MAX_LOCALIDADES, normalizarBusqueda, type SugerenciaLocalidad } from "./georef";

export interface LocalAtendida {
  /** id de Georef; sin id sólo sirve para priorizar. */
  id?: string;
  /** Nombre de la localidad ("Mar del Plata"). */
  nombre: string;
  /** Clave de provincia (`claveProvincia`). */
  provincia: string;
  provinciaNombre: string;
  abreviaturas: string[];
}

export interface OpcionLocalidad {
  id: string;
  etiqueta: string;
}

/** Mínimo de caracteres para que una abreviatura exacta cuente. */
const MIN_ABREVIATURA = 2;

type Rango = 0 | 1 | 2 | 3;

const clave = (provincia: string, nombre: string) => `${provincia}|${normalizarBusqueda(nombre)}`;

/** Rango de un local frente a lo escrito: 0 prefijo del nombre o abreviatura exacta, 1 prefijo de palabra, null no coincide. */
function rangoLocal(q: string, l: LocalAtendida, textoCorto: boolean): 0 | 1 | null {
  const abreviatura = l.abreviaturas.some((a) => normalizarBusqueda(a) === q);
  if (abreviatura && q.length >= MIN_ABREVIATURA) return 0;
  if (textoCorto) return null;
  const nombre = normalizarBusqueda(l.nombre);
  if (nombre.startsWith(q)) return 0;
  const palabras = nombre.split(" ");
  if (palabras.some((_, i) => i > 0 && palabras.slice(i).join(" ").startsWith(q))) return 1;
  return null;
}

const nombreProvincia = (clave: string, respaldo = ""): string =>
  PROVINCIAS_AR.find((p) => claveProvincia(p) === clave) ?? respaldo;

/** El nombre de una localidad de la etiqueta que guarda el CRM ("Mar del Plata — Buenos Aires" o sólo "Mar del Plata"). */
const nombreDeEtiqueta = (etiqueta: string): string => etiqueta.split(" — ")[0].trim();

/**
 * Las localidades que atiende el comercio: las de los métodos de envío ACTIVOS (con su id Georef y sus
 * abreviaturas) y las ciudades de las sucursales (sin id: sólo suben la posición de la coincidencia de Georef).
 */
export function localesAtendidas(
  metodos: MetodoEnvio[],
  sucursales: { ciudad: string; provincia: string }[] = [],
): LocalAtendida[] {
  const locales: LocalAtendida[] = [];
  for (const m of metodos) {
    if (!m.activo) continue;
    for (const l of m.localidades ?? []) {
      const nombre = nombreDeEtiqueta(l.etiqueta ?? "");
      if (!nombre) continue;
      locales.push({
        id: l.georefId,
        nombre,
        provincia: m.provinciaClave,
        provinciaNombre: nombreProvincia(m.provinciaClave),
        abreviaturas: l.abreviaturas ?? [],
      });
    }
  }
  for (const s of sucursales) {
    const provincia = claveProvincia(s.provincia);
    if (!s.ciudad || !provincia) continue;
    locales.push({ nombre: s.ciudad, provincia, provinciaNombre: nombreProvincia(provincia, s.provincia), abreviaturas: [] });
  }
  return locales;
}

export function priorizarLocalidades(
  texto: string,
  georef: SugerenciaLocalidad[],
  locales: LocalAtendida[],
): OpcionLocalidad[] {
  const q = normalizarBusqueda(texto);
  const textoCorto = q.length < 4;
  const etiquetaDe = (l: LocalAtendida) => `${l.nombre} — ${l.provinciaNombre}`;

  const delGeoref = new Map<string, SugerenciaLocalidad>();
  for (const g of georef) if (!delGeoref.has(clave(g.provincia, g.localidad))) delGeoref.set(clave(g.provincia, g.localidad), g);

  const salida: { op: OpcionLocalidad; rango: Rango; orden: number }[] = [];
  const vistos = new Set<string>();
  let orden = 0;

  for (const l of locales) {
    const rango = rangoLocal(q, l, textoCorto);
    if (rango === null) continue;
    const k = clave(l.provincia, l.nombre);
    if (vistos.has(k)) continue;
    const g = delGeoref.get(k);
    const id = l.id ?? g?.id;
    if (!id) continue;
    vistos.add(k);
    salida.push({ op: { id, etiqueta: g ? etiquetaLocalidad(g, georef) : etiquetaDe(l) }, rango, orden: orden++ });
  }

  for (const g of georef) {
    const k = clave(g.provincia, g.localidad);
    if (vistos.has(k)) continue;
    vistos.add(k);
    const prefijo = normalizarBusqueda(g.localidad).startsWith(q);
    salida.push({ op: { id: g.id, etiqueta: etiquetaLocalidad(g, georef) }, rango: prefijo ? 2 : 3, orden: orden++ });
  }

  return salida
    .sort((a, b) => a.rango - b.rango || a.orden - b.orden)
    .slice(0, MAX_LOCALIDADES)
    .map((s) => s.op);
}
