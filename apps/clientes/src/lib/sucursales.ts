/**
 * Zona y asignación de sucursal (change `sucursales-igz-mdp`, rebanada A).
 *
 * Módulo PURO a propósito (patrón de `envio.ts`): no importa la DB, el reloj ni Next. Recibe las
 * reglas como DATOS (leídas de `public.sucursales` / `public.zonas` por el contrato CRM -> Shop) y
 * devuelve la sucursal y la regla que se congela en el pedido. Mismas reglas + misma entrada =
 * mismo resultado, siempre.
 *
 * El CRM tiene una copia de estas funciones (`apps/admin`; no hay workspaces) y las dos ejecutan el
 * MISMO fixture (`__fixtures__/sucursales-casos.json`). Si cambia una, cambia la otra.
 *
 * En la rebanada A sólo hay retiro y envío por zona; el respaldo por stock llega en la B.
 */
import { provinciaCanonica } from "./provincias";

/** Compara textos sin acentos, mayúsculas, espacios ni signos (misma normalización que `envio.ts`). */
function claveTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Clave de zona de una provincia tal como llega (perfil, formulario, cookie): la de su nombre
 * canónico (`provincias.ts` tolera acentos, "CABA", "Provincia de ..."). Un texto que no es una
 * jurisdicción da "" y cae en la sucursal predeterminada. Es la que se guarda en
 * `zonas.provincia_clave`.
 */
export function claveProvincia(provincia: string | null | undefined): string {
  const canonica = provinciaCanonica(provincia);
  return canonica ? claveTexto(canonica) : "";
}

/** Lo que estas funciones necesitan de una sucursal (subconjunto de `crmSucursales`). */
export interface SucursalDato {
  slug: string;
  aceptaRetiro: boolean;
  aceptaEnvio: boolean;
  /** Vacía = toda la zona; con ciudades = sólo esas. */
  envioCiudades: string[];
  orden: number;
  activa: boolean;
  predeterminada: boolean;
}

/** Lo que necesitan de una zona (subconjunto de `crmZonas`). */
export interface ZonaDato {
  id: string;
  provinciaClave: string;
  sucursal: string;
  facturaSucursal: string | null;
}

export type MotivoRegla = "zona" | "predeterminada" | "fallback_inactiva" | "retiro_local";

/**
 * La regla aplicada, tal como se congela en `orders.sucursal_regla`. `v` versiona la forma:
 * si cambia, un pedido viejo se sigue leyendo por su versión.
 */
export interface ReglaAplicada {
  v: 1;
  /** Identificador legible: `zona:misiones`, `zona:default`, `zona:fallback_inactiva`, `retiro:<slug>`. */
  regla: string;
  motivo: MotivoRegla;
  /** Clave de la provincia evaluada; null en el retiro (no depende de la zona). */
  provincia: string | null;
  zonaId: string | null;
  /** Sucursal que dicta la zona (en el retiro, la del local elegido). */
  sucursalZona: string;
  /** Cuenta que factura si la zona lo fuerza (`zonas.factura_sucursal`); null = la de despacho. */
  facturaSucursal: string | null;
  /** Líneas que se traen de otra sucursal (rebanada B); vacío en la A. */
  lineasATraer: string[];
}

export interface ResolucionZona {
  sucursal: string;
  zonaId: string | null;
  motivo: Exclude<MotivoRegla, "retiro_local">;
  regla: string;
}

export type ErrorSucursal = "sin_sucursal_activa" | "sin_retiro" | "sin_envio";

const activas = (sucursales: SucursalDato[]) =>
  sucursales.filter((s) => s.activa).sort((a, b) => a.orden - b.orden || a.slug.localeCompare(b.slug));

/**
 * Sucursal de respaldo cuando la de la zona no sirve: la predeterminada activa; si tampoco, la
 * primera activa por `orden`; si no hay ninguna activa, null (el llamador falla explícito).
 */
function sucursalDeRespaldo(sucursales: SucursalDato[]): SucursalDato | null {
  const vivas = activas(sucursales);
  return vivas.find((s) => s.predeterminada) ?? vivas[0] ?? null;
}

/**
 * Sucursal que atiende una provincia. Sin zona para esa provincia = la predeterminada. Zona que
 * apunta a una sucursal inactiva = respaldo (`zona:fallback_inactiva`). Sin ninguna sucursal
 * activa NO asigna en silencio: devuelve `sin_sucursal_activa`.
 */
export function resolverZona(
  provincia: string | null | undefined,
  zonas: ZonaDato[],
  sucursales: SucursalDato[],
): ResolucionZona | { error: "sin_sucursal_activa" } {
  const clave = claveProvincia(provincia);
  const zona = clave ? zonas.find((z) => z.provinciaClave === clave) : undefined;

  if (zona) {
    const destino = sucursales.find((s) => s.slug === zona.sucursal);
    if (destino?.activa) {
      return { sucursal: destino.slug, zonaId: zona.id, motivo: "zona", regla: `zona:${clave}` };
    }
    const respaldo = sucursalDeRespaldo(sucursales);
    if (!respaldo) return { error: "sin_sucursal_activa" };
    return {
      sucursal: respaldo.slug,
      zonaId: zona.id,
      motivo: "fallback_inactiva",
      regla: "zona:fallback_inactiva",
    };
  }

  const predeterminada = sucursalDeRespaldo(sucursales);
  if (!predeterminada) return { error: "sin_sucursal_activa" };
  // Si la predeterminada no está activa y se cayó a otra, también es un respaldo por inactividad.
  const esLaPredeterminada = predeterminada.predeterminada;
  return {
    sucursal: predeterminada.slug,
    zonaId: null,
    motivo: esLaPredeterminada ? "predeterminada" : "fallback_inactiva",
    regla: esLaPredeterminada ? "zona:default" : "zona:fallback_inactiva",
  };
}

export interface EntradaAsignacion {
  entregaTipo: "retiro" | "envio";
  /** Provincia de entrega (envío). Se normaliza; el retiro la ignora. */
  provincia?: string | null;
  /** Ciudad de entrega (envío): se valida contra `envioCiudades` de la sucursal si tiene lista. */
  ciudad?: string | null;
  /** Slug del local elegido (retiro). */
  sucursalRetiro?: string | null;
}

export interface Asignacion {
  sucursal: string;
  regla: ReglaAplicada;
}

/**
 * Asigna la sucursal del pedido.
 *
 * - Retiro: la del local elegido. Debe existir, estar activa y aceptar retiro; la zona NO cuenta.
 * - Envío: la de la zona de la provincia de entrega. Debe aceptar envío y, si tiene lista de
 *   ciudades, la ciudad de entrega tiene que estar en ella (sin ciudad, con lista: no hay envío).
 */
export function asignarSucursal(
  entrada: EntradaAsignacion,
  datos: { sucursales: SucursalDato[]; zonas: ZonaDato[] },
): Asignacion | { error: ErrorSucursal } {
  const { sucursales, zonas } = datos;

  if (entrada.entregaTipo === "retiro") {
    const local = sucursales.find((s) => s.slug === entrada.sucursalRetiro);
    if (!local || !local.activa || !local.aceptaRetiro) return { error: "sin_retiro" };
    return {
      sucursal: local.slug,
      regla: {
        v: 1,
        regla: `retiro:${local.slug}`,
        motivo: "retiro_local",
        provincia: null,
        zonaId: null,
        sucursalZona: local.slug,
        facturaSucursal: null,
        lineasATraer: [],
      },
    };
  }

  const zona = resolverZona(entrada.provincia, zonas, sucursales);
  if ("error" in zona) return zona;
  const destino = sucursales.find((s) => s.slug === zona.sucursal);
  if (!destino || !destino.aceptaEnvio) return { error: "sin_envio" };
  if (destino.envioCiudades.length > 0) {
    const ciudad = entrada.ciudad ? claveTexto(entrada.ciudad) : "";
    if (!ciudad || !destino.envioCiudades.some((c) => claveTexto(c) === ciudad)) {
      return { error: "sin_envio" };
    }
  }
  const zonaFila = zona.zonaId ? zonas.find((z) => z.id === zona.zonaId) : undefined;
  return {
    sucursal: destino.slug,
    regla: {
      v: 1,
      regla: zona.regla,
      motivo: zona.motivo,
      provincia: claveProvincia(entrada.provincia) || null,
      zonaId: zona.zonaId,
      sucursalZona: destino.slug,
      facturaSucursal: zonaFila?.facturaSucursal ?? null,
      lineasATraer: [],
    },
  };
}
