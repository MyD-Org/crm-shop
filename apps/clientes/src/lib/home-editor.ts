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

/** Texto plano + qué caracteres van en acento. El contrato guarda `*marcas*`;
 *  el editor trabaja sobre este modelo para no mostrar los asteriscos. */
export type Mascara = { texto: string; acento: boolean[] };

/** `"Los más *vendidos*"` ⇒ texto plano y máscara de acento. */
export function aMascara(marcado: string): Mascara {
  let texto = "";
  const acento: boolean[] = [];
  let desde = 0;
  for (const m of marcado.matchAll(/\*([^*]+)\*/g)) {
    const i = m.index ?? 0;
    const normal = marcado.slice(desde, i);
    texto += normal;
    acento.push(...Array<boolean>(normal.length).fill(false));
    texto += m[1];
    acento.push(...Array<boolean>(m[1].length).fill(true));
    desde = i + m[0].length;
  }
  const resto = marcado.slice(desde);
  texto += resto;
  acento.push(...Array<boolean>(resto.length).fill(false));
  return { texto, acento };
}

/** Inversa de `aMascara`. Los `*` sueltos del texto se descartan: son la marca. */
export function aMarcas({ texto, acento }: Mascara): string {
  // Tramos consecutivos con el mismo estado de acento.
  const tramos: { texto: string; acento: boolean }[] = [];
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] === "*") continue;
    const ultimo = tramos.at(-1);
    if (ultimo && ultimo.acento === !!acento[i]) ultimo.texto += texto[i];
    else tramos.push({ texto: texto[i], acento: !!acento[i] });
  }
  return tramos
    .map((t) => {
      if (!t.acento || t.texto.trim() === "") return t.texto;
      // Los espacios de los bordes quedan afuera de las marcas.
      const [, antes, medio, despues] = /^(\s*)([\s\S]*?)(\s*)$/.exec(t.texto)!;
      return `${antes}*${medio}*${despues}`;
    })
    .join("");
}

/**
 * Pinta (o despinta, si ya estaba todo pintado) el tramo `[desde, hasta)` del
 * texto plano. Devuelve el texto con marcas, o `null` si no hay selección.
 */
export function alternarAcento(marcado: string, desde: number, hasta: number): string | null {
  const m = aMascara(marcado);
  while (desde < hasta && m.texto[desde] === " ") desde++;
  while (hasta > desde && m.texto[hasta - 1] === " ") hasta--;
  if (desde >= hasta) return null;
  const pintar = !m.acento.slice(desde, hasta).every(Boolean);
  const acento = m.acento.map((v, i) => (i >= desde && i < hasta ? pintar : v));
  return aMarcas({ texto: m.texto, acento });
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

  if (Array.isArray(o.camposOcultos) && o.camposOcultos.length === 0) delete o.camposOcultos;

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
