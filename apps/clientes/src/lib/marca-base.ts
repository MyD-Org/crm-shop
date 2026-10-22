/**
 * Marca de la tienda (nombre, textos, logos), parte PURA: sin base, sin caché, sin `next/*`. La
 * importan el proxy (gate), el layout, los mails y los tests. La lectura desde la base
 * (`tenants.shop_marca`, migración 0085 del CRM) vive en `marca.ts`.
 *
 * Reglas:
 *  - Marca vacía (`{}`) o ausente = `MARCA_POR_DEFECTO`: los textos de Central Led, EXACTOS a los
 *    que el código tenía escritos antes de este change. Esta constante es la única fuente de esos
 *    textos (el test `marca-hardcode.test.ts` impide que reaparezcan sueltos por el código).
 *  - `base: "generica"` arranca con textos neutros, sin nada de Central.
 *  - `resolverMarca` re-sanea lo que viene de la base: el admin ya valida, pero una fila tocada a
 *    mano no puede romper el sitio. Un campo inválido se descarta (cae al valor de partida); nunca
 *    lanza. Contrato compartido con el admin: `__fixtures__/marca-contrato.json`.
 */

export type MarcaBase = "central" | "generica";

export interface MarcaOgTextos {
  eyebrow: string;
  bajada: string;
  lugar: string;
}

/** Marca ya resuelta: todos los textos presentes (vacío = no mostrar). */
export interface Marca {
  base: MarcaBase;
  /** Visible: header, mails, descripción de pago, gate. */
  nombre: string;
  /** `<title>` y nombre del manifest. */
  titulo: string;
  /** Meta description, Open Graph y JSON-LD. */
  descripcion: string;
  /** Descripción del manifest (en Central es más corta que la del meta). */
  descripcionManifest: string;
  /** Línea bajo el nombre en el header. Vacío = sin línea. */
  lema: string;
  logoUrl?: string;
  logoMailUrl?: string;
  faviconUrl?: string;
  ogImagenUrl?: string;
  ogTextos: MarcaOgTextos;
  emailContacto?: string;
}

/** Forma cruda de `tenants.shop_marca`: todo opcional. */
export interface ShopMarcaCruda {
  base?: MarcaBase;
  nombre?: string;
  titulo?: string;
  descripcion?: string;
  logoUrl?: string;
  logoMailUrl?: string;
  faviconUrl?: string;
  ogImagenUrl?: string;
  ogTextos?: Partial<MarcaOgTextos>;
  emailContacto?: string;
}

/** Los textos de Central Led de siempre. NO editar sin querer cambiar la tienda de Central. */
export const MARCA_POR_DEFECTO: Marca = {
  base: "central",
  nombre: "Central LED",
  titulo: "Central LED — Tienda Online",
  descripcion:
    "Iluminación, materiales eléctricos, herramientas y mucho más en Puerto Iguazú, Misiones. Stock en tiempo real.",
  descripcionManifest:
    "Iluminación, materiales eléctricos, herramientas y mucho más en Puerto Iguazú, Misiones.",
  lema: "Iluminación · Electricidad",
  ogTextos: {
    eyebrow: "ILUMINACIÓN · ELECTRICIDAD",
    bajada: "Iluminación, materiales eléctricos y mucho más",
    lugar: "Tienda online · Puerto Iguazú, Misiones",
  },
};

/** Nombre partido en dos tintas ("Central" + "Led" en el acento): sólo el de Central lo tiene. */
export const PARTES_NOMBRE_CENTRAL = ["Central", "Led"] as const;

/** Nombre de partida cuando no hay ni marca ni variable de entorno (tienda genérica). */
export const NOMBRE_GENERICO = "Tienda online";

/** Alt de los logos de Central (los de código). */
export const ALT_LOGO_CENTRAL = "Central Led";

/**
 * Íconos de Central (los genera `npm run web` del kit de marca). `svg`: `src/app/icon.svg`
 * (convención de Next); `ico`: `public/favicon.ico`, respaldo para los navegadores sin favicon SVG
 * (Safari); los PNG, en public/images/central-led/. `apple`: el de la pantalla de inicio de iOS
 * (cuadrado lleno, iOS redondea). `maskable`: fondo lleno y el badge dentro de la zona segura de
 * Android.
 */
export const ICONOS_CENTRAL = {
  svg: "/icon.svg",
  ico: "/favicon.ico",
  apple: "/images/central-led/apple-icon.png",
  pwa192: "/images/central-led/icon-192.png",
  pwa512: "/images/central-led/icon-512.png",
  maskable: "/images/central-led/icon-maskable-512.png",
} as const;

/** La tienda de Central con su nombre (no otra marca sobre la base de Central): lleva sus logos. */
export function esMarcaCentral(marca: Pick<Marca, "base" | "nombre">): boolean {
  return marca.base === "central" && marca.nombre === MARCA_POR_DEFECTO.nombre;
}

export const NOMBRE_MAX = 60;
export const TITULO_MAX = 80;
export const DESCRIPCION_MAX = 200;
export const OG_EYEBROW_MAX = 40;
export const OG_BAJADA_MAX = 120;
export const OG_LUGAR_MAX = 60;
export const EMAIL_MAX = 120;

const EXTENSIONES_IMAGEN = ["svg", "png", "webp", "jpg"] as const;
const EXTENSIONES_MAIL = ["png", "jpg"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const limpiar = (s: string) => s.replace(/\s+/g, " ").trim();

/** Texto opcional: no-texto, vacío o más largo que el tope = ausente. */
function texto(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = limpiar(v);
  return t && t.length <= max ? t : undefined;
}

/** URL de imagen permitida (https, host de medios, sin credenciales/query/hash, extensión válida). */
function urlImagen(v: unknown, hosts: readonly string[], extensiones: readonly string[]): string | undefined {
  if (typeof v !== "string" || hosts.length === 0) return undefined;
  const crudo = v.trim();
  if (!crudo) return undefined;
  let u: URL;
  try {
    u = new URL(crudo);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return undefined;
  if (!hosts.includes(u.hostname.toLowerCase())) return undefined;
  const ext = u.pathname.split(".").pop()?.toLowerCase() ?? "";
  if (!u.pathname.includes(".") || !extensiones.includes(ext)) return undefined;
  return u.href;
}

/**
 * Saneo tolerante de la columna. Devuelve sólo los campos válidos (los demás, ausentes); `{}` para
 * cualquier cosa que no sea un objeto.
 */
export function sanearMarca(raw: unknown, hosts: readonly string[]): ShopMarcaCruda {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const b = raw as Record<string, unknown>;
  const out: ShopMarcaCruda = {};

  if (b.base === "central" || b.base === "generica") out.base = b.base;

  const nombre = texto(b.nombre, NOMBRE_MAX);
  if (nombre) out.nombre = nombre;
  const titulo = texto(b.titulo, TITULO_MAX);
  if (titulo) out.titulo = titulo;
  const descripcion = texto(b.descripcion, DESCRIPCION_MAX);
  if (descripcion) out.descripcion = descripcion;

  for (const [campo, ext] of [
    ["logoUrl", EXTENSIONES_IMAGEN],
    ["logoMailUrl", EXTENSIONES_MAIL],
    ["faviconUrl", EXTENSIONES_IMAGEN],
    ["ogImagenUrl", EXTENSIONES_IMAGEN],
  ] as const) {
    const url = urlImagen(b[campo], hosts, ext);
    if (url) out[campo] = url;
  }

  if (b.ogTextos && typeof b.ogTextos === "object" && !Array.isArray(b.ogTextos)) {
    const o = b.ogTextos as Record<string, unknown>;
    const og: Partial<MarcaOgTextos> = {};
    const eyebrow = texto(o.eyebrow, OG_EYEBROW_MAX);
    if (eyebrow) og.eyebrow = eyebrow;
    const bajada = texto(o.bajada, OG_BAJADA_MAX);
    if (bajada) og.bajada = bajada;
    const lugar = texto(o.lugar, OG_LUGAR_MAX);
    if (lugar) og.lugar = lugar;
    if (Object.keys(og).length > 0) out.ogTextos = og;
  }

  const mail = texto(b.emailContacto, EMAIL_MAX);
  if (mail && EMAIL_RE.test(mail)) out.emailContacto = mail;

  return out;
}

/**
 * Marca final = valores de partida de su `base` + lo cargado. `envNombre`
 * (`NEXT_PUBLIC_SHOP_MARCA_NOMBRE`) sólo es el nombre de partida de una marca genérica: la de
 * Central conserva el suyo.
 */
export function resolverMarca(
  raw: unknown,
  envNombre?: string,
  hosts: readonly string[] = [],
): Marca {
  const m = sanearMarca(raw, hosts);
  const base: MarcaBase = m.base ?? "central";

  if (base === "central") {
    const nombre = m.nombre ?? MARCA_POR_DEFECTO.nombre;
    const cambiaNombre = nombre !== MARCA_POR_DEFECTO.nombre;
    return {
      ...MARCA_POR_DEFECTO,
      nombre,
      titulo: m.titulo ?? (cambiaNombre ? `${nombre} — Tienda Online` : MARCA_POR_DEFECTO.titulo),
      descripcion: m.descripcion ?? MARCA_POR_DEFECTO.descripcion,
      descripcionManifest: m.descripcion ?? MARCA_POR_DEFECTO.descripcionManifest,
      ogTextos: { ...MARCA_POR_DEFECTO.ogTextos, ...m.ogTextos },
      ...(m.logoUrl ? { logoUrl: m.logoUrl } : {}),
      ...(m.logoMailUrl ? { logoMailUrl: m.logoMailUrl } : {}),
      ...(m.faviconUrl ? { faviconUrl: m.faviconUrl } : {}),
      ...(m.ogImagenUrl ? { ogImagenUrl: m.ogImagenUrl } : {}),
      ...(m.emailContacto ? { emailContacto: m.emailContacto } : {}),
    };
  }

  const nombre = m.nombre ?? (envNombre?.trim() || NOMBRE_GENERICO);
  const descripcion = m.descripcion ?? `Tienda online de ${nombre}.`;
  return {
    base: "generica",
    nombre,
    titulo: m.titulo ?? `${nombre} — Tienda Online`,
    descripcion,
    descripcionManifest: descripcion,
    lema: "",
    ogTextos: { eyebrow: "", bajada: "", lugar: "", ...m.ogTextos },
    ...(m.logoUrl ? { logoUrl: m.logoUrl } : {}),
    ...(m.logoMailUrl ? { logoMailUrl: m.logoMailUrl } : {}),
    ...(m.faviconUrl ? { faviconUrl: m.faviconUrl } : {}),
    ...(m.ogImagenUrl ? { ogImagenUrl: m.ogImagenUrl } : {}),
    ...(m.emailContacto ? { emailContacto: m.emailContacto } : {}),
  };
}

/**
 * Marca cuando la base no responde (o la columna aún no existe). Si la variable pública del
 * nombre está, es una tienda con marca propia: se muestra SÓLO su nombre (sin logo y sin ningún
 * texto de Central). Sin la variable, la de Central (que es la tienda que no la define).
 */
export function marcaDeEntorno(envNombre = process.env.NEXT_PUBLIC_SHOP_MARCA_NOMBRE): Marca {
  const nombre = envNombre?.trim();
  if (!nombre) return MARCA_POR_DEFECTO;
  return resolverMarca({ base: "generica", nombre }, nombre);
}

/** Nombre de la tienda para lo que no puede esperar a la base (gate, error global). */
export function nombreMarcaEntorno(envNombre = process.env.NEXT_PUBLIC_SHOP_MARCA_NOMBRE): string {
  return envNombre?.trim() || MARCA_POR_DEFECTO.nombre;
}

/** El nombre en una o dos tintas, para `brandName`/`brandAccent` del DS. */
export function partesNombre(marca: Pick<Marca, "nombre">): { principal: string; acento?: string } {
  if (marca.nombre === MARCA_POR_DEFECTO.nombre) {
    return { principal: PARTES_NOMBRE_CENTRAL[0], acento: PARTES_NOMBRE_CENTRAL[1] };
  }
  return { principal: marca.nombre };
}

/** Texto alternativo del logo de código (SVG de Central) o nombre de la tienda. */
export function altLogo(marca: Pick<Marca, "nombre">): string {
  return marca.nombre === MARCA_POR_DEFECTO.nombre ? ALT_LOGO_CENTRAL : marca.nombre;
}

/** Nombre sin espacios ni símbolos, para identificadores técnicos (User-Agent). Central: "CentralLed". */
export function idTecnico(marca: Pick<Marca, "nombre">): string {
  if (marca.nombre === MARCA_POR_DEFECTO.nombre) return PARTES_NOMBRE_CENTRAL.join("");
  return marca.nombre.normalize("NFD").replace(/[^A-Za-z0-9]/g, "") || "Shop";
}

/** `Pedido N — <nombre>`: descripción del cobro en el procesador. */
export function descripcionPedido(numero: string | number, marca: Pick<Marca, "nombre">): string {
  return `Pedido ${numero} — ${marca.nombre}`;
}

/** Hosts desde los que se aceptan imágenes de marca: SHOP_MEDIA_HOSTS + host del bucket público. */
export function hostsDeMarca(env: Record<string, string | undefined> = process.env): string[] {
  const lista = (env.SHOP_MEDIA_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  try {
    const pub = env.R2_SHOP_MEDIA_PUBLIC_URL?.trim();
    if (pub) lista.push(new URL(pub).hostname.toLowerCase());
  } catch {
    // URL pública ilegible: no habilita nada.
  }
  return [...new Set(lista)];
}
