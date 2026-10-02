/**
 * Lógica pura del selector "Enviar a" (header + modal). Sin React ni Next: lo que el header y el
 * modal muestran, cómo se codifica cada opción del RadioGroup y las llamadas a la API con `fetch`
 * inyectado, para poder probarlo sin DOM.
 *
 * Cada opción del modal es un string: `dir:<id>` (dirección guardada) o `local:<slug>` (retiro;
 * `local:` sin slug = local único con el flag `sucursales` apagado). El cuerpo del POST sale de ese
 * valor; el servidor valida todo de nuevo.
 */
import type { RadioOption } from "@myd-org/ui";
import { MAX_DIRECCIONES, type DireccionEnvio } from "./direcciones-envio";
import { TEXTOS_UBICACION, normalizarCp, type EleccionUbicacion } from "./ubicacion";

export interface LineasEnviarA {
  /** Retiro en un local: el header muestra el ícono de local. */
  retiro: boolean;
  /** Primera línea: "Enviar a {nombre}" / "Enviar a" / "Retirar en". */
  etiqueta: string;
  /** Segunda línea (se trunca en mobile). */
  valor: string;
}

export function lineasEnviarA(eleccion: EleccionUbicacion, nombrePila: string | null): LineasEnviarA {
  if (eleccion.tipo === "retiro") {
    return {
      retiro: true,
      etiqueta: TEXTOS_UBICACION.retirarEn,
      valor: eleccion.sucursal?.nombre ?? TEXTOS_UBICACION.elLocal,
    };
  }
  if (eleccion.tipo === "ninguna") {
    return { retiro: false, etiqueta: TEXTOS_UBICACION.enviarA, valor: TEXTOS_UBICACION.indiqueUbicacion };
  }
  const nombre = nombrePila?.trim();
  const etiqueta = nombre ? `${TEXTOS_UBICACION.enviarA} ${nombre}` : TEXTOS_UBICACION.enviarA;
  if (eleccion.direccion) return { retiro: false, etiqueta, valor: eleccion.direccion.calle };
  return {
    retiro: false,
    etiqueta,
    valor: eleccion.cp ? `${eleccion.localidad} (${eleccion.cp})` : eleccion.localidad,
  };
}

const PREFIJO_DIR = "dir:";
const PREFIJO_LOCAL = "local:";

export const opcionDireccion = (id: string) => `${PREFIJO_DIR}${id}`;
export const opcionLocal = (slug: string | null) => `${PREFIJO_LOCAL}${slug ?? ""}`;

/** Valor del radio que corresponde a la elección vigente (si es una opción de la lista). */
export function opcionVigente(eleccion: EleccionUbicacion): string | undefined {
  if (eleccion.tipo === "retiro") return opcionLocal(eleccion.sucursal?.slug ?? null);
  if (eleccion.tipo === "envio" && eleccion.direccion) return opcionDireccion(eleccion.direccion.id);
  return undefined;
}

export type CuerpoEleccion = { direccionId: string } | { tipo: "retiro"; sucursal?: string } | { id: string; cp: string };

export function cuerpoDeOpcion(valor: string): CuerpoEleccion | null {
  if (valor.startsWith(PREFIJO_DIR)) {
    const id = valor.slice(PREFIJO_DIR.length);
    return id ? { direccionId: id } : null;
  }
  if (valor.startsWith(PREFIJO_LOCAL)) {
    const slug = valor.slice(PREFIJO_LOCAL.length);
    return slug ? { tipo: "retiro", sucursal: slug } : { tipo: "retiro" };
  }
  return null;
}

export function opcionesDirecciones(
  direcciones: DireccionEnvio[],
  vigenteId: string | undefined,
  onEditar: (d: DireccionEnvio) => void,
): RadioOption[] {
  return direcciones.map((d) => {
    const description = [d.etiqueta, d.ciudad, d.cp ? `CP ${d.cp}` : ""].filter(Boolean).join(" · ");
    return {
      value: opcionDireccion(d.id),
      label: d.calle,
      ...(description ? { description } : {}),
      ...(d.id === vigenteId ? { badge: { label: TEXTOS_UBICACION.actual } } : {}),
      action: {
        label: TEXTOS_UBICACION.editar,
        ariaLabel: `${TEXTOS_UBICACION.editar} ${d.calle}`,
        onClick: () => onEditar(d),
      },
    };
  });
}

export interface LocalRetiro {
  slug: string;
  nombre: string;
  direccion: string;
  horario: string;
}

export interface OpcionesRetiro {
  locales: LocalRetiro[];
  /** Flag `sucursales` apagado: un único "Retirar en el local", sin dirección ni horario. */
  unico: boolean;
}

export function opcionesLocales(o: OpcionesRetiro): RadioOption[] {
  if (o.unico) return [{ value: opcionLocal(null), label: TEXTOS_UBICACION.retirarEnElLocal }];
  return o.locales.map((l) => {
    const description = [l.direccion, l.horario].filter(Boolean).join(" · ");
    return { value: opcionLocal(l.slug), label: l.nombre, ...(description ? { description } : {}) };
  });
}

export const puedeAgregarDireccion = (direcciones: DireccionEnvio[]) => direcciones.length < MAX_DIRECCIONES;

/** Id de la dirección recién creada: la que no estaba en la lista anterior. */
export function idNuevo(antes: DireccionEnvio[], despues: DireccionEnvio[]): string | null {
  const previos = new Set(antes.map((d) => d.id));
  return despues.find((d) => !previos.has(d.id))?.id ?? null;
}

/** Sin sesión: localidad de Georef + código postal obligatorio, validado antes de enviar. */
export function cuerpoLocalidad(
  id: string | null,
  cp: string,
):
  | { ok: true; cuerpo: { id: string; cp: string } }
  | { ok: false; campo: "localidad" | "cp"; error: string } {
  if (!id) return { ok: false, campo: "localidad", error: TEXTOS_UBICACION.elegirLocalidad };
  if (!cp.trim()) return { ok: false, campo: "cp", error: TEXTOS_UBICACION.cpRequerido };
  const n = normalizarCp(cp);
  if (!n) return { ok: false, campo: "cp", error: TEXTOS_UBICACION.cpInvalido };
  return { ok: true, cuerpo: { id, cp: n } };
}

const esAbort = (err: unknown, signal: AbortSignal) => signal.aborted || (err as Error)?.name === "AbortError";

export type CargaDirecciones = { estado: "ok"; direcciones: DireccionEnvio[] } | { estado: "sinSesion" } | { estado: "error" };

/** GET de las direcciones guardadas. 401 = sin sesión. null si se abortó (modal cerrado). */
export async function cargarDirecciones(f: typeof fetch, signal: AbortSignal): Promise<CargaDirecciones | null> {
  try {
    const res = await f("/api/mi-cuenta/direcciones", { signal });
    if (res.status === 401) return { estado: "sinSesion" };
    const data = (await res.json().catch(() => null)) as { direcciones?: unknown } | null;
    if (!res.ok || !Array.isArray(data?.direcciones)) return { estado: "error" };
    return { estado: "ok", direcciones: data.direcciones as DireccionEnvio[] };
  } catch (err) {
    return esAbort(err, signal) ? null : { estado: "error" };
  }
}

/** GET de los locales de retiro. null si falla o se abortó. */
export async function cargarLocales(f: typeof fetch, signal: AbortSignal): Promise<OpcionesRetiro | null> {
  try {
    const res = await f("/api/ubicacion/opciones", { signal });
    const data = (await res.json().catch(() => null)) as Partial<OpcionesRetiro> | null;
    if (!res.ok || !data || !Array.isArray(data.locales)) return null;
    return { locales: data.locales, unico: Boolean(data.unico) };
  } catch {
    return null;
  }
}

/** POST /api/ubicacion. El error del API (en usted) se muestra tal cual. */
export async function guardarEleccion(
  f: typeof fetch,
  cuerpo: CuerpoEleccion,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await f("/api/ubicacion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return { ok: false, error: typeof data?.error === "string" ? data.error : TEXTOS_UBICACION.errorGuardar };
  } catch {
    return { ok: false, error: TEXTOS_UBICACION.errorGuardar };
  }
}
