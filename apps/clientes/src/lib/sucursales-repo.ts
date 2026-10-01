/**
 * Lectura SIN caché de sucursales y zonas del tenant, desde las tablas del CRM
 * (contrato en src/db/crm.ts). Es la que usan las decisiones que escriben un
 * pedido (dentro de la transacción): lo cacheado sirve para mostrar, no para
 * decidir. `sucursales-datos.ts` la envuelve con caché para el selector de zona.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmReglasVenta, crmSucursales, crmZonas } from "@/db/crm";
import { shopTenantId } from "./tenant";
import type { ReglasVenta, SucursalDato, ZonaDato } from "./sucursales";
import { CONFIG_ENVIO_DEFAULT, type ConfigEnvio } from "./envio";
import {
  normalizarExcepciones,
  normalizarSchedule,
  type ExcepcionHorario,
  type HorarioSemanal,
} from "./horario-agrupado";

/** Sucursal tal como se muestra: lo de `SucursalDato` más lo que ve el visitante. */
export interface SucursalVista extends SucursalDato {
  nombre: string;
  ciudad: string;
  provincia: string;
  direccion: string;
  /** Texto libre legado: sólo sirve de respaldo si no hay `schedule` (migración 0051). */
  horario: string;
  /** Horario semanal estructurado, ya normalizado (siete días; vacío = sin configurar). */
  schedule?: HorarioSemanal;
  /** Excepciones del horario, ya normalizadas. */
  excepciones?: ExcepcionHorario[];
  /** Para el popup "Ver local". */
  whatsapp?: string;
}

export interface DatosSucursales {
  sucursales: SucursalVista[];
  zonas: ZonaDato[];
}

/** Lo mínimo que hace falta de una conexión o transacción de drizzle. */
type Ejecutor = Pick<ReturnType<typeof getDb>, "select">;

export async function leerSucursalesYZonas(
  db: Ejecutor = getDb(),
): Promise<DatosSucursales> {
  const tenant = shopTenantId();
  const [sucursales, zonas] = await Promise.all([
    db
      .select({
        slug: crmSucursales.slug,
        nombre: crmSucursales.nombre,
        ciudad: crmSucursales.ciudad,
        provincia: crmSucursales.provincia,
        direccion: crmSucursales.direccion,
        horario: crmSucursales.horario,
        schedule: crmSucursales.schedule,
        scheduleExceptions: crmSucursales.scheduleExceptions,
        whatsapp: crmSucursales.whatsapp,
        aceptaRetiro: crmSucursales.aceptaRetiro,
        aceptaEnvio: crmSucursales.aceptaEnvio,
        envioCiudades: crmSucursales.envioCiudades,
        orden: crmSucursales.orden,
        activa: crmSucursales.activa,
        predeterminada: crmSucursales.predeterminada,
      })
      .from(crmSucursales)
      .where(eq(crmSucursales.tenantId, tenant)),
    db
      .select({
        id: crmZonas.id,
        provinciaClave: crmZonas.provinciaClave,
        sucursal: crmZonas.sucursal,
        facturaSucursal: crmZonas.facturaSucursal,
      })
      .from(crmZonas)
      .where(eq(crmZonas.tenantId, tenant)),
  ]);
  return {
    sucursales: sucursales.map(({ schedule, scheduleExceptions, ...resto }) => ({
      ...resto,
      schedule: normalizarSchedule(schedule),
      excepciones: normalizarExcepciones(scheduleExceptions),
    })),
    zonas,
  };
}

/** Reglas de venta del tenant tal como las guarda el CRM (`public.reglas_venta`). */
export interface ReglasVentaTenant extends ReglasVenta {
  respaldoEnvio: boolean;
  retiroSinStock: "bloquear" | "ofrecer";
  /** Días que dura la reserva de un pedido sin cobro online; 0 = nunca vence. */
  reservaDias: number;
  avisoSinContactarHoras: number;
  contactoHorasHabiles: number;
  /**
   * Envío a domicilio y envío gratis. NO sale de `leerReglasVenta` (ver `leerConfigEnvio`, que se
   * lee aparte): lo completa `reglasVentaCacheadas` para mostrar. Ausente = `CONFIG_ENVIO_DEFAULT`.
   */
  envio?: ConfigEnvio;
}

/**
 * Lo que rige si el tenant no tiene fila en `reglas_venta` (tenant nuevo): los mismos defaults que
 * la migración 0045 del CRM (sí, ofrecer, 7, 7, 24, 24).
 */
export const REGLAS_VENTA_DEFAULT: ReglasVentaTenant = {
  respaldoEnvio: true,
  retiroSinStock: "ofrecer",
  trasladoDias: 7,
  reservaDias: 7,
  avisoSinContactarHoras: 24,
  contactoHorasHabiles: 24,
  envio: CONFIG_ENVIO_DEFAULT,
};

/**
 * Lectura SIN caché de las reglas de venta del tenant. Las decisiones que escriben un pedido
 * (dentro de la transacción de `crearPedido`) usan ésta; `reglasVentaCacheadas` sirve para mostrar.
 */
export async function leerReglasVenta(db: Ejecutor = getDb()): Promise<ReglasVentaTenant> {
  const [fila] = await db
    .select({
      respaldoEnvio: crmReglasVenta.respaldoEnvio,
      retiroSinStock: crmReglasVenta.retiroSinStock,
      trasladoDias: crmReglasVenta.trasladoDias,
      reservaDias: crmReglasVenta.reservaDias,
      avisoSinContactarHoras: crmReglasVenta.avisoSinContactarHoras,
      contactoHorasHabiles: crmReglasVenta.contactoHorasHabiles,
    })
    .from(crmReglasVenta)
    .where(eq(crmReglasVenta.tenantId, shopTenantId()))
    .limit(1);
  // La config de envío NO va en este select (migración del CRM que puede faltar, y una consulta
  // fallida abortaría la transacción de `crearPedido`): se lee aparte con `leerConfigEnvio`.
  return fila ?? REGLAS_VENTA_DEFAULT;
}

/** Lo que se lee de `reglas_venta` para armar la config de envío (sin armar nada todavía). */
export interface FilaEnvio {
  envioDomicilioActivo: boolean;
  envioGratisActivo: boolean;
  envioGratisAlcance: "pais" | "provincias" | null;
  envioGratisProvincias: string[];
  envioGratisMinimoModo: "sin_minimo" | "desde" | null;
  /** numeric(12,2): llega como string. */
  envioGratisMinimo: string | null;
}

/**
 * Fila del CRM -> `ConfigEnvio`. Defensivo: `gratis` es null si el envío gratis está apagado o si
 * las columnas quedaron incompletas (sin alcance, sin modo, o modo `desde` sin monto válido). Nunca
 * interpreta un NULL como "todo el país" ni "sin mínimo".
 */
export function configEnvioDeFila(fila: FilaEnvio): ConfigEnvio {
  if (!fila.envioGratisActivo) return { domicilioActivo: fila.envioDomicilioActivo, gratis: null };
  const alcance = fila.envioGratisAlcance;
  const modo = fila.envioGratisMinimoModo;
  if (alcance !== "pais" && alcance !== "provincias") {
    return { domicilioActivo: fila.envioDomicilioActivo, gratis: null };
  }
  let minimo: number | null = null;
  if (modo === "desde") {
    const n = fila.envioGratisMinimo === null ? NaN : Number(fila.envioGratisMinimo);
    if (!Number.isFinite(n) || n <= 0) return { domicilioActivo: fila.envioDomicilioActivo, gratis: null };
    minimo = n;
  } else if (modo !== "sin_minimo") {
    return { domicilioActivo: fila.envioDomicilioActivo, gratis: null };
  }
  return {
    domicilioActivo: fila.envioDomicilioActivo,
    gratis: { alcance, provincias: alcance === "provincias" ? fila.envioGratisProvincias : [], minimo },
  };
}

/**
 * Lectura SIN caché de la configuración de envío del tenant (`reglas_venta.envio_*`). Es la que
 * usan cotizar y crear el pedido: la UI cacheada sólo muestra, el servidor decide.
 *
 * Va en su propia consulta, aparte de `leerReglasVenta` (mismo motivo que `mensaje_confirmacion`):
 * son columnas de una migración del CRM que puede no estar aplicada todavía en ese entorno, y
 * sumarlas al select rompería las reglas enteras. Si la lectura falla (columnas ausentes, base
 * caída) devuelve el default (domicilio activo, costo a coordinar, sin gratis): nunca promete
 * un envío gratis que no se pudo confirmar.
 */
export async function leerConfigEnvio(db?: Ejecutor): Promise<ConfigEnvio> {
  try {
    const [fila] = await (db ?? getDb())
      .select({
        envioDomicilioActivo: crmReglasVenta.envioDomicilioActivo,
        envioGratisActivo: crmReglasVenta.envioGratisActivo,
        envioGratisAlcance: crmReglasVenta.envioGratisAlcance,
        envioGratisProvincias: crmReglasVenta.envioGratisProvincias,
        envioGratisMinimoModo: crmReglasVenta.envioGratisMinimoModo,
        envioGratisMinimo: crmReglasVenta.envioGratisMinimo,
      })
      .from(crmReglasVenta)
      .where(eq(crmReglasVenta.tenantId, shopTenantId()))
      .limit(1);
    return fila ? configEnvioDeFila(fila) : CONFIG_ENVIO_DEFAULT;
  } catch (err) {
    console.error("[sucursales-repo] no se pudo leer la configuración de envío:", err);
    return CONFIG_ENVIO_DEFAULT;
  }
}
