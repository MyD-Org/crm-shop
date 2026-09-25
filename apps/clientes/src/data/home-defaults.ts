import type { VisibleOn } from "@myd-org/ui";
import { hostsDeMedios } from "../lib/catalogo-medios";
import { cuitValido, formatearCuit } from "../lib/facturacion";

/**
 * Contenido por defecto de la home, editable desde la home por un usuario
 * admin (server actions en src/lib/home-acciones.ts). Cada sección de la DB
 * pisa a su default solo si valida (ver erroresSeccion).
 *
 * Los defaults reflejan el diseño aprobado ("Central Led — Diseño cálido sin
 * azul", guía §4/§6): textos literales del mockup e imágenes comprimidas en
 * public/images/ (.webp). `destacados.imagenes` asigna una foto (por posición)
 * a cada producto destacado: el catálogo (Alegra) no provee imágenes de
 * producto, así que la foto es contenido de la home, administrable.
 */

/** `visibilidad` (acá y en cada ítem de lista): dónde se ve. Ausente = siempre. */
export type Enlace = { label: string; href: string; visibilidad?: SoloEn };

/**
 * Título y bajada de una sección. El título marca su acento con `*así*`, en
 * cualquier posición ("Todo lo que *su proyecto* necesita"). Las versiones
 * `…Mobile` son opcionales: vacías ⇒ en mobile se usa la de desktop.
 *
 * `acento` es el formato viejo (acento siempre al final): las filas guardadas
 * así se convierten al leerlas (ver `migrarAcento`) y el editor ya no lo usa.
 */
/** Textos que el admin puede mostrar solo en un tamaño u ocultar sin borrarlos. */
export const CAMPOS_OCULTABLES = ["eyebrow", "titulo", "bajada"] as const;
export type CampoOcultable = (typeof CAMPOS_OCULTABLES)[number];
/** Los textos del recuadro de WhatsApp (no tiene eyebrow ni bajada). */
export const CAMPOS_WHATSAPP = ["titulo", "texto"] as const;
export type CampoWhatsapp = (typeof CAMPOS_WHATSAPP)[number];

/** Dónde se ve cada texto; ausente = siempre. */
export type VisibilidadTextos<K extends string> = Partial<Record<K, SoloEn>>;

export type TextosSeccion = {
  visibilidadTextos?: VisibilidadTextos<CampoOcultable>;
  /** @deprecated Formato viejo (textos apagados); se convierte a
   *  `visibilidadTextos` al leer (ver `migrarVisibilidad`). */
  camposOcultos?: CampoOcultable[];
  titulo?: string;
  tituloMobile?: string;
  /** @deprecated Formato viejo; use `*acento*` dentro de `titulo`. */
  acento?: string;
  bajada?: string;
  bajadaMobile?: string;
};

export type HeroContent = TextosSeccion & {
  eyebrow?: string;
  imagen: string;
  imagenAlt: string;
  ctas: Enlace[];
  usps: { label: string; visibilidad?: SoloEn }[];
};

/** Con `logo` el ítem se muestra como imagen y `texto` es el nombre de la marca (alt). */
export type ItemMarquee = { texto: string; logo?: string; visibilidad?: SoloEn };
/** Las filas viejas guardan los ítems como textos sueltos: se convierten al leer. */
export type MarqueeContent = { items: ItemMarquee[] };

/** Cuánto se oscurece la foto de un tile para que se lea el texto. Ausente = normal. */
export type VeloTile = "suave" | "fuerte";

export type TileContent = {
  eyebrow?: string;
  titulo?: string;
  imagen: string;
  href: string;
  visibilidad?: SoloEn;
  velo?: VeloTile;
};

export type SeccionTilesContent = TextosSeccion & {
  linkTodos?: string;
  items: TileContent[];
};

export type DestacadosContent = TextosSeccion & {
  linkTodos?: string;
  cantidad: number;
  /** Productos elegidos (SKUs de Alegra), en orden. El resto se completa con Iluminación. */
  skus?: string[];
  /** Fotos de los productos destacados, por posición. Path local (/) o URL
      https de un host de SHOP_MEDIA_HOSTS. */
  imagenes?: string[];
};

export type BannerDecoContent = TextosSeccion & {
  eyebrow?: string;
  cta?: Enlace;
  imagen: string;
};

export type DecoGridContent = TextosSeccion & {
  linkTodos?: string;
  items: TileContent[];
  chips: Enlace[];
};

export type ServiciosContent = { items: { titulo?: string; texto?: string; visibilidad?: SoloEn }[] };
export type NavBadgeContent = { categoria: string; texto: string };
export type WhatsappContent = {
  titulo?: string;
  texto?: string;
  href: string;
  visibilidadTextos?: VisibilidadTextos<CampoWhatsapp>;
};

export type HomeContent = {
  anuncio: { texto?: string };
  hero: HeroContent;
  marquee: MarqueeContent;
  ambientes: SeccionTilesContent;
  destacados: DestacadosContent;
  bannerDeco: BannerDecoContent;
  decoGrid: DecoGridContent;
  servicios: ServiciosContent;
  /** null = la categoría del nav no lleva badge. */
  navBadge: NavBadgeContent | null;
  whatsapp: WhatsappContent;
  /** Dónde se ve cada sección que el admin restringió desde el editor (las
   *  que no figuran se ven siempre). Se guarda en su propia fila de
   *  home_content (`ocultas`), así no pisa el contenido de la sección. */
  visibilidad: MapaVisibilidad;
};

/** Dónde se ve algo de la home. El corte es `md` (768px), el mismo de las
 *  versiones mobile de los textos. */
export const VISIBILIDADES = ["siempre", "desktop", "mobile", "nunca"] as const;
export type Visibilidad = (typeof VISIBILIDADES)[number];
/** Todo menos "siempre": lo que se guarda en textos e ítems (ausente = siempre). */
export type SoloEn = Exclude<Visibilidad, "siempre">;
/** Ausente = "siempre", salvo que el default diga otra cosa (anuncio). */
export type MapaVisibilidad = Partial<Record<SeccionHome, Visibilidad>>;

export const SECCIONES_HOME = [
  "anuncio",
  "hero",
  "marquee",
  "ambientes",
  "destacados",
  "bannerDeco",
  "decoGrid",
  "servicios",
  "navBadge",
  "whatsapp",
] as const;

export type SeccionHome = (typeof SECCIONES_HOME)[number];

const CATALOGO_ILUMINACION = "/catalogo?categoria=ILUMINACION";

export const DEFAULTS_HOME: HomeContent = {
  anuncio: {
    texto: "Retiro en local sin cargo · Stock en tiempo real · Asesoramiento por WhatsApp",
  },
  hero: {
    eyebrow: "Iluminación LED · Ingresos 2026",
    titulo: "Todo para iluminar *tu casa y tu obra*",
    bajada:
      "Lámparas, colgantes, guirnaldas y artefactos LED de marcas líderes. Fichas técnicas claras, stock real de depósito y precios para profesionales y particulares.",
    imagen: "/images/hero-neutral.webp",
    imagenAlt: "Living con lámparas de pie y de mesa",
    ctas: [
      { label: "Ver catálogo →", href: "/catalogo" },
      { label: "Línea decorativa", href: CATALOGO_ILUMINACION },
    ],
    usps: [
      { label: "Retiro en local sin cargo" },
      { label: "Stock en tiempo real" },
      { label: "Asesoramiento por WhatsApp" },
    ],
  },
  marquee: {
    items: [
      { texto: "Weidmüller", logo: "/images/marcas/weidmuller.webp" },
      { texto: "Uniview", logo: "/images/marcas/uniview.webp" },
      { texto: "Powerswitch", logo: "/images/marcas/powerswitch.webp" },
      { texto: "Macroled", logo: "/images/marcas/macroled.webp" },
      { texto: "CHINT", logo: "/images/marcas/chint.webp" },
      { texto: "Jadever", logo: "/images/marcas/jadever.webp" },
      { texto: "Inteck", logo: "/images/marcas/inteck.webp" },
    ],
  },
  ambientes: {
    titulo: "Comprá por *ambiente*",
    bajada: "Interior, exterior, cálida o fría: cada ambiente pide su artefacto y su temperatura de color.",
    linkTodos: "/catalogo",
    items: [
      { eyebrow: "Interior", titulo: "Colgantes y lámparas de diseño", imagen: "/images/deco-colgante.webp", href: CATALOGO_ILUMINACION },
      { eyebrow: "Exterior", titulo: "Patio y jardín", imagen: "/images/deco-guirnalda.webp", href: CATALOGO_ILUMINACION },
      { eyebrow: "Interior", titulo: "Dormitorio", imagen: "/images/deco-velador.webp", href: CATALOGO_ILUMINACION },
    ],
  },
  destacados: {
    titulo: "Los más *vendidos*",
    bajada: "Rotación real del local y la web: especificaciones completas y stock confirmado.",
    linkTodos: "/catalogo",
    cantidad: 4,
    // Productos reales del catálogo (los del diseño aprobado que existen en
    // Alegra). Se re-curan desde el editor de la home.
    skus: ["ADF-D8-BCO-CO", "ADM-D10-BCO-CO", "ADM-D8-BCO-CO"],
    imagenes: [
      "/images/prod-bulb-warm.webp",
      "/images/prod-panel-warm.webp",
      "/images/prod-spot-warm.webp",
      "/images/prod-string-warm.webp",
    ],
  },
  bannerDeco: {
    eyebrow: "Línea decorativa · Nuevo",
    titulo: "Ambientá tus noches con *luz cálida*",
    bajada: "Guirnaldas IP44, neones flex 12V, veladores y colgantes: línea deco con specs de instalación serias.",
    cta: { label: "Descubrir la línea →", href: CATALOGO_ILUMINACION },
    imagen: "/images/deco-guirnalda.webp",
  },
  decoGrid: {
    titulo: "Decorativa para *cada rincón*",
    linkTodos: "/catalogo",
    items: [
      { eyebrow: "Exterior", titulo: "Guirnaldas", imagen: "/images/deco-guirnalda.webp", href: CATALOGO_ILUMINACION },
      { eyebrow: "Interior", titulo: "Neones y tiras", imagen: "/images/deco-neon.webp", href: CATALOGO_ILUMINACION },
      { eyebrow: "Interior", titulo: "Veladores", imagen: "/images/deco-velador.webp", href: CATALOGO_ILUMINACION },
      { eyebrow: "Interior", titulo: "Colgantes", imagen: "/images/deco-colgante.webp", href: CATALOGO_ILUMINACION },
    ],
    chips: [
      { label: "Apliques de pared", href: CATALOGO_ILUMINACION },
      { label: "Faroles solares", href: CATALOGO_ILUMINACION },
      { label: "Smart / Wi-Fi", href: CATALOGO_ILUMINACION },
      { label: "Efecto fuego", href: CATALOGO_ILUMINACION },
      { label: "Listones y tubos", href: CATALOGO_ILUMINACION },
    ],
  },
  servicios: {
    items: [
      { titulo: "Retiro en local", texto: "Sin cargo. Coordinamos con usted día y horario." },
      { titulo: "Stock real", texto: "Disponibilidad online sincronizada con nuestro depósito." },
      { titulo: "Pedido sin pago online", texto: "Arme su pedido y un asesor lo contacta para coordinar el pago." },
      { titulo: "Asesoramiento personalizado", texto: "Lo ayudamos por WhatsApp a elegir el producto correcto y a armar su pedido." },
    ],
  },
  navBadge: { categoria: "ILUMINACION", texto: "Nuevo" },
  whatsapp: {
    titulo: "¿Necesita asesoramiento?",
    texto: "Escríbanos por WhatsApp y lo ayudamos a elegir el producto correcto.",
    href: "https://wa.me/5492235903025",
  },
  // El anuncio en mobile ocupa varias filas: arranca solo en desktop hasta que
  // sea un carrusel de mensajes. El admin lo puede cambiar desde el editor.
  visibilidad: { anuncio: "desktop" },
};

// ---------------------------------------------------------------------------
// Validación por sección (la usan las server actions y combinarContenidoHome)
// ---------------------------------------------------------------------------

function esTexto(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Ausente o texto no vacío (los opcionales vacíos se descartan antes de guardar). */
function esSoloEnOpcional(v: unknown): boolean {
  return v === undefined || v === "desktop" || v === "mobile" || v === "nunca";
}

/** `visibilidadTextos` válido para esos campos (ausente también vale). */
function esVisibilidadTextos(v: unknown, campos: readonly string[]): boolean {
  if (v === undefined) return true;
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.entries(v).every(([k, val]) => campos.includes(k) && esSoloEnOpcional(val));
}

function esTextoOpcional(v: unknown): boolean {
  return v === undefined || esTexto(v);
}

/**
 * `true` sii `v` es una ruta interna (empieza con "/" y no con "//", que es
 * protocol-relative) o una URL `https:` completa. Rechaza `http:`,
 * `javascript:`, `mailto:` y cualquier otro esquema.
 */
export function esHref(v: unknown): v is string {
  if (!esTexto(v)) return false;
  const h = v.trim();
  if (h.startsWith("/")) return !h.startsWith("//");
  try {
    return new URL(h).protocol === "https:";
  } catch {
    return false;
  }
}

function esEnlace(v: unknown): v is Enlace {
  const o = v as Enlace;
  return !!v && typeof v === "object" && esTexto(o.label) && esHref(o.href) && esSoloEnOpcional(o.visibilidad);
}

/**
 * Motivo por el que `v` no es una imagen válida, o `null` si es válida.
 * `true` sii `v` es una ruta interna (empieza con "/" y no con "//") o una
 * URL `https:` cuyo `hostname` está en `hosts`.
 */
export function motivoImagenInvalida(v: unknown, hosts: readonly string[]): null | "host" | "formato" {
  if (!esTexto(v)) return "formato";
  const u = v.trim();
  if (u.startsWith("/")) return u.startsWith("//") ? "formato" : null;
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return "formato";
  }
  if (parsed.protocol !== "https:") return "formato";
  return hosts.includes(parsed.hostname) ? null : "host";
}

export function esImagen(v: unknown, hosts: readonly string[]): v is string {
  return motivoImagenInvalida(v, hosts) === null;
}

function esTile(v: unknown, hosts: readonly string[]): v is TileContent {
  const o = v as TileContent;
  return (
    !!v &&
    typeof v === "object" &&
    esTextoOpcional(o.eyebrow) &&
    esTextoOpcional(o.titulo) &&
    esImagen(o.imagen, hosts) &&
    esHref(o.href) &&
    esSoloEnOpcional(o.visibilidad) &&
    (o.velo === undefined || o.velo === "suave" || o.velo === "fuerte")
  );
}

/** Devuelve la lista de problemas del payload para la sección ([] = válido). */
export function erroresSeccion(key: string, payload: unknown, hosts: readonly string[] = hostsDeMedios()): string[] {
  if (key === "navBadge") {
    if (payload === null) return [];
    const o = payload as NavBadgeContent;
    return !!payload && typeof payload === "object" && esTexto(o.categoria) && esTexto(o.texto)
      ? []
      : ["navBadge debe ser null o { categoria, texto }"];
  }

  if (!(SECCIONES_HOME as readonly string[]).includes(key)) {
    return [`sección desconocida: ${key}`];
  }
  if (!payload || typeof payload !== "object") return ["payload debe ser un objeto"];

  const o = payload as Record<string, unknown>;
  const errores: string[] = [];
  const texto = (campo: string, opcional = false) => {
    if (opcional && (o[campo] === undefined || o[campo] === null)) return;
    if (!esTexto(o[campo])) errores.push(`${campo} debe ser un texto no vacío`);
  };
  const imagen = (campo: string, v: unknown) => {
    const m = motivoImagenInvalida(v, hosts);
    if (m === "host") errores.push(`${campo}: el host de la imagen no está habilitado (SHOP_MEDIA_HOSTS).`);
    else if (m === "formato") errores.push(`${campo} debe ser una ruta local (/images/...) o una URL https de un host habilitado.`);
  };
  /** Título, acento viejo, título mobile y bajadas: todos opcionales. */
  const textosTitulo = () => {
    for (const campo of ["titulo", "tituloMobile", "acento", "bajada", "bajadaMobile"]) texto(campo, true);
    const ocultos = o.camposOcultos;
    if (
      ocultos !== undefined &&
      (!Array.isArray(ocultos) || !ocultos.every((c) => (CAMPOS_OCULTABLES as readonly unknown[]).includes(c)))
    )
      errores.push(`camposOcultos debe ser un array de ${CAMPOS_OCULTABLES.join(", ")}`);
    if (!esVisibilidadTextos(o.visibilidadTextos, CAMPOS_OCULTABLES))
      errores.push(`visibilidadTextos debe indicar desktop, mobile o nunca para ${CAMPOS_OCULTABLES.join(", ")}`);
  };
  const linkOpcional = (campo: string) => {
    if (o[campo] !== undefined && !esHref(o[campo])) errores.push(`${campo} debe ser una ruta interna (/) o una URL https`);
  };
  const lista = (campo: string, esItem: (v: unknown) => boolean, forma: string) => {
    if (!Array.isArray(o[campo]) || !(o[campo] as unknown[]).every(esItem)) errores.push(`${campo} debe ser un array de ${forma}`);
  };

  // Los textos son todos opcionales: lo que el admin deja vacío no se
  // muestra. Solo son obligatorios los datos sin los que la sección no se
  // puede dibujar (imágenes, destino de los enlaces, cantidad).
  switch (key) {
    case "anuncio":
      texto("texto", true);
      break;
    case "hero": {
      texto("eyebrow", true);
      textosTitulo();
      imagen("imagen", o.imagen);
      texto("imagenAlt", true);
      lista("ctas", esEnlace, "{ label, href }");
      lista(
        "usps",
        (u) => esTextoOpcional((u as { label?: unknown })?.label) && esSoloEnOpcional((u as { visibilidad?: unknown })?.visibilidad),
        "{ label, visibilidad? }",
      );
      break;
    }
    case "marquee":
      // Textos sueltos (formato viejo) o { texto, logo?, visibilidad? }.
      lista(
        "items",
        (v) =>
          esTexto(v) ||
          (!!v &&
            typeof v === "object" &&
            esTexto((v as ItemMarquee).texto) &&
            ((v as ItemMarquee).logo === undefined || esImagen((v as ItemMarquee).logo, hosts)) &&
            esSoloEnOpcional((v as ItemMarquee).visibilidad)),
        "{ texto, logo?, visibilidad? }",
      );
      break;
    case "ambientes":
    case "decoGrid": {
      textosTitulo();
      linkOpcional("linkTodos");
      lista("items", (t) => esTile(t, hosts), "tiles { eyebrow?, titulo?, imagen, href, velo? }");
      if (key === "decoGrid") lista("chips", esEnlace, "{ label, href }");
      break;
    }
    case "destacados": {
      textosTitulo();
      linkOpcional("linkTodos");
      if (typeof o.cantidad !== "number" || o.cantidad < 1 || o.cantidad > 24)
        errores.push("cantidad debe ser un número entre 1 y 24");
      if (o.skus !== undefined &&
          (!Array.isArray(o.skus) || !(o.skus as unknown[]).every(esTexto)))
        errores.push("skus debe ser un array de SKUs no vacíos");
      if (o.imagenes !== undefined) {
        if (!Array.isArray(o.imagenes) || !(o.imagenes as unknown[]).every(esTexto)) {
          errores.push("imagenes debe ser un array de textos");
        } else if ((o.imagenes as string[]).some((u) => motivoImagenInvalida(u, hosts) !== null)) {
          imagen("imagenes", (o.imagenes as string[]).find((u) => motivoImagenInvalida(u, hosts) !== null));
        }
      }
      break;
    }
    case "bannerDeco": {
      texto("eyebrow", true);
      textosTitulo();
      imagen("imagen", o.imagen);
      if (o.cta !== undefined && !esEnlace(o.cta)) errores.push("cta debe ser { label, href }");
      break;
    }
    case "servicios":
      lista(
        "items",
        (v) => {
          const it = v as { titulo?: unknown; texto?: unknown; visibilidad?: unknown };
          return (
            !!v &&
            typeof v === "object" &&
            esTextoOpcional(it.titulo) &&
            esTextoOpcional(it.texto) &&
            esSoloEnOpcional(it.visibilidad)
          );
        },
        "{ titulo?, texto? }",
      );
      break;
    case "whatsapp":
      texto("titulo", true);
      texto("texto", true);
      if (!esVisibilidadTextos(o.visibilidadTextos, CAMPOS_WHATSAPP))
        errores.push(`visibilidadTextos debe indicar desktop, mobile o nunca para ${CAMPOS_WHATSAPP.join(", ")}`);
      if (!esHref(o.href)) errores.push("href debe ser una ruta interna (/) o una URL https");
      break;
  }
  return errores;
}

/**
 * La sección sin los textos que el admin puso en "Nunca" (ni sus versiones
 * mobile). Se aplica al pintar: el editor sigue viendo los textos. Los que se
 * ven solo en un tamaño quedan: se ocultan por CSS (ver `textoVisibleOn`).
 */
export function sinCamposOcultos<T extends { visibilidadTextos?: Partial<Record<string, SoloEn>> }>(seccion: T): T {
  const nunca = Object.entries(seccion.visibilidadTextos ?? {}).filter(([, v]) => v === "nunca");
  if (nunca.length === 0) return seccion;
  const copia: Record<string, unknown> = { ...seccion };
  for (const [campo] of nunca) {
    delete copia[campo];
    delete copia[`${campo}Mobile`];
  }
  return copia as T;
}

/** Visibilidad → prop `visibleOn` del DS ("siempre" y "nunca" no llevan). */
export function aVisibleOn(v: Visibilidad | undefined): VisibleOn | undefined {
  return v === "desktop" || v === "mobile" ? v : undefined;
}

/** `visibleOn` de un texto de la sección. */
export function textoVisibleOn<K extends string>(
  seccion: { visibilidadTextos?: VisibilidadTextos<K> },
  campo: NoInfer<K>,
): VisibleOn | undefined {
  return aVisibleOn(seccion.visibilidadTextos?.[campo]);
}

/** Los ítems sin los que están en "Nunca". */
export function sinItemsOcultos<T extends { visibilidad?: SoloEn }>(items: readonly T[]): T[] {
  return items.filter((it) => it.visibilidad !== "nunca");
}

/** Los ítems que se ven en ese tamaño. */
export function itemsEn<T extends { visibilidad?: SoloEn }>(items: readonly T[], tamano: VisibleOn): T[] {
  return items.filter((it) => it.visibilidad === undefined || it.visibilidad === tamano);
}

/** `true` si algún ítem se ve solo en un tamaño (hay que pintar dos versiones). */
export function difierePorTamano<T extends { visibilidad?: SoloEn }>(items: readonly T[]): boolean {
  return items.some((it) => it.visibilidad === "desktop" || it.visibilidad === "mobile");
}

/**
 * El título sin las marcas `*acento*` (para aria-label). Local y no el
 * `stripAccent` del DS: el bundle del DS es "use client" y no se puede llamar
 * desde un Server Component.
 */
export function sinMarcasDeAcento(texto: string): string {
  return texto.replace(/\*([^*]+)\*/g, "$1");
}

/**
 * Pasa el formato viejo `{ titulo, acento }` (acento siempre al final) al
 * nuevo `{ titulo: "… *acento*" }`. Idempotente: sin `acento`, no toca nada.
 */
export function migrarAcento<T>(payload: T): T {
  if (!payload || typeof payload !== "object") return payload;
  const { acento, ...resto } = payload as Record<string, unknown>;
  if (acento === undefined) return payload;
  if (typeof acento !== "string" || acento.trim() === "") return resto as T;
  const titulo = typeof resto.titulo === "string" ? resto.titulo.trim() : "";
  return { ...resto, titulo: `${titulo} *${acento.trim()}*`.trim() } as T;
}

/**
 * Pasa los formatos viejos de visibilidad al actual: `camposOcultos` ⇒
 * `visibilidadTextos` en "nunca", y los ítems de la cinta como textos sueltos
 * ⇒ `{ texto }`. Idempotente.
 */
export function migrarVisibilidad<T>(payload: T): T {
  if (!payload || typeof payload !== "object") return payload;
  let o = payload as Record<string, unknown>;
  if (Array.isArray(o.camposOcultos)) {
    const { camposOcultos, ...resto } = o;
    const previos = (resto.visibilidadTextos ?? {}) as Record<string, SoloEn>;
    const convertidos = Object.fromEntries((camposOcultos as string[]).map((c) => [c, "nunca"]));
    const visibilidadTextos = { ...convertidos, ...previos };
    o = Object.keys(visibilidadTextos).length > 0 ? { ...resto, visibilidadTextos } : resto;
  }
  if (Array.isArray(o.items) && o.items.some((it) => typeof it === "string")) {
    o = { ...o, items: o.items.map((it) => (typeof it === "string" ? { texto: it } : it)) };
  }
  return o as T;
}

/** Payload usable para la sección, o null si hay que quedarse con el default. */
export function resolverSeccion(key: string, payload: unknown): unknown {
  if (!(SECCIONES_HOME as readonly string[]).includes(key)) return null;
  return erroresSeccion(key, payload).length === 0 ? payload : null;
}

/** Key de home_content con la visibilidad de las secciones. Se llama así
 *  porque antes guardaba sólo la lista de secciones ocultas. */
export const KEY_OCULTAS = "ocultas";

/**
 * Datos legales del comercio (páginas legales + footer). Viven en home_content
 * bajo su propia key, pero NO son una sección de la home: no están en
 * `SECCIONES_HOME` ni en la visibilidad, y `combinarContenidoHome` los ignora.
 * Defaults vacíos a propósito: ningún dato del comercio vive en el código.
 */
export const KEY_LEGAL = "legal";

export type DatosLegales = {
  razonSocial?: string;
  cuit?: string;
  domicilio?: string;
  email?: string;
  dataFiscalUrl?: string;
};

export const DEFAULTS_LEGAL: DatosLegales = {};

export const MAX_LEGAL = { razonSocial: 200, cuit: 13, domicilio: 300, email: 254, dataFiscalUrl: 500 } as const;

const CAMPOS_LEGALES = ["razonSocial", "cuit", "domicilio", "email", "dataFiscalUrl"] as const;

const ETIQUETA_LEGAL: Record<(typeof CAMPOS_LEGALES)[number], string> = {
  razonSocial: "Razón social",
  cuit: "CUIT",
  domicilio: "Domicilio",
  email: "Correo electrónico",
  dataFiscalUrl: "Enlace del QR de Data Fiscal",
};

/** Mismo criterio que el resto del Shop (ver `looksLikeEmail` en comprobantes/mail.ts). */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Lectura tolerante de la fila (jsonb desconocido): solo strings, recortados; vacío = ausente. */
export function resolverDatosLegales(raw: unknown): DatosLegales {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const datos: DatosLegales = {};
  for (const campo of CAMPOS_LEGALES) {
    const v = o[campo];
    if (typeof v === "string" && v.trim()) datos[campo] = v.trim();
  }
  return datos;
}

/**
 * Enlace del QR de Data Fiscal normalizado a https, o null. Solo el host
 * exacto de ARCA (sin puerto) y con `qr` no vacío: el link se muestra en el
 * footer de todas las páginas, no puede apuntar a cualquier lado.
 */
export function normalizarUrlDataFiscal(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname !== "qr.afip.gob.ar" || url.port !== "") return null;
  if (!url.searchParams.get("qr")?.trim()) return null;
  url.protocol = "https:";
  return url.toString();
}

/** Valida y normaliza lo que manda el editor. Errores en usted, sin lanzar. */
export function validarDatosLegales(
  payload: unknown,
): { ok: true; datos: DatosLegales } | { ok: false; errores: string[] } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, errores: ["Los datos enviados no son válidos."] };
  }
  const crudos = resolverDatosLegales(payload);
  const errores: string[] = [];
  const datos: DatosLegales = {};

  for (const campo of CAMPOS_LEGALES) {
    const valor = crudos[campo];
    if (valor === undefined) continue;
    if (valor.length > MAX_LEGAL[campo]) {
      errores.push(`El campo ${ETIQUETA_LEGAL[campo]} supera los ${MAX_LEGAL[campo]} caracteres.`);
      continue;
    }
    if (campo === "cuit") {
      if (!cuitValido(valor)) errores.push("Indique un CUIT válido (11 dígitos).");
      else datos.cuit = formatearCuit(valor);
    } else if (campo === "email") {
      const email = valor.toLowerCase();
      if (!EMAIL_RE.test(email)) errores.push("Indique un correo electrónico válido.");
      else datos.email = email;
    } else if (campo === "dataFiscalUrl") {
      const url = normalizarUrlDataFiscal(valor);
      if (!url) errores.push("Pegue el enlace del QR que le entrega ARCA (qr.afip.gob.ar).");
      else datos.dataFiscalUrl = url;
    } else {
      datos[campo] = valor;
    }
  }

  return errores.length > 0 ? { ok: false, errores } : { ok: true, datos };
}

/**
 * Visibilidad por sección saneada: sólo keys y valores conocidos. Acepta el
 * formato viejo (array de secciones ocultas ⇒ "nunca"). "siempre" se guarda
 * explícito porque algunas secciones tienen otro default.
 */
export function resolverVisibilidad(payload: unknown): MapaVisibilidad {
  const mapa: MapaVisibilidad = {};
  if (Array.isArray(payload)) {
    for (const s of SECCIONES_HOME) if (payload.includes(s)) mapa[s] = "nunca";
    return mapa;
  }
  if (!payload || typeof payload !== "object") return mapa;
  const o = payload as Record<string, unknown>;
  for (const s of SECCIONES_HOME) {
    const v = o[s];
    if ((VISIBILIDADES as readonly unknown[]).includes(v)) mapa[s] = v as Visibilidad;
  }
  return mapa;
}

/** Dónde se ve una sección. */
export function visibilidadDe(mapa: MapaVisibilidad, seccion: SeccionHome): Visibilidad {
  return mapa[seccion] ?? "siempre";
}

/**
 * Clases que ocultan algo según dónde se ve, por CSS (sin JS, sin salto de
 * hidratación). "nunca" no tiene clase: eso se resuelve no pintándolo.
 */
export function clasesVisibilidad(v: Visibilidad | undefined): string {
  if (v === "desktop") return "max-md:hidden";
  if (v === "mobile") return "md:hidden";
  return "";
}

/** Mergea filas de la DB sobre los defaults, sección por sección. */
export function combinarContenidoHome(filas: { key: string; payload: unknown }[]): HomeContent {
  const porKey = new Map(filas.map((f) => [f.key, f.payload]));
  const resultado: HomeContent = { ...DEFAULTS_HOME };
  for (const key of SECCIONES_HOME) {
    if (!porKey.has(key)) continue;
    const payload = resolverSeccion(key, porKey.get(key));
    if (payload !== null) {
      // Filas guardadas antes de que existieran skus/imagenes no traen esos
      // campos: se heredan del default en vez de apagar los destacados
      // curados (el reemplazo es de sección entera, no por campo).
      const seccion =
        key === "destacados" && typeof payload === "object"
          ? {
              skus: DEFAULTS_HOME.destacados.skus,
              imagenes: DEFAULTS_HOME.destacados.imagenes,
              ...(payload as Record<string, unknown>),
            }
          : payload;
      Object.assign(resultado, { [key]: migrarVisibilidad(migrarAcento(seccion)) });
    } else if (key === "navBadge") {
      resultado.navBadge = null;
    }
  }
  if (porKey.has(KEY_OCULTAS)) {
    resultado.visibilidad = { ...DEFAULTS_HOME.visibilidad, ...resolverVisibilidad(porKey.get(KEY_OCULTAS)) };
  }
  return resultado;
}
