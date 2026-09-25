/**
 * Contenido editable del footer global (descripción, columna "Contacto" y
 * textos de la barra inferior). Vive en home_content bajo la key `footer`,
 * igual que los datos legales: NO es una sección de la home (no está en
 * `SECCIONES_HOME` ni en la visibilidad, y `combinarContenidoHome` la ignora).
 *
 * Fuera de alcance a propósito: "Mi cuenta" y "Legales" (Legales tiene que
 * estar siempre), la marca y el QR de Data Fiscal.
 *
 * Los defaults son exactamente lo que el footer mostraba hardcodeado: sin fila,
 * nada cambia. Módulo puro (lo importan el editor cliente y el servidor).
 */

export const KEY_FOOTER = "footer";

/** Marcador de la barra inferior que se reemplaza por el año en curso. */
export const MARCADOR_ANIO = "{anio}";

export type EnlaceFooter = { label: string; href: string };

/** Un local físico. Se muestra como un link de "Contacto" que abre el mapa. */
export type LocalFooter = {
  /** Opcional ("Local centro"). */
  nombre: string;
  /** Texto visible. */
  direccion: string;
  /** https. Vacío = búsqueda de Google Maps armada con la dirección. */
  mapsUrl: string;
  /** Opcional ("Lun a Sáb 8 a 20"). */
  horario: string;
};

export type DatosFooter = {
  descripcion: string;
  /** Solo dígitos, con código de país (wa.me). Vacío = sin link de WhatsApp. */
  whatsapp: string;
  /** 0..N locales, en el orden en que se muestran. */
  locales: LocalFooter[];
  /** Enlaces extra de la columna "Contacto", después de WhatsApp y los locales. */
  enlaces: EnlaceFooter[];
  /** Admite `{anio}`. Vacío = sin texto. */
  barraIzquierda: string;
  barraDerecha: string;
};

/**
 * El local del default no tiene dirección cargada a propósito: así el link
 * sigue diciendo "Ubicación" y apunta al mismo mapa que antes.
 */
export const DEFAULTS_FOOTER: DatosFooter = {
  descripcion:
    "Casa de electricidad e iluminación en Puerto Iguazú, Misiones. Del disyuntor al velador: el local de siempre, ahora también online.",
  // Vacío = sin link de WhatsApp. El número real se carga en el editor del
  // footer (home_content): nada de datos de la tienda en el repo público.
  whatsapp: "",
  locales: [
    {
      nombre: "",
      direccion: "",
      mapsUrl:
        "https://www.google.com/maps/search/?api=1&query=Av.+Rep%C3%BAblica+Argentina%2C+Puerto+Iguaz%C3%BA%2C+Misiones",
      horario: "",
    },
  ],
  enlaces: [],
  barraIzquierda: `© ${MARCADOR_ANIO} Central Led — Puerto Iguazú, Misiones`,
  barraDerecha: "Av. República Argentina · Lun a Sáb",
};

export const MAX_FOOTER = {
  descripcion: 300,
  locales: 4,
  nombre: 60,
  direccion: 200,
  horario: 80,
  url: 500,
  barra: 120,
  enlaces: 4,
  etiqueta: 40,
} as const;

export function nuevoLocal(): LocalFooter {
  return { nombre: "", direccion: "", mapsUrl: "", horario: "" };
}

const NO_VALIDO = "Los datos enviados no son válidos.";

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const comoObjeto = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Link de wa.me para un número ya normalizado. */
export function hrefWhatsapp(numero: string): string {
  return `https://wa.me/${numero}`;
}

/** Búsqueda de Google Maps para una dirección. */
export function hrefMapsDireccion(direccion: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`;
}

/**
 * Link de un local en "Contacto". El DS solo pinta links en las columnas, así
 * que todo va en el texto: "Nombre: Dirección · Horario" (lo que haya; sin
 * nombre ni dirección dice "Ubicación"). Destino: el enlace de Maps cargado o,
 * si falta, la búsqueda de la dirección. Sin ninguno de los dos, no hay link.
 */
export function linkLocal(local: LocalFooter): EnlaceFooter | null {
  const href = local.mapsUrl || (local.direccion ? hrefMapsDireccion(local.direccion) : "");
  if (!href) return null;
  const lugar =
    local.nombre && local.direccion ? `${local.nombre}: ${local.direccion}` : local.nombre || local.direccion || "Ubicación";
  return { label: local.horario ? `${lugar} · ${local.horario}` : lugar, href };
}

/** Texto de la barra con `{anio}` reemplazado; vacío → undefined (el DS no pinta nada). */
export function textoBarra(plantilla: string, anio: number): string | undefined {
  const t = plantilla.split(MARCADOR_ANIO).join(String(anio)).trim();
  return t || undefined;
}

/** Número de WhatsApp a solo dígitos (acepta +, espacios, guiones y paréntesis), o null. */
export function normalizarWhatsapp(raw: string): string | null {
  const t = raw.trim();
  if (!/^\+?[\d\s\-()]+$/.test(t)) return null;
  const digitos = t.replace(/\D/g, "");
  return digitos.length >= 8 && digitos.length <= 15 ? digitos : null;
}

/** URL https sin credenciales, o null. `http://` se sube a https. */
export function normalizarUrlHttps(raw: string): string | null {
  const t = raw.trim();
  if (t.length > MAX_FOOTER.url) return null;
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || !url.hostname.includes(".")) return null;
  url.protocol = "https:";
  return url.toString();
}

/** Ruta interna del Shop (`/algo`), sin `//` ni `\` que la conviertan en otro sitio. */
export function esRutaInterna(raw: string): boolean {
  return raw.length <= MAX_FOOTER.url && /^\/(?![/\\])[^\s\\]*$/.test(raw);
}

/** Enlace del footer: https o ruta interna. Devuelve el href normalizado o null. */
export function normalizarHrefFooter(raw: string): string | null {
  const t = raw.trim();
  if (esRutaInterna(t)) return t;
  return normalizarUrlHttps(t);
}

function validarLocales(crudo: unknown, errores: string[]): LocalFooter[] {
  if (crudo === undefined) return [];
  if (!Array.isArray(crudo)) {
    errores.push(NO_VALIDO);
    return [];
  }
  const locales: LocalFooter[] = [];
  let cargados = 0;
  crudo.forEach((c, i) => {
    const o = comoObjeto(c);
    const local: LocalFooter = {
      nombre: texto(o.nombre),
      direccion: texto(o.direccion),
      mapsUrl: texto(o.mapsUrl),
      horario: texto(o.horario),
    };
    if (!local.nombre && !local.direccion && !local.mapsUrl && !local.horario) return; // fila vacía del editor
    cargados++;
    const n = i + 1;
    const antes = errores.length;
    if (!local.direccion && !local.mapsUrl) errores.push(`Indique la dirección del local ${n}.`);
    for (const [campo, etiqueta] of [
      ["nombre", "El nombre"],
      ["direccion", "La dirección"],
      ["horario", "El horario"],
    ] as const) {
      if (local[campo].length > MAX_FOOTER[campo]) {
        errores.push(`${etiqueta} del local ${n} supera los ${MAX_FOOTER[campo]} caracteres.`);
      }
    }
    if (local.mapsUrl) {
      const u = normalizarUrlHttps(local.mapsUrl);
      if (!u) errores.push(`Indique un enlace de mapa válido para el local ${n} (https://…).`);
      else local.mapsUrl = u;
    }
    if (errores.length === antes) locales.push(local);
  });
  if (cargados > MAX_FOOTER.locales) errores.push(`Puede cargar hasta ${MAX_FOOTER.locales} locales.`);
  return locales;
}

function validarEnlaces(crudo: unknown, errores: string[]): EnlaceFooter[] {
  if (crudo === undefined) return [];
  if (!Array.isArray(crudo)) {
    errores.push(NO_VALIDO);
    return [];
  }
  const enlaces: EnlaceFooter[] = [];
  let cargados = 0;
  crudo.forEach((e, i) => {
    const o = comoObjeto(e);
    const label = texto(o.label);
    const href = texto(o.href);
    if (!label && !href) return; // fila vacía del editor
    cargados++;
    const n = i + 1;
    const antes = errores.length;
    if (!label) errores.push(`Indique el texto del enlace ${n}.`);
    else if (label.length > MAX_FOOTER.etiqueta) {
      errores.push(`El texto del enlace ${n} supera los ${MAX_FOOTER.etiqueta} caracteres.`);
    }
    const hrefOk = href ? normalizarHrefFooter(href) : null;
    if (!hrefOk) errores.push(`Indique una dirección válida para el enlace ${n} (https://… o una ruta que empiece con /).`);
    if (errores.length === antes && hrefOk) enlaces.push({ label, href: hrefOk });
  });
  if (cargados > MAX_FOOTER.enlaces) errores.push(`Puede agregar hasta ${MAX_FOOTER.enlaces} enlaces.`);
  return enlaces;
}

/** Valida y normaliza lo que manda el editor. Errores en usted, sin lanzar. */
export function validarDatosFooter(
  payload: unknown,
): { ok: true; datos: DatosFooter } | { ok: false; errores: string[] } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, errores: [NO_VALIDO] };
  }
  const o = payload as Record<string, unknown>;
  const errores: string[] = [];

  const descripcion = texto(o.descripcion);
  if (!descripcion) errores.push("Ingrese la descripción del pie de página.");
  else if (descripcion.length > MAX_FOOTER.descripcion) {
    errores.push(`La descripción supera los ${MAX_FOOTER.descripcion} caracteres.`);
  }

  let whatsapp = texto(o.whatsapp);
  if (whatsapp) {
    const n = normalizarWhatsapp(whatsapp);
    if (!n) errores.push("Indique un número de WhatsApp válido, con código de país (por ejemplo, 54 9 11 1234 5678).");
    else whatsapp = n;
  }

  const locales = validarLocales(o.locales, errores);
  const enlaces = validarEnlaces(o.enlaces, errores);

  const barraIzquierda = texto(o.barraIzquierda);
  const barraDerecha = texto(o.barraDerecha);
  if (barraIzquierda.length > MAX_FOOTER.barra) {
    errores.push(`El texto izquierdo de la barra inferior supera los ${MAX_FOOTER.barra} caracteres.`);
  }
  if (barraDerecha.length > MAX_FOOTER.barra) {
    errores.push(`El texto derecho de la barra inferior supera los ${MAX_FOOTER.barra} caracteres.`);
  }

  if (errores.length > 0) return { ok: false, errores: [...new Set(errores)] };
  return { ok: true, datos: { descripcion, whatsapp, locales, enlaces, barraIzquierda, barraDerecha } };
}

/**
 * Lectura tolerante de la fila (jsonb desconocido). Campos que falten se
 * heredan del default (filas guardadas antes de sumar un campo); si lo que
 * queda no valida, vuelve el default entero: el footer nunca se rompe.
 */
export function resolverDatosFooter(raw: unknown): DatosFooter {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULTS_FOOTER;
  const r = validarDatosFooter({ ...DEFAULTS_FOOTER, ...(raw as Record<string, unknown>) });
  return r.ok ? r.datos : DEFAULTS_FOOTER;
}
