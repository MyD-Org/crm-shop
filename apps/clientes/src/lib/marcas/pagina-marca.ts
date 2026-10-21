/**
 * Páginas de marca (spec 2026-10-20-marcas-tienda-oficial). Módulo PURO: lo
 * importan el servidor, las server actions y los editores del navegador.
 *
 * Cada página es una fila `pagina-marca:<slug>` de `home_content` (acotada por
 * tenant, como las institucionales `pagina:<slug>`). Dos niveles:
 * - "oficial": tienda oficial completa (hero con sello, confianza, líneas, más
 *   elegidos, componentes, obras, cotización de obra y todos los productos);
 * - "marca": encabezado, líneas (apagadas por defecto) y todos los productos.
 *
 * `PaginaMarca` no es la `Marca` de `marca-base.ts` (identidad de la tienda):
 * es una marca de los PRODUCTOS que vende la tienda.
 *
 * El vínculo con el catálogo es `marcasCatalogo`: los valores crudos de la
 * marca (customField de Alegra, o la categoría de Alegra si viene vacío) que
 * el admin eligió de la lista real del catálogo. Varios alias cubren la misma
 * marca escrita distinto ("LED PREMIUM" / "Led Premium").
 */
import { motivoImagenInvalida, VISIBILIDADES, type Visibilidad } from "@/data/home-defaults";
import { textoPlano } from "@/lib/institucional/paginas";
import { razonDeContraste } from "@/lib/tema-tenant";
import { videoEmbebible } from "./video";

export type NivelMarca = "oficial" | "marca";

export const BLOQUES_MARCA = [
  "hero",
  "confianza",
  "lineas",
  "elegidos",
  "componentes",
  "empresa",
  "obras",
  "cotizacion",
  "productos",
] as const;
export type BloqueMarca = (typeof BLOQUES_MARCA)[number];

/** Bloques de cada nivel, en el orden en que se dibujan. */
export const BLOQUES_POR_NIVEL: Record<NivelMarca, readonly BloqueMarca[]> = {
  oficial: BLOQUES_MARCA,
  marca: ["hero", "lineas", "productos"],
};

export type HeroMarca = { imagen?: string; imagenAlt?: string; sello?: string; cta?: string };
export type ItemConfianza = { valor: string; texto: string };
export type ConfianzaMarca = { items: ItemConfianza[] };
export type LineaMarca = { slug: string; titulo: string; imagen?: string; categorias: string[]; skus: string[] };
export type LineasMarca = { titulo?: string; items: LineaMarca[] };
export type ElegidosMarca = { titulo: string; skus: string[]; cantidad: number };
export type ComponentesMarca = { titulo: string; bajada?: string; chips: string[] };
export type FotoObra = { imagen: string; alt: string; epigrafe?: string };
export type ObrasMarca = { titulo: string; fotos: FotoObra[] };
/** Foto o video de la empresa (fábrica, instalaciones, equipo). Video: enlace de YouTube o Vimeo. */
export type MediaEmpresa =
  | { tipo: "foto"; imagen: string; alt: string; epigrafe?: string }
  | { tipo: "video"; url: string; epigrafe?: string };
export type EmpresaMarca = { titulo: string; bajada?: string; items: MediaEmpresa[] };
/**
 * A dónde lleva el botón de cotizar. `whatsapp` (default): `whatsapp` propio del bloque o, vacío,
 * el número del pie de la tienda, con `mensaje` precargado. `enlace`: `href` tal cual (ruta
 * interna, https, mailto: o tel:).
 */
export type DestinoCotizacion = "whatsapp" | "enlace";
export type CotizacionMarca = {
  titulo: string;
  bajada?: string;
  boton: string;
  mensaje: string;
  destino?: DestinoCotizacion;
  whatsapp?: string;
  href?: string;
};
export type ProductosMarca = { titulo?: string };

export type ContenidoBloques = {
  hero: HeroMarca;
  confianza: ConfianzaMarca;
  lineas: LineasMarca;
  elegidos: ElegidosMarca;
  componentes: ComponentesMarca;
  empresa: EmpresaMarca;
  obras: ObrasMarca;
  cotizacion: CotizacionMarca;
  productos: ProductosMarca;
};

export type SeoMarca = { titulo?: string; descripcion?: string; imagenOg?: string };

export type PaginaMarca = {
  /** La dirección: `/marcas/<slug>`. Única por tenant (es la clave de la fila). */
  slug: string;
  nombre: string;
  nivel: NivelMarca;
  /** `false`: solo la ve un admin. */
  publicada: boolean;
  /** Orden en `/marcas` y en el menú ("oficial" va siempre primero). */
  orden: number;
  /** Valores crudos de marca del catálogo que son esta marca. */
  marcasCatalogo: string[];
  logo?: string;
  bajada: string;
  /** Acento `#rrggbb` de la tienda oficial (sobre fondo oscuro). Ausente: el dorado por defecto. */
  acento?: string;
  seo?: SeoMarca;
  bloques: Partial<ContenidoBloques>;
  /** Dónde se ve cada bloque; ausente = `visibilidadBloque` decide. */
  visibilidad: Partial<Record<BloqueMarca, Visibilidad>>;
};

/** Lo que el header manda al menú "Marcas" (mismo contrato que `SiteNavItem.menu` del DS). */
export type ItemMenuMarca = { label: string; href: string; destacado?: boolean; descripcion?: string };

export const PREFIJO_CLAVE_MARCA = "pagina-marca:";
export const ACENTO_OFICIAL = "#c0a15a";
/** Fondo de la tienda oficial: contra él se mide el contraste del acento. */
export const FONDO_OFICIAL = "#0c0c0c";

export const MAX_MARCA = {
  slug: 60,
  nombre: 80,
  bajada: 240,
  texto: 160,
  marcasCatalogo: 10,
  confianza: 4,
  lineas: 8,
  categoriasLinea: 10,
  skus: 60,
  chips: 12,
  fotos: 6,
  mediaEmpresa: 8,
  cantidadElegidos: 12,
} as const;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX = /^#[0-9a-f]{6}$/;
const UMBRAL_CONTRASTE = 4.5;

export function claveDeMarca(slug: string): string {
  return `${PREFIJO_CLAVE_MARCA}${slug}`;
}

export function esSlugMarca(v: unknown): v is string {
  return typeof v === "string" && v.length <= MAX_MARCA.slug && SLUG.test(v);
}

export function slugDeNombre(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_MARCA.slug)
    .replace(/-+$/g, "");
}

export function esBloqueMarca(v: unknown): v is BloqueMarca {
  return (BLOQUES_MARCA as readonly unknown[]).includes(v);
}

export function esNivelMarca(v: unknown): v is NivelMarca {
  return v === "oficial" || v === "marca";
}

export function bloqueDelNivel(nivel: NivelMarca, bloque: BloqueMarca): boolean {
  return BLOQUES_POR_NIVEL[nivel].includes(bloque);
}

/** Dónde se ve un bloque. Sin dato: siempre, salvo "líneas" en el nivel marca (apagado). */
export function visibilidadBloque(p: PaginaMarca, bloque: BloqueMarca): Visibilidad {
  return p.visibilidad[bloque] ?? (bloque === "lineas" && p.nivel === "marca" ? "nunca" : "siempre");
}

/** Textos genéricos para una página nueva: nada propio de una tienda o marca en particular. */
export function contenidoInicial(nivel: NivelMarca, nombre: string): Partial<ContenidoBloques> {
  const comun: Partial<ContenidoBloques> = {
    hero: { cta: "Ver los productos" },
    lineas: { titulo: "Líneas", items: [] },
    productos: { titulo: `Todos los productos ${nombre}` },
  };
  if (nivel === "marca") return comun;
  return {
    ...comun,
    hero: { sello: "Tienda oficial · Vendedor oficial online", cta: "Ver los productos" },
    confianza: { items: [] },
    elegidos: { titulo: "Los más elegidos", skus: [], cantidad: 8 },
    componentes: { titulo: "Lo que va adentro", chips: [] },
    empresa: { titulo: "Conozca la empresa", items: [] },
    obras: { titulo: `Obras con ${nombre}`, fotos: [] },
    cotizacion: {
      titulo: "¿Tiene una obra grande o un proyecto de arquitectura?",
      bajada: "Cuéntenos qué necesita y le preparamos una cotización.",
      boton: "Pedir cotización de obra",
      mensaje: `Hola, quiero cotizar una obra con productos ${nombre}.`,
    },
  };
}

export function ordenarPaginas(ps: readonly PaginaMarca[]): PaginaMarca[] {
  return [...ps].sort(
    (a, b) =>
      Number(b.nivel === "oficial") - Number(a.nivel === "oficial") ||
      a.orden - b.orden ||
      a.nombre.localeCompare(b.nombre, "es"),
  );
}

export function hrefMarca(slug: string): string {
  return `/marcas/${slug}`;
}

/** Ítems del menú "Marcas": solo publicadas, la oficial destacada, y "Ver todas" al final. */
export function itemsMenuMarcas(ps: readonly PaginaMarca[]): ItemMenuMarca[] {
  const publicadas = ordenarPaginas(ps.filter((p) => p.publicada));
  if (publicadas.length === 0) return [];
  return [
    ...publicadas.map((p): ItemMenuMarca =>
      p.nivel === "oficial"
        ? { label: p.nombre, href: hrefMarca(p.slug), destacado: true, descripcion: p.bajada }
        : { label: p.nombre, href: hrefMarca(p.slug) },
    ),
    { label: "Ver todas las marcas", href: "/marcas" },
  ];
}

// ---------------------------------------------------------------------------
// Lectura estricta (sanear) y validación del editor (validar).

const registro = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const texto = (v: unknown, max: number = MAX_MARCA.texto): string => textoPlano(v).slice(0, max);
const textoOpcional = (v: unknown, max: number = MAX_MARCA.texto): string | undefined => texto(v, max) || undefined;
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const textos = (v: unknown, max: number): string[] =>
  lista(v)
    .map((x) => texto(x))
    .filter(Boolean)
    .slice(0, max);
/** Rutas internas o URLs https: la lectura no valida hosts (eso lo hizo el editor al guardar). */
const imagen = (v: unknown): string | undefined =>
  typeof v === "string" && motivoImagenInvalida(v, []) !== "formato" ? v.trim() : undefined;

const digitos = (v: unknown): string => (typeof v === "string" ? v.replace(/\D/g, "") : "");

/** Destino de "cotizar": ruta interna, https, mailto: o tel: (nunca javascript: ni data:). */
export function esHrefCotizacion(v: unknown): v is string {
  if (typeof v !== "string" || !v.trim()) return false;
  const h = v.trim();
  if (h.startsWith("/")) return !h.startsWith("//");
  try {
    const u = new URL(h);
    return u.protocol === "https:" || u.protocol === "mailto:" || u.protocol === "tel:";
  } catch {
    return false;
  }
}

const SANEAR: { [B in BloqueMarca]: (raw: Record<string, unknown>) => ContenidoBloques[B] } = {
  hero: (r) => ({
    imagen: imagen(r.imagen),
    imagenAlt: textoOpcional(r.imagenAlt),
    sello: textoOpcional(r.sello),
    cta: textoOpcional(r.cta),
  }),
  confianza: (r) => ({
    items: lista(r.items)
      .filter(registro)
      .map((i) => ({ valor: texto(i.valor, 24), texto: texto(i.texto, 60) }))
      .filter((i) => i.valor && i.texto)
      .slice(0, MAX_MARCA.confianza),
  }),
  lineas: (r) => ({
    titulo: textoOpcional(r.titulo),
    items: lista(r.items)
      .filter(registro)
      .map((i) => ({
        slug: esSlugMarca(i.slug) ? i.slug : "",
        titulo: texto(i.titulo, 60),
        imagen: imagen(i.imagen),
        categorias: textos(i.categorias, MAX_MARCA.categoriasLinea),
        skus: textos(i.skus, MAX_MARCA.skus),
      }))
      .filter((i) => i.slug && i.titulo)
      .slice(0, MAX_MARCA.lineas),
  }),
  elegidos: (r) => ({
    titulo: texto(r.titulo),
    skus: textos(r.skus, MAX_MARCA.skus),
    cantidad:
      typeof r.cantidad === "number" && Number.isInteger(r.cantidad)
        ? Math.min(Math.max(r.cantidad, 1), MAX_MARCA.cantidadElegidos)
        : 8,
  }),
  componentes: (r) => ({
    titulo: texto(r.titulo),
    bajada: textoOpcional(r.bajada, MAX_MARCA.bajada),
    chips: textos(r.chips, MAX_MARCA.chips),
  }),
  obras: (r) => ({
    titulo: texto(r.titulo),
    fotos: lista(r.fotos)
      .filter(registro)
      .map((f) => ({ imagen: imagen(f.imagen) ?? "", alt: texto(f.alt), epigrafe: textoOpcional(f.epigrafe) }))
      .filter((f) => f.imagen)
      .slice(0, MAX_MARCA.fotos),
  }),
  empresa: (r) => ({
    titulo: texto(r.titulo),
    bajada: textoOpcional(r.bajada, MAX_MARCA.bajada),
    items: lista(r.items)
      .filter(registro)
      .map((i): MediaEmpresa | null => {
        if (i.tipo === "foto") {
          const img = imagen(i.imagen);
          return img ? { tipo: "foto", imagen: img, alt: texto(i.alt), epigrafe: textoOpcional(i.epigrafe) } : null;
        }
        if (i.tipo === "video" && videoEmbebible(i.url)) {
          return { tipo: "video", url: (i.url as string).trim(), epigrafe: textoOpcional(i.epigrafe) };
        }
        return null;
      })
      .filter((i): i is MediaEmpresa => i !== null)
      .slice(0, MAX_MARCA.mediaEmpresa),
  }),
  cotizacion: (r) => ({
    titulo: texto(r.titulo),
    bajada: textoOpcional(r.bajada, MAX_MARCA.bajada),
    boton: texto(r.boton, 60),
    mensaje: texto(r.mensaje, 300),
    destino: r.destino === "enlace" ? "enlace" : undefined,
    whatsapp: digitos(r.whatsapp) || undefined,
    href: r.destino === "enlace" && esHrefCotizacion(r.href) ? (r.href as string).trim() : undefined,
  }),
  productos: (r) => ({ titulo: textoOpcional(r.titulo) }),
};

/** Quita las claves `undefined` (para que el JSON guardado y los `toEqual` queden limpios). */
function limpio<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function sanearBloque<B extends BloqueMarca>(bloque: B, raw: unknown): ContenidoBloques[B] | undefined {
  if (!registro(raw)) return undefined;
  const salida = SANEAR[bloque](raw) as Record<string, unknown>;
  for (const [k, v] of Object.entries(salida)) {
    if (Array.isArray(v)) salida[k] = v.map((x) => (registro(x) ? limpio(x) : x));
  }
  return limpio(salida) as ContenidoBloques[B];
}

/**
 * Lectura estricta de lo guardado. Sin slug, nombre o nivel válidos: `null`
 * (la página no existe para nadie). Todo texto pasa por `textoPlano`; los
 * bloques e ítems inválidos o ajenos al nivel se descartan. Una fila tocada a
 * mano no rompe el sitio ni inyecta marcado.
 */
export function sanearPaginaMarca(raw: unknown): PaginaMarca | null {
  if (!registro(raw)) return null;
  const slug = esSlugMarca(raw.slug) ? raw.slug : null;
  const nombre = texto(raw.nombre, MAX_MARCA.nombre);
  if (!slug || !nombre || !esNivelMarca(raw.nivel)) return null;
  const nivel = raw.nivel;

  const bloques: Partial<ContenidoBloques> = {};
  const crudos = registro(raw.bloques) ? raw.bloques : {};
  for (const b of BLOQUES_POR_NIVEL[nivel]) {
    const contenido = sanearBloque(b, crudos[b]);
    if (contenido) (bloques as Record<string, unknown>)[b] = contenido;
  }
  const visibilidad: Partial<Record<BloqueMarca, Visibilidad>> = {};
  if (registro(raw.visibilidad)) {
    for (const [b, v] of Object.entries(raw.visibilidad)) {
      if (esBloqueMarca(b) && bloqueDelNivel(nivel, b) && (VISIBILIDADES as readonly unknown[]).includes(v)) {
        visibilidad[b] = v as Visibilidad;
      }
    }
  }
  const seo = registro(raw.seo)
    ? limpio({
        titulo: textoOpcional(raw.seo.titulo),
        descripcion: textoOpcional(raw.seo.descripcion, MAX_MARCA.bajada),
        imagenOg: imagen(raw.seo.imagenOg),
      })
    : undefined;

  return limpio({
    slug,
    nombre,
    nivel,
    publicada: raw.publicada === true,
    orden: typeof raw.orden === "number" && Number.isFinite(raw.orden) ? raw.orden : 0,
    marcasCatalogo: lista(raw.marcasCatalogo)
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .map((v) => v.slice(0, MAX_MARCA.texto))
      .slice(0, MAX_MARCA.marcasCatalogo),
    logo: imagen(raw.logo),
    bajada: texto(raw.bajada, MAX_MARCA.bajada),
    acento: typeof raw.acento === "string" && HEX.test(raw.acento) ? raw.acento : undefined,
    seo: seo && Object.keys(seo).length ? seo : undefined,
    bloques,
    visibilidad,
  });
}

function erroresImagen(v: unknown, hosts: readonly string[], nombre: string): string[] {
  if (v === undefined || v === "") return [];
  const motivo = motivoImagenInvalida(v, hosts);
  if (motivo === "host") return [`${nombre}: la imagen debe estar subida a la tienda.`];
  if (motivo === "formato") return [`${nombre}: la imagen no es válida.`];
  return [];
}

const textoVacio = (v: unknown) => typeof v !== "string" || v.trim() === "";

/** Errores (en usted) de los datos generales de una página. [] = válida. */
export function validarPaginaMarca(raw: unknown, hosts: readonly string[]): string[] {
  if (!registro(raw)) return ["Los datos de la página no son válidos."];
  const errores: string[] = [];
  if (!esSlugMarca(raw.slug)) {
    errores.push("La dirección solo admite minúsculas, números y guiones (por ejemplo, led-premium).");
  }
  if (textoVacio(raw.nombre)) errores.push("Ingrese el nombre de la marca.");
  else if ((raw.nombre as string).length > MAX_MARCA.nombre) {
    errores.push(`El nombre admite hasta ${MAX_MARCA.nombre} caracteres.`);
  }
  if (!esNivelMarca(raw.nivel)) errores.push("Indique si es una tienda oficial o una página de marca.");
  if (typeof raw.publicada !== "boolean") errores.push("Indique si la página está publicada.");
  const marcas = lista(raw.marcasCatalogo).filter((v) => typeof v === "string" && v.trim() !== "");
  if (marcas.length === 0) errores.push("Elija al menos un valor de marca del catálogo.");
  if (marcas.length > MAX_MARCA.marcasCatalogo) {
    errores.push(`Puede elegir hasta ${MAX_MARCA.marcasCatalogo} valores de marca.`);
  }
  if (typeof raw.bajada === "string" && raw.bajada.length > MAX_MARCA.bajada) {
    errores.push(`La bajada admite hasta ${MAX_MARCA.bajada} caracteres.`);
  }
  errores.push(...erroresImagen(raw.logo, hosts, "Logo"));
  if (raw.acento !== undefined && raw.acento !== "") {
    if (typeof raw.acento !== "string" || !HEX.test(raw.acento)) {
      errores.push("El color de acento debe tener la forma #rrggbb.");
    } else if (razonDeContraste(raw.acento, FONDO_OFICIAL) < UMBRAL_CONTRASTE) {
      errores.push("El color de acento no tiene contraste suficiente sobre el fondo oscuro. Elija uno más claro.");
    }
  }
  if (registro(raw.seo)) errores.push(...erroresImagen(raw.seo.imagenOg, hosts, "Imagen para redes"));
  return errores;
}

/** Errores (en usted) del contenido de un bloque. [] = válido. */
export function validarBloqueMarca(bloque: BloqueMarca, raw: unknown, hosts: readonly string[]): string[] {
  if (!registro(raw)) return ["El contenido del bloque no es válido."];
  const errores: string[] = [];
  switch (bloque) {
    case "hero":
      errores.push(...erroresImagen(raw.imagen, hosts, "Imagen de fondo"));
      break;
    case "confianza": {
      const items = lista(raw.items);
      if (items.length > MAX_MARCA.confianza) errores.push(`Admite hasta ${MAX_MARCA.confianza} datos.`);
      items.forEach((i, n) => {
        if (!registro(i) || textoVacio(i.valor) || textoVacio(i.texto)) {
          errores.push(`Complete el valor y el texto del dato ${n + 1}.`);
        }
      });
      break;
    }
    case "lineas": {
      const items = lista(raw.items);
      if (items.length > MAX_MARCA.lineas) errores.push(`Admite hasta ${MAX_MARCA.lineas} líneas.`);
      const slugs = new Set<string>();
      items.forEach((i, n) => {
        if (!registro(i) || textoVacio(i.titulo)) {
          errores.push(`Ingrese el título de la línea ${n + 1}.`);
          return;
        }
        if (!esSlugMarca(i.slug)) errores.push(`La dirección de la línea ${n + 1} no es válida.`);
        else if (slugs.has(i.slug)) errores.push(`La línea ${n + 1} repite la dirección "${i.slug}".`);
        else slugs.add(i.slug);
        errores.push(...erroresImagen(i.imagen, hosts, `Línea ${n + 1}`));
      });
      break;
    }
    case "elegidos":
      if (textoVacio(raw.titulo)) errores.push("Ingrese el título del bloque.");
      if (
        typeof raw.cantidad !== "number" ||
        !Number.isInteger(raw.cantidad) ||
        raw.cantidad < 1 ||
        raw.cantidad > MAX_MARCA.cantidadElegidos
      ) {
        errores.push(`La cantidad debe estar entre 1 y ${MAX_MARCA.cantidadElegidos}.`);
      }
      if (!Array.isArray(raw.skus)) errores.push("La lista de productos no es válida.");
      break;
    case "componentes":
      if (textoVacio(raw.titulo)) errores.push("Ingrese el título del bloque.");
      if (lista(raw.chips).length > MAX_MARCA.chips) errores.push(`Admite hasta ${MAX_MARCA.chips} componentes.`);
      break;
    case "obras": {
      if (textoVacio(raw.titulo)) errores.push("Ingrese el título del bloque.");
      const fotos = lista(raw.fotos);
      if (fotos.length > MAX_MARCA.fotos) errores.push(`Admite hasta ${MAX_MARCA.fotos} fotos.`);
      fotos.forEach((f, n) => {
        if (!registro(f) || textoVacio(f.imagen)) errores.push(`Suba la imagen de la foto ${n + 1}.`);
        else errores.push(...erroresImagen(f.imagen, hosts, `Foto ${n + 1}`));
        if (registro(f) && textoVacio(f.alt)) errores.push(`Describa la foto ${n + 1} (texto alternativo).`);
      });
      break;
    }
    case "empresa": {
      if (textoVacio(raw.titulo)) errores.push("Ingrese el título del bloque.");
      const items = lista(raw.items);
      if (items.length > MAX_MARCA.mediaEmpresa) errores.push(`Admite hasta ${MAX_MARCA.mediaEmpresa} fotos o videos.`);
      items.forEach((i, n) => {
        if (!registro(i)) return errores.push(`El elemento ${n + 1} no es válido.`);
        if (i.tipo === "video") {
          if (!videoEmbebible(i.url)) errores.push(`El video ${n + 1} debe ser un enlace de YouTube o Vimeo.`);
        } else if (i.tipo === "foto") {
          if (textoVacio(i.imagen)) errores.push(`Suba la imagen de la foto ${n + 1}.`);
          else errores.push(...erroresImagen(i.imagen, hosts, `Foto ${n + 1}`));
          if (textoVacio(i.alt)) errores.push(`Describa la foto ${n + 1} (texto alternativo).`);
        } else errores.push(`El elemento ${n + 1} no es válido.`);
      });
      break;
    }
    case "cotizacion":
      if (textoVacio(raw.titulo)) errores.push("Ingrese el título del bloque.");
      if (textoVacio(raw.boton)) errores.push("Ingrese el texto del botón.");
      if (raw.destino === "enlace") {
        if (!esHrefCotizacion(raw.href)) {
          errores.push("Ingrese a dónde lleva el botón: una ruta de la tienda (/contacto), una dirección https, mailto: o tel:.");
        }
      } else {
        if (textoVacio(raw.mensaje)) errores.push("Ingrese el mensaje que se precarga en WhatsApp.");
        const d = digitos(raw.whatsapp);
        if (d && (d.length < 8 || d.length > 15)) {
          errores.push("El número de WhatsApp no es válido. Ingréselo con código de país y de área, o déjelo vacío para usar el de la tienda.");
        }
      }
      break;
    case "productos":
      break;
  }
  return errores;
}

/** El contenido saneado de un bloque (lo que se guarda tras validar). */
export function sanearContenidoBloque<B extends BloqueMarca>(bloque: B, raw: unknown): ContenidoBloques[B] | undefined {
  return sanearBloque(bloque, raw);
}

