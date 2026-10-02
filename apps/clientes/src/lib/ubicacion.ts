/**
 * Ubicación del visitante (change `envio-gratis-configurable`, rebanada C). Módulo PURO: sin Next,
 * sin red. Lo importan el server (cookie, páginas) y la UI.
 *
 * Precedencia: cookie `shop_ubicacion` (elección explícita: localidad elegida a mano, dirección
 * guardada, local de retiro o geolocalización con permiso) → dirección guardada (con sesión) → sin
 * ubicación. Nunca se inventa una por default ni se usa la IP. La unidad es la localidad y de ahí
 * sale la provincia; el código postal (opcional) sólo se guarda y se muestra, no cotiza.
 *
 * Cookie compatible hacia atrás: sin `tipo` (formato viejo) = envío. La validación de este módulo es
 * ESTRUCTURAL; que la dirección sea del usuario o que el local exista lo valida el servidor.
 */
import { PROVINCIAS_AR } from "./provincias";
import { claveProvincia } from "./sucursales";
import { nombreProvincia, textoEnvioFicha, type ConfigEnvio } from "./envio";

export const COOKIE_UBICACION = "shop_ubicacion";
/** Un año, en segundos. */
export const COOKIE_UBICACION_MAX_AGE = 60 * 60 * 24 * 365;
const MAX_LOCALIDAD = 80;

export interface UbicacionVisitante {
  localidad: string;
  /** Clave canónica de la provincia (`claveProvincia`). */
  provincia: string;
  /** Id de Georef, si la localidad se eligió de la lista. */
  id?: string;
  /** Código postal normalizado (4 dígitos o CPA), si se conoce. */
  cp?: string;
}

export type TipoEntrega = "envio" | "retiro";

/** Lo que se serializa en la cookie (y lo que devuelve su validación estructural). */
export type EleccionCruda =
  | { tipo: "envio"; localidad: string; provincia: string; id?: string; cp?: string; direccionId?: string }
  | { tipo: "retiro"; /** Slug del local; ausente = local único (flag `sucursales` apagado). */ sucursal?: string };

export type CookieUbicacion = EleccionCruda;

/** Elección ya resuelta y validada contra el dueño / las sucursales (ver `ubicacion-servidor`). */
export type EleccionUbicacion =
  | {
      tipo: "envio";
      direccion?: { id: string; calle: string; ciudad: string; cp: string | null; etiqueta: string | null };
      localidad: string;
      provincia: string | null;
      cp?: string;
    }
  | {
      tipo: "retiro";
      /** null = local único de la empresa (flag `sucursales` apagado). */
      sucursal: { slug: string; nombre: string; ciudad: string; provincia: string } | null;
    }
  | { tipo: "ninguna" };

const SLUG_SUCURSAL = /^[a-z0-9-]{1,60}$/;
const ID_DIRECCION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** CP de 4 dígitos o CPA (letra de provincia + 4 dígitos + 3 letras). */
const CP_VALIDO = /^(?:\d{4}|[A-Z]\d{4}[A-Z]{3})$/;

/**
 * Normaliza un código postal: sin espacios ni guiones, en mayúsculas. null si no es de 4 dígitos
 * ni un CPA válido.
 */
export function normalizarCp(cp: unknown): string | null {
  if (typeof cp !== "string") return null;
  const n = cp.replace(/[\s-]+/g, "").toUpperCase();
  return CP_VALIDO.test(n) ? n : null;
}

export type OrigenUbicacion = "direccion" | "cookie" | "ninguna";

const CLAVES_VALIDAS = new Set(PROVINCIAS_AR.map((p) => claveProvincia(p)));

/** Texto sin caracteres de control ni exceso de largo (la cookie la puede editar cualquiera). */
function limpiar(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();
  return t && t.length <= MAX_LOCALIDAD ? t : null;
}

/** Arma la ubicación a guardar; null si la localidad o la provincia no sirven. */
export function armarUbicacion(entrada: {
  localidad: unknown;
  provincia: unknown;
  id?: unknown;
}): UbicacionVisitante | null {
  const localidad = limpiar(entrada.localidad);
  const provincia = typeof entrada.provincia === "string" ? entrada.provincia : "";
  if (!localidad || !CLAVES_VALIDAS.has(provincia)) return null;
  const id = typeof entrada.id === "string" && /^\d{1,12}$/.test(entrada.id) ? entrada.id : undefined;
  return id ? { localidad, provincia, id } : { localidad, provincia };
}

/**
 * Arma una elección a guardar desde datos sueltos (cuerpo de la API o cookie). Estructural: null si
 * no sirve. El `cp` inválido se descarta (la API lo valida aparte para responder 400).
 */
export function armarEleccion(entrada: {
  tipo?: unknown;
  localidad?: unknown;
  provincia?: unknown;
  id?: unknown;
  cp?: unknown;
  direccionId?: unknown;
  sucursal?: unknown;
}): EleccionCruda | null {
  const tipo = entrada.tipo === undefined ? "envio" : entrada.tipo;
  if (tipo === "retiro") {
    if (entrada.sucursal === undefined || entrada.sucursal === null) return { tipo: "retiro" };
    const slug = entrada.sucursal;
    if (typeof slug !== "string" || !SLUG_SUCURSAL.test(slug)) return null;
    return { tipo: "retiro", sucursal: slug };
  }
  if (tipo !== "envio") return null;
  const u = armarUbicacion({ localidad: entrada.localidad, provincia: entrada.provincia, id: entrada.id });
  if (!u) return null;
  let direccionId: string | undefined;
  if (entrada.direccionId !== undefined && entrada.direccionId !== null) {
    if (typeof entrada.direccionId !== "string" || !ID_DIRECCION.test(entrada.direccionId)) return null;
    direccionId = entrada.direccionId;
  }
  const cp = normalizarCp(entrada.cp);
  return {
    tipo: "envio",
    localidad: u.localidad,
    provincia: u.provincia,
    ...(u.id ? { id: u.id } : {}),
    ...(cp ? { cp } : {}),
    ...(direccionId ? { direccionId } : {}),
  };
}

/**
 * Valida el valor crudo de la cookie. JSON roto, tipos raros, un tipo desconocido o una provincia
 * fuera del catálogo = null (sin elección), sin error.
 */
export function validarCookieUbicacion(raw: string | null | undefined): EleccionCruda | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return armarEleccion(v as Record<string, unknown>);
}

/**
 * Serializa reemplazando POR COMPLETO la elección: sólo viajan los campos de su tipo (un retiro no
 * arrastra localidad ni direccionId; un envío no arrastra sucursal).
 */
export function serializarCookieUbicacion(c: CookieUbicacion): string {
  if (c.tipo === "retiro") return JSON.stringify(c.sucursal ? { tipo: "retiro", sucursal: c.sucursal } : { tipo: "retiro" });
  return JSON.stringify({
    tipo: "envio",
    localidad: c.localidad,
    provincia: c.provincia,
    ...(c.id ? { id: c.id } : {}),
    ...(c.cp ? { cp: c.cp } : {}),
    ...(c.direccionId ? { direccionId: c.direccionId } : {}),
  });
}

/** Dirección guardada → ubicación; null si la ciudad o la provincia no sirven. */
function desdeDireccion(d: { ciudad: string; provincia: string | null } | null | undefined): UbicacionVisitante | null {
  if (!d) return null;
  return armarUbicacion({ localidad: d.ciudad, provincia: claveProvincia(d.provincia) });
}

export function resolverUbicacion(entrada: {
  direccionGuardada?: { ciudad: string; provincia: string | null } | null;
  cookie?: UbicacionVisitante | null;
}): { ubicacion: UbicacionVisitante | null; origen: OrigenUbicacion } {
  // Lo que el visitante eligió a mano manda sobre la dirección guardada.
  if (entrada.cookie) return { ubicacion: entrada.cookie, origen: "cookie" };
  const dir = desdeDireccion(entrada.direccionGuardada);
  if (dir) return { ubicacion: dir, origen: "direccion" };
  return { ubicacion: null, origen: "ninguna" };
}

/** "Usted está en <localidad>, <provincia>". */
export function textoUbicacion(u: UbicacionVisitante): string {
  return `Usted está en ${u.localidad}, ${nombreProvincia(u.provincia)}`;
}

/**
 * Qué muestra la fila "Envío a domicilio" de la ficha. `pedir` = sólo la localidad decide la
 * respuesta (gratis por provincias) y todavía no se sabe: se invita a ingresarla. Resto: el texto
 * de la regla para su provincia (o la regla general si no hay ubicación). null = envío desactivado.
 */
export function envioFichaSegunUbicacion(
  config: ConfigEnvio,
  ubicacion: UbicacionVisitante | null,
): { tipo: "pedir" } | { tipo: "texto"; texto: string } | null {
  if (!config.domicilioActivo) return null;
  // Sin ubicación no se promete plazo ni costo: se le pide la localidad.
  if (!ubicacion) return { tipo: "pedir" };
  const texto = textoEnvioFicha(config, ubicacion?.provincia, ubicacion?.localidad);
  return texto ? { tipo: "texto", texto } : null;
}

/** Textos de la UI y de los mensajes de error de la API (usted). */
export const TEXTOS_UBICACION = {
  pedir: "Ingrese su localidad",
  pedirEnvio: "Ingrese su localidad para ver plazo y costo",
  usarMiUbicacion: "Usar mi ubicación",
  ubicando: "Buscando su ubicación…",
  etiquetaInput: "Localidad",
  placeholder: "Escriba al menos 4 letras…",
  buscando: "Buscando…",
  sinResultados: "No encontramos esa localidad. Revise el nombre e inténtelo nuevamente.",
  errorBusqueda: "No pudimos buscar localidades en este momento. Inténtelo nuevamente.",
  errorUbicacion: "No pudimos determinar su ubicación. Ingrese su localidad.",
  sinPermiso: "No pudimos acceder a su ubicación. Ingrese su localidad.",
  invalida: "Ubicación inválida.",
  demasiadas: "Demasiadas consultas. Espere un momento e inténtelo nuevamente.",
  quitar: "Quitar ubicación",
  cpInvalido: "Ingrese un código postal válido: 4 dígitos o formato CPA, por ejemplo 5000 o C1425ABC.",
  cpRequerido: "Ingrese su código postal.",
  direccionInvalida: "Seleccione una dirección guardada válida.",
  localInvalido: "Seleccione un local de retiro válido.",
  sinSesion: "Inicie sesión para elegir una dirección guardada.",
  direccionNoEncontrada: "No encontramos esa dirección.",
  localNoEncontrado: "No encontramos ese local de retiro.",
  // Header "Enviar a" y modal (PR2).
  enviarA: "Enviar a",
  retirarEn: "Retirar en",
  indiqueUbicacion: "Indique su ubicación",
  elLocal: "el local",
  tituloModal: "Seleccione dónde recibir su compra",
  descripcionModal: "Elija una dirección de envío o un local para retirar su compra.",
  legendDirecciones: "Sus direcciones",
  legendLocales: "Retirar en un local",
  retirarEnElLocal: "Retirar en el local",
  agregarDireccion: "Agregar nueva dirección",
  tituloAgregar: "Nueva dirección",
  tituloEditar: "Editar dirección",
  editar: "Editar",
  volver: "Volver",
  actual: "Actual",
  confirmar: "Confirmar",
  cargando: "Cargando opciones…",
  errorCarga: "No pudimos cargar sus direcciones. Inténtelo nuevamente.",
  errorLocales: "No pudimos cargar los locales de retiro. Inténtelo nuevamente.",
  reintentar: "Reintentar",
  limiteDirecciones: "Alcanzó el máximo de 10 direcciones guardadas. Edite una existente o elimínela desde Mi cuenta.",
  errorGuardar: "No pudimos guardar su elección. Inténtelo nuevamente.",
  elegirOpcion: "Seleccione una opción.",
  legendLocalidad: "Enviar a una localidad",
  etiquetaCp: "Código postal",
  placeholderCp: "Por ejemplo, 5000 o C1425ABC",
  elegirLocalidad: "Seleccione su localidad de la lista.",
  // Ficha (PR3): retiro en el local elegido.
  retiroEn: (local: string) => `Retiro en ${local}`,
  sinStockEn: (local: string) => `No disponible en ${local}`,
  completarCp: "Confirme su localidad en la lista e ingrese su código postal.",
} as const;
