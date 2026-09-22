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
  return { eyebrow: "", titulo: "", imagen: DEFAULTS_HOME.ambientes.items[0].imagen, href: "/catalogo" };
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

const OPCIONALES: Partial<Record<SeccionHome, readonly string[]>> = {
  hero: ["acento"],
  ambientes: ["acento", "bajada"],
  destacados: ["acento", "bajada"],
  bannerDeco: ["acento"],
  decoGrid: ["acento"],
};

function trimProfundo(v: unknown): unknown {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map(trimProfundo);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, trimProfundo(val)]));
  }
  return v;
}

/**
 * Normaliza (sin validar) el borrador de una sección antes de mandarlo a la
 * server action: recorta espacios, convierte a `undefined` los opcionales
 * vacíos, castea `cantidad` a número y descarta ítems de lista vacíos. No
 * valida: eso lo hace `erroresSeccion` en el servidor (D5).
 */
export function normalizarPayload(seccion: SeccionHome, borrador: unknown): unknown {
  if (borrador === null || borrador === undefined) return borrador;
  const o = trimProfundo(borrador) as Record<string, unknown>;

  for (const campo of OPCIONALES[seccion] ?? []) {
    if (o[campo] === "") delete o[campo];
  }

  if (seccion === "destacados") {
    const cantidad = o.cantidad;
    if (typeof cantidad === "string") {
      const n = Number.parseInt(cantidad, 10);
      if (!Number.isNaN(n)) o.cantidad = n;
    }
    if (Array.isArray(o.imagenes) && o.imagenes.length === 0) delete o.imagenes;
    if (Array.isArray(o.skus) && o.skus.length === 0) delete o.skus;
  }

  if (seccion === "marquee" && Array.isArray(o.items)) {
    o.items = (o.items as string[]).filter((s) => typeof s === "string" && s.trim().length > 0);
  }

  if (seccion === "hero" && Array.isArray(o.usps)) {
    o.usps = (o.usps as { label?: string }[]).filter((u) => esTextoNoVacio(u?.label));
  }

  if ((seccion === "ambientes" || seccion === "decoGrid") && Array.isArray(o.chips)) {
    o.chips = (o.chips as { label?: string }[]).filter((c) => esTextoNoVacio(c?.label));
  }

  return o;
}

function esTextoNoVacio(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
