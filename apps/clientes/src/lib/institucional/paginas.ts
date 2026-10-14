/**
 * Páginas institucionales por tienda (preguntas frecuentes, garantía, envíos y
 * devoluciones, nosotros y contacto). Módulo PURO: lo importan el servidor, las
 * server actions y el editor cliente.
 *
 * Cada página es una fila `pagina:<slug>` de `home_content` (acotada por tenant,
 * ver `home-guardar.ts`) con la forma `{ publicada, bloques? }`. Sin fila o con
 * `publicada: false` la ruta responde 404 y la página no aparece en el footer ni
 * en el sitemap. Sin `bloques` se muestra el texto base de `base.ts`.
 *
 * Contenido: texto plano. El marcado se descarta al guardar y al leer (React
 * además escapa todo al pintar); no hay enlaces ni formato que el editor pueda
 * inyectar.
 *
 * Nota: NO existe `/envios-y-pagos` acá. Esa es la página legal generada desde
 * la configuración de envío y medios de pago.
 */
import type { Bloque } from "@/lib/legales/comun";

export type SlugInstitucional =
  | "preguntas-frecuentes"
  | "garantia"
  | "envios-y-devoluciones"
  | "nosotros"
  | "contacto";

export type PaginaInstitucional = { slug: SlugInstitucional; titulo: string; key: string };

const crear = (slug: SlugInstitucional, titulo: string): PaginaInstitucional => ({
  slug,
  titulo,
  key: `pagina:${slug}`,
});

/** En el orden en que se listan en el editor y en el footer. */
export const PAGINAS_INSTITUCIONALES: readonly PaginaInstitucional[] = [
  crear("preguntas-frecuentes", "Preguntas frecuentes"),
  crear("garantia", "Garantía"),
  crear("envios-y-devoluciones", "Envíos y devoluciones"),
  crear("nosotros", "Nosotros"),
  crear("contacto", "Contacto"),
];

export const MAX_PAGINA = { bloques: 20, parrafos: 20, titulo: 120, parrafo: 2000 } as const;

export function esSlugInstitucional(slug: string): slug is SlugInstitucional {
  return PAGINAS_INSTITUCIONALES.some((p) => p.slug === slug);
}

export function claveDePagina(slug: SlugInstitucional): string {
  return `pagina:${slug}`;
}

export function paginaDe(slug: SlugInstitucional): PaginaInstitucional {
  return PAGINAS_INSTITUCIONALES.find((p) => p.slug === slug)!;
}

/** Bloque editable: solo título y párrafos (sin enlaces). */
export type BloqueEditable = Pick<Bloque, "titulo" | "parrafos">;

export type PayloadPagina = { publicada: boolean; bloques?: BloqueEditable[] };

const registro = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Texto plano: sin etiquetas ni `<`/`>`, sin caracteres de control, espacios colapsados. */
export function textoPlano(valor: unknown): string {
  if (typeof valor !== "string") return "";
  return valor
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lectura estricta de lo guardado: cualquier cosa rara degrada a "no publicada".
 * Una fila tocada a mano en la base no rompe el sitio ni inyecta marcado.
 */
export function sanearPagina(raw: unknown): PayloadPagina {
  if (!registro(raw)) return { publicada: false };
  const publicada = raw.publicada === true;
  const bloques: BloqueEditable[] = [];
  if (Array.isArray(raw.bloques)) {
    for (const b of raw.bloques) {
      if (!registro(b)) continue;
      const titulo = textoPlano(b.titulo).slice(0, MAX_PAGINA.titulo);
      const parrafos = (Array.isArray(b.parrafos) ? b.parrafos : [])
        .map((p) => textoPlano(p).slice(0, MAX_PAGINA.parrafo))
        .filter(Boolean)
        .slice(0, MAX_PAGINA.parrafos);
      if (titulo && parrafos.length) bloques.push({ titulo, parrafos });
      if (bloques.length >= MAX_PAGINA.bloques) break;
    }
  }
  return bloques.length ? { publicada, bloques } : { publicada };
}

/** Errores (en usted) de un payload que llega del editor. [] = válido. */
export function validarPagina(raw: unknown): string[] {
  if (!registro(raw)) return ["El contenido de la página no es válido."];
  const errores: string[] = [];
  if (typeof raw.publicada !== "boolean") errores.push("Indique si la página está publicada.");
  if (raw.bloques === undefined) return errores;
  if (!Array.isArray(raw.bloques)) return [...errores, "Los bloques de la página no son válidos."];
  if (raw.bloques.length > MAX_PAGINA.bloques) {
    errores.push(`La página admite hasta ${MAX_PAGINA.bloques} bloques.`);
  }
  raw.bloques.forEach((b, i) => {
    const n = i + 1;
    if (!registro(b) || !Array.isArray(b.parrafos)) {
      errores.push(`El bloque ${n} no es válido.`);
      return;
    }
    const titulo = typeof b.titulo === "string" ? b.titulo.trim() : "";
    if (!titulo) errores.push(`Ingrese el título del bloque ${n}.`);
    if (titulo.length > MAX_PAGINA.titulo) {
      errores.push(`El título del bloque ${n} admite hasta ${MAX_PAGINA.titulo} caracteres.`);
    }
    if (b.parrafos.length > MAX_PAGINA.parrafos) {
      errores.push(`El bloque ${n} admite hasta ${MAX_PAGINA.parrafos} párrafos.`);
    }
    if (b.parrafos.some((p) => typeof p === "string" && p.length > MAX_PAGINA.parrafo)) {
      errores.push(`Cada párrafo del bloque ${n} admite hasta ${MAX_PAGINA.parrafo} caracteres.`);
    }
    if (!b.parrafos.some((p) => typeof p === "string" && p.trim())) {
      errores.push(`Ingrese al menos un párrafo en el bloque ${n}.`);
    }
  });
  return errores;
}
