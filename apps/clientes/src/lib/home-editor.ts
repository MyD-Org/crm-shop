import { DEFAULTS_HOME, type Enlace, type SeccionHome, type TileContent } from "@/data/home-defaults";

/**
 * Lógica pura del editor in-place de la home (home-editable, rebanada B1):
 * listas inmutables, normalización de borradores y copy de los títulos de
 * Dialog. Sin React, sin `env`, sin llamadas a red: se testea en node.
 */

/** Mueve `lista[i]` una posición (`delta`). Fuera de rango ⇒ copia sin cambios. Inmutable. */
export function moverItem<T>(lista: readonly T[], i: number, delta: -1 | 1): T[] {
  const j = i + delta;
  const copia = [...lista];
  if (j < 0 || j >= copia.length) return copia;
  [copia[i], copia[j]] = [copia[j], copia[i]];
  return copia;
}

/** Quita `lista[i]`. Índice fuera de rango ⇒ copia sin cambios. Inmutable. */
export function quitarItem<T>(lista: readonly T[], i: number): T[] {
  if (i < 0 || i >= lista.length) return [...lista];
  return [...lista.slice(0, i), ...lista.slice(i + 1)];
}

/** Agrega `item` al final. Inmutable. */
export function agregarItem<T>(lista: readonly T[], item: T): T[] {
  return [...lista, item];
}

export function nuevoEnlace(): Enlace {
  return { label: "", href: "/catalogo" };
}

/** Tile nuevo: hereda la imagen del primer tile de `ambientes` para que `esTile`
 *  valide aunque todavía no exista un editor de imágenes (ese llega en la
 *  rebanada C). */
export function nuevoTile(): TileContent {
  return { titulo: "", imagen: DEFAULTS_HOME.ambientes.items[0].imagen, href: "/catalogo" };
}

export function nuevoServicio(): { titulo: string; texto: string } {
  return { titulo: "", texto: "" };
}

/** Título humano del Dialog por sección (copy formal de usted). */
export const TITULOS_SECCION: Record<SeccionHome, string> = {
  anuncio: "Anuncio",
  hero: "Portada",
  marquee: "Cinta de mensajes",
  ambientes: "Ambientes",
  destacados: "Destacados",
  bannerDeco: "Banner decorativo",
  decoGrid: "Grilla decorativa",
  servicios: "Servicios",
  navBadge: "Badge del menú",
  whatsapp: "Contacto por WhatsApp",
};

/**
 * Marca (o desmarca) como acento el tramo `[desde, hasta)` de `texto`,
 * envolviéndolo en `*…*`. Si el tramo ya está entre marcas, las quita.
 * Devuelve el texto nuevo y la selección que queda sobre el mismo tramo, o
 * `null` si no hay nada seleccionado.
 */
export function alternarAcento(
  texto: string,
  desde: number,
  hasta: number,
): { texto: string; desde: number; hasta: number } | null {
  // El doble clic suele seleccionar también el espacio de al lado.
  while (desde < hasta && texto[desde] === " ") desde++;
  while (hasta > desde && texto[hasta - 1] === " ") hasta--;
  if (desde >= hasta) return null;

  const sel = texto.slice(desde, hasta);
  if (texto[desde - 1] === "*" && texto[hasta] === "*") {
    return { texto: texto.slice(0, desde - 1) + sel + texto.slice(hasta + 1), desde: desde - 1, hasta: hasta - 1 };
  }
  if (sel.length > 2 && sel.startsWith("*") && sel.endsWith("*")) {
    const interior = sel.slice(1, -1);
    return { texto: texto.slice(0, desde) + interior + texto.slice(hasta), desde, hasta: desde + interior.length };
  }
  const limpio = sel.replaceAll("*", "");
  return {
    texto: `${texto.slice(0, desde)}*${limpio}*${texto.slice(hasta)}`,
    desde: desde + 1,
    hasta: desde + 1 + limpio.length,
  };
}

function trimProfundo(v: unknown): unknown {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map(trimProfundo);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, trimProfundo(val)]));
  }
  return v;
}

/** Quita (recursivo, en objetos) los campos de texto que quedaron vacíos: un
 *  texto vacío significa "no mostrar", y en el contrato eso es ausente. */
function sinVacios(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sinVacios);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v)
        .filter(([, val]) => val !== "")
        .map(([k, val]) => [k, sinVacios(val)]),
    );
  }
  return v;
}

const sinEtiqueta = (e: unknown) => !esTextoNoVacio((e as { label?: unknown })?.label);

/**
 * Normaliza (sin validar) el borrador de una sección antes de mandarlo a la
 * server action: recorta espacios y descarta todo texto vacío (lo que el
 * admin deja vacío no se muestra), los enlaces sin etiqueta y los ítems de
 * lista vacíos; castea `cantidad` a número. No valida: eso lo hace
 * `erroresSeccion` en el servidor (D5).
 */
export function normalizarPayload(seccion: SeccionHome, borrador: unknown): unknown {
  if (borrador === null || borrador === undefined) return borrador;
  // Las listas de textos sueltos (marquee, skus, imagenes) se filtran abajo:
  // sinVacios solo toca campos de objetos.
  const o = sinVacios(trimProfundo(borrador)) as Record<string, unknown>;

  if (seccion === "destacados") {
    const cantidad = o.cantidad;
    if (typeof cantidad === "string") {
      const n = Number.parseInt(cantidad, 10);
      if (!Number.isNaN(n)) o.cantidad = n;
    }
    if (Array.isArray(o.imagenes) && o.imagenes.length === 0) delete o.imagenes;
    if (Array.isArray(o.skus)) {
      o.skus = (o.skus as string[]).filter(esTextoNoVacio);
      if ((o.skus as string[]).length === 0) delete o.skus;
    }
  }

  if (seccion === "marquee" && Array.isArray(o.items)) {
    o.items = (o.items as string[]).filter(esTextoNoVacio);
  }

  if (seccion === "hero") {
    if (Array.isArray(o.usps)) o.usps = (o.usps as { label?: string }[]).filter((u) => esTextoNoVacio(u?.label));
    if (Array.isArray(o.ctas)) o.ctas = (o.ctas as unknown[]).filter((e) => !sinEtiqueta(e));
  }

  if (seccion === "bannerDeco" && o.cta !== undefined && sinEtiqueta(o.cta)) delete o.cta;

  if ((seccion === "ambientes" || seccion === "decoGrid") && Array.isArray(o.chips)) {
    o.chips = (o.chips as unknown[]).filter((c) => !sinEtiqueta(c));
  }

  if (seccion === "servicios" && Array.isArray(o.items)) {
    o.items = (o.items as Record<string, unknown>[]).filter((s) => Object.keys(s ?? {}).length > 0);
  }

  return o;
}

function esTextoNoVacio(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
