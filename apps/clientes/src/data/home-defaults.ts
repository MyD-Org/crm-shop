/**
 * Contenido por defecto de la home, editable después desde el CRM vía
 * PUT /api/internal/home-content. Cada sección de la DB pisa a su default
 * solo si valida (ver erroresSeccion). Las imágenes default son placeholders
 * SVG inline (data URI) en la paleta editorial: se reemplazan desde el CRM
 * por URLs públicas de fotos reales.
 */

export type Enlace = { label: string; href: string };

export type HeroContent = {
  eyebrow: string;
  titulo: string;
  acento?: string;
  bajada: string;
  imagen: string;
  imagenAlt: string;
  ctas: Enlace[];
  usps: { label: string }[];
};

export type MarqueeContent = { items: string[] };

export type TileContent = {
  eyebrow: string;
  titulo: string;
  imagen: string;
  href: string;
};

export type SeccionTilesContent = {
  titulo: string;
  acento?: string;
  bajada?: string;
  linkTodos: string;
  items: TileContent[];
};

export type DestacadosContent = {
  titulo: string;
  acento?: string;
  bajada?: string;
  linkTodos: string;
  cantidad: number;
};

export type BannerDecoContent = {
  eyebrow: string;
  titulo: string;
  acento?: string;
  bajada: string;
  cta: Enlace;
  imagen: string;
};

export type DecoGridContent = {
  titulo: string;
  acento?: string;
  linkTodos: string;
  items: TileContent[];
  chips: Enlace[];
};

export type ServiciosContent = { items: { titulo: string; texto: string }[] };
export type NavBadgeContent = { categoria: string; texto: string };

export type HomeContent = {
  anuncio: { texto: string };
  hero: HeroContent;
  marquee: MarqueeContent;
  ambientes: SeccionTilesContent;
  destacados: DestacadosContent;
  bannerDeco: BannerDecoContent;
  decoGrid: DecoGridContent;
  servicios: ServiciosContent;
  /** null = la categoría del nav no lleva badge. */
  navBadge: NavBadgeContent | null;
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
] as const;

export type SeccionHome = (typeof SECCIONES_HOME)[number];

/** Placeholder SVG en paleta editorial (crema→ámbar suave) como data URI. */
function svgPlaceholder(desde: string, hacia: string, etiqueta: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${desde}"/><stop offset="1" stop-color="${hacia}"/>` +
    `</linearGradient></defs>` +
    `<rect width="1200" height="900" fill="url(#g)"/>` +
    `<circle cx="880" cy="240" r="150" fill="#f0c98f" opacity="0.4"/>` +
    `<circle cx="240" cy="700" r="90" fill="#b3603f" opacity="0.18"/>` +
    `<text x="60" y="830" font-family="Georgia, serif" font-size="46" fill="#8a7a66">${etiqueta}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const PLACEHOLDER = {
  hero: svgPlaceholder("#efe7da", "#f3e3cb", "Living cálido"),
  iluminacion: svgPlaceholder("#f3e3cb", "#efe7da", "Iluminación LED"),
  tableros: svgPlaceholder("#e8dcc8", "#d9c7ad", "Tableros y protecciones"),
  cables: svgPlaceholder("#efe7da", "#e8dcc8", "Cables e instalación"),
  colgantes: svgPlaceholder("#f3e3cb", "#efe7da", "Colgantes"),
  patio: svgPlaceholder("#e8dcc8", "#efe7da", "Patio y jardín"),
  dormitorio: svgPlaceholder("#efe7da", "#e8dcc8", "Dormitorio"),
  patioAnochecer: svgPlaceholder("#d9c7ad", "#b3603f", "Patio al atardecer"),
  guirnaldas: svgPlaceholder("#efe7da", "#f3e3cb", "Guirnaldas"),
  neones: svgPlaceholder("#e8dcc8", "#efe7da", "Neones y tiras"),
  veladores: svgPlaceholder("#f3e3cb", "#efe7da", "Veladores"),
};

export const DEFAULTS_HOME: HomeContent = {
  anuncio: {
    texto: "Envío gratis en compras desde $100.000 · 6 cuotas sin interés · Retiro en local sin cargo",
  },
  hero: {
    eyebrow: "Nueva colección 2026",
    titulo: "La luz que hace",
    acento: "hogar",
    bajada:
      "Materiales eléctricos e iluminación con stock real y marcas líderes. Envíos a todo el país y 6 cuotas sin interés.",
    imagen: PLACEHOLDER.hero,
    imagenAlt: "Ambiente cálido iluminado",
    ctas: [
      { label: "Ver catálogo →", href: "/catalogo" },
      { label: "Los más vendidos", href: "/catalogo?orden=ventas" },
    ],
    usps: [
      { label: "Envíos a todo el país" },
      { label: "Stock en tiempo real" },
      { label: "6 cuotas sin interés" },
    ],
  },
  marquee: {
    items: [
      "Más de 5.000 productos",
      "Despacho en 24 h",
      "Retiro en local sin cargo",
      "Puerto Iguazú, Misiones",
    ],
  },
  ambientes: {
    titulo: "Comprá por",
    acento: "rubro",
    bajada: "Todo para tu instalación, ordenado por categoría.",
    linkTodos: "/catalogo",
    items: [
      { eyebrow: "Catálogo", titulo: "Iluminación LED", imagen: PLACEHOLDER.iluminacion, href: "/catalogo" },
      { eyebrow: "Pro", titulo: "Tableros y protecciones", imagen: PLACEHOLDER.tableros, href: "/catalogo" },
      { eyebrow: "Pro", titulo: "Cables e instalación", imagen: PLACEHOLDER.cables, href: "/catalogo" },
    ],
  },
  destacados: {
    titulo: "Los más",
    acento: "queridos",
    bajada: "Los productos que eligen nuestros clientes, con stock confirmado y cuotas.",
    linkTodos: "/catalogo",
    cantidad: 4,
  },
  bannerDeco: {
    eyebrow: "Línea decorativa",
    titulo: "Ambientá tus noches con",
    acento: "luz cálida",
    bajada: "Guirnaldas, neones, veladores y colgantes para transformar cualquier espacio.",
    cta: { label: "Descubrir la línea →", href: "/catalogo" },
    imagen: PLACEHOLDER.patioAnochecer,
  },
  decoGrid: {
    titulo: "Decorativa para",
    acento: "cada rincón",
    linkTodos: "/catalogo",
    items: [
      { eyebrow: "Exterior", titulo: "Guirnaldas", imagen: PLACEHOLDER.guirnaldas, href: "/catalogo" },
      { eyebrow: "Interior", titulo: "Neones y tiras", imagen: PLACEHOLDER.neones, href: "/catalogo" },
      { eyebrow: "Interior", titulo: "Veladores", imagen: PLACEHOLDER.veladores, href: "/catalogo" },
      { eyebrow: "Interior", titulo: "Colgantes", imagen: PLACEHOLDER.colgantes, href: "/catalogo" },
    ],
    chips: [
      { label: "Apliques de pared", href: "/catalogo" },
      { label: "Faroles solares", href: "/catalogo" },
      { label: "Smart / Wi-Fi", href: "/catalogo" },
      { label: "Efecto fuego", href: "/catalogo" },
      { label: "Listones y tubos", href: "/catalogo" },
    ],
  },
  servicios: {
    items: [
      { titulo: "Envío gratis", texto: "En compras desde $100.000 a todo el país." },
      { titulo: "Stock real", texto: "Sincronizado al instante con nuestro depósito." },
      { titulo: "6 cuotas sin interés", texto: "Y precios especiales por transferencia." },
      { titulo: "Asesoramiento técnico", texto: "Te ayudamos por WhatsApp a elegir bien." },
    ],
  },
  navBadge: null,
};

// ---------------------------------------------------------------------------
// Validación mínima por sección (contrato del PUT /api/internal/home-content)
// ---------------------------------------------------------------------------

function esTexto(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function esEnlace(v: unknown): v is Enlace {
  const o = v as Enlace;
  return !!v && typeof v === "object" && esTexto(o.label) && esTexto(o.href);
}

function esTile(v: unknown): v is TileContent {
  const o = v as TileContent;
  return !!v && typeof v === "object" && esTexto(o.eyebrow) && esTexto(o.titulo) && esTexto(o.imagen) && esTexto(o.href);
}

/** Devuelve la lista de problemas del payload para la sección ([] = válido). */
export function erroresSeccion(key: string, payload: unknown): string[] {
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

  switch (key) {
    case "anuncio":
      texto("texto");
      break;
    case "hero": {
      texto("eyebrow");
      texto("titulo");
      texto("acento", true);
      texto("bajada");
      texto("imagen");
      if (!Array.isArray(o.ctas) || !o.ctas.every(esEnlace)) errores.push("ctas debe ser un array de { label, href }");
      if (!Array.isArray(o.usps) || o.usps.length === 0 || !(o.usps as { label?: unknown }[]).every((u) => esTexto(u?.label)))
        errores.push("usps debe ser un array no vacío de { label }");
      break;
    }
    case "marquee":
      if (!Array.isArray(o.items) || o.items.length === 0 || !(o.items as unknown[]).every(esTexto))
        errores.push("items debe ser un array no vacío de textos");
      break;
    case "ambientes":
    case "decoGrid": {
      texto("titulo");
      texto("acento", true);
      if (key === "ambientes") texto("bajada", true);
      if (!esTexto(o.linkTodos)) errores.push("linkTodos debe ser un texto no vacío");
      if (!Array.isArray(o.items) || o.items.length === 0 || !o.items.every(esTile))
        errores.push("items debe ser un array no vacío de tiles { eyebrow, titulo, imagen, href }");
      if (key === "decoGrid" && (!Array.isArray(o.chips) || !o.chips.every(esEnlace)))
        errores.push("chips debe ser un array de { label, href }");
      break;
    }
    case "destacados": {
      texto("titulo");
      texto("acento", true);
      texto("bajada", true);
      if (!esTexto(o.linkTodos)) errores.push("linkTodos debe ser un texto no vacío");
      if (typeof o.cantidad !== "number" || o.cantidad < 1 || o.cantidad > 24)
        errores.push("cantidad debe ser un número entre 1 y 24");
      break;
    }
    case "bannerDeco": {
      texto("eyebrow");
      texto("titulo");
      texto("acento", true);
      texto("bajada");
      texto("imagen");
      if (!esEnlace(o.cta)) errores.push("cta debe ser { label, href }");
      break;
    }
    case "servicios":
      if (!Array.isArray(o.items) || o.items.length === 0 ||
          !(o.items as { titulo?: unknown; texto?: unknown }[]).every((s) => esTexto(s?.titulo) && esTexto(s?.texto)))
        errores.push("items debe ser un array no vacío de { titulo, texto }");
      break;
  }
  return errores;
}

/** Payload usable para la sección, o null si hay que quedarse con el default. */
export function resolverSeccion(key: string, payload: unknown): unknown {
  if (!(SECCIONES_HOME as readonly string[]).includes(key)) return null;
  return erroresSeccion(key, payload).length === 0 ? payload : null;
}

/** Mergea filas de la DB sobre los defaults, sección por sección. */
export function combinarContenidoHome(filas: { key: string; payload: unknown }[]): HomeContent {
  const porKey = new Map(filas.map((f) => [f.key, f.payload]));
  const resultado: HomeContent = { ...DEFAULTS_HOME };
  for (const key of SECCIONES_HOME) {
    if (!porKey.has(key)) continue;
    const payload = resolverSeccion(key, porKey.get(key));
    if (payload !== null) {
      Object.assign(resultado, { [key]: payload });
    } else if (key === "navBadge") {
      resultado.navBadge = null;
    }
  }
  return resultado;
}
