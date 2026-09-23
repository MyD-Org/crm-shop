import { hostsDeMedios } from "../lib/catalogo-medios";

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

export type Enlace = { label: string; href: string };

/**
 * Título y bajada de una sección. El título marca su acento con `*así*`, en
 * cualquier posición ("Todo lo que *su proyecto* necesita"). Las versiones
 * `…Mobile` son opcionales: vacías ⇒ en mobile se usa la de desktop.
 *
 * `acento` es el formato viejo (acento siempre al final): las filas guardadas
 * así se convierten al leerlas (ver `migrarAcento`) y el editor ya no lo usa.
 */
export type TextosSeccion = {
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
  usps: { label: string }[];
};

export type MarqueeContent = { items: string[] };

export type TileContent = {
  eyebrow?: string;
  titulo?: string;
  imagen: string;
  href: string;
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

export type ServiciosContent = { items: { titulo?: string; texto?: string }[] };
export type NavBadgeContent = { categoria: string; texto: string };
export type WhatsappContent = { titulo?: string; texto?: string; href: string };

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
  /** Secciones que el admin ocultó desde el editor: no se muestran a los
   *  visitantes. Se guarda en su propia fila de home_content (`ocultas`),
   *  así ocultar no pisa el contenido de la sección. */
  ocultas: SeccionHome[];
};

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
    texto: "Envío gratis en compras desde $100.000 · 6 cuotas sin interés · Retiro en local sin cargo",
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
      { label: "Envíos a todo el país" },
      { label: "Stock en tiempo real" },
      { label: "Asesoramiento por WhatsApp" },
    ],
  },
  marquee: {
    items: [
      "Más de 5.000 productos",
      "Despacho en 24 h",
      "Precios mayoristas",
      "Puerto Iguazú, Misiones",
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
    bajada: "Rotación real del local y la web: especificaciones completas, stock confirmado y hasta 6 cuotas.",
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
      { titulo: "Envío gratis", texto: "En compras desde $100.000 a todo el país." },
      { titulo: "Stock real", texto: "Disponibilidad online sincronizada con nuestro depósito." },
      { titulo: "6 cuotas sin interés", texto: "Y precios especiales por transferencia." },
      { titulo: "Asesoramiento técnico", texto: "Te ayudamos por WhatsApp con potencias, térmicas e instalación." },
    ],
  },
  navBadge: { categoria: "ILUMINACION", texto: "Nuevo" },
  whatsapp: {
    titulo: "¿Necesitás asesoramiento técnico?",
    texto: "Escribinos por WhatsApp y te ayudamos a elegir el producto correcto.",
    href: "https://wa.me/5492235903025",
  },
  ocultas: [],
};

// ---------------------------------------------------------------------------
// Validación por sección (la usan las server actions y combinarContenidoHome)
// ---------------------------------------------------------------------------

function esTexto(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Ausente o texto no vacío (los opcionales vacíos se descartan antes de guardar). */
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
  return !!v && typeof v === "object" && esTexto(o.label) && esHref(o.href);
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
    esHref(o.href)
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
      lista("usps", (u) => esTextoOpcional((u as { label?: unknown })?.label), "{ label }");
      break;
    }
    case "marquee":
      lista("items", esTexto, "textos");
      break;
    case "ambientes":
    case "decoGrid": {
      textosTitulo();
      linkOpcional("linkTodos");
      lista("items", (t) => esTile(t, hosts), "tiles { eyebrow?, titulo?, imagen, href }");
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
          const it = v as { titulo?: unknown; texto?: unknown };
          return !!v && typeof v === "object" && esTextoOpcional(it.titulo) && esTextoOpcional(it.texto);
        },
        "{ titulo?, texto? }",
      );
      break;
    case "whatsapp":
      texto("titulo", true);
      texto("texto", true);
      if (!esHref(o.href)) errores.push("href debe ser una ruta interna (/) o una URL https");
      break;
  }
  return errores;
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

/** Payload usable para la sección, o null si hay que quedarse con el default. */
export function resolverSeccion(key: string, payload: unknown): unknown {
  if (!(SECCIONES_HOME as readonly string[]).includes(key)) return null;
  return erroresSeccion(key, payload).length === 0 ? payload : null;
}

/** Key de home_content con la lista de secciones ocultas. */
export const KEY_OCULTAS = "ocultas";

/** Lista de secciones ocultas saneada: sólo keys conocidas, sin repetir. */
export function resolverOcultas(payload: unknown): SeccionHome[] {
  if (!Array.isArray(payload)) return [];
  return SECCIONES_HOME.filter((s) => payload.includes(s));
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
      Object.assign(resultado, { [key]: migrarAcento(seccion) });
    } else if (key === "navBadge") {
      resultado.navBadge = null;
    }
  }
  if (porKey.has(KEY_OCULTAS)) resultado.ocultas = resolverOcultas(porKey.get(KEY_OCULTAS));
  return resultado;
}
