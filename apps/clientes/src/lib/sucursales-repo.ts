/**
 * Lectura SIN caché de sucursales y zonas del tenant, desde las tablas del CRM
 * (contrato en src/db/crm.ts). Es la que usan las decisiones que escriben un
 * pedido (dentro de la transacción): lo cacheado sirve para mostrar, no para
 * decidir. `sucursales-datos.ts` la envuelve con caché para el selector de zona.
 */
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  crmMetodosEnvio,
  crmMetodosEnvioEntradas,
  crmMetodosEnvioLocalidades,
  crmMetodosEnvioZonas,
  crmReglasVenta,
  crmSucursales,
  crmZonas,
} from "@/db/crm";
import { shopTenantId } from "./tenant";
import {
  CONFIG_DESPACHO_DEFAULT,
  type ConfigDespacho,
  type ReglasVenta,
  type SucursalDato,
  type ZonaDato,
} from "./sucursales";
import { CONFIG_ENVIO_DEFAULT, type ConfigEnvio } from "./envio";
import type { EntradaZona, LocalidadAtendida, ZonaEnvio } from "./envio-zona";
import { horarioEntregaDeConfig, type MetodoEnvioTienda } from "./envio-zona-tienda";
import type { Geometria } from "./geo-poligono";
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
  despacho: CONFIG_DESPACHO_DEFAULT,
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

type FilaMetodo = typeof crmMetodosEnvio.$inferSelect;
type FilaZona = typeof crmMetodosEnvioZonas.$inferSelect;
type FilaEntrada = typeof crmMetodosEnvioEntradas.$inferSelect;
type FilaLocalidad = typeof crmMetodosEnvioLocalidades.$inferSelect;

const numeroONull = (v: string | null): number | null => {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "09:00:00" (columna `time`) -> "09:00". */
const horaCorte = (t: string): string => t.slice(0, 5);

/**
 * Filas del CRM -> métodos de envío para el módulo puro. Defensivo: una zona con geometría que no es
 * una lista se toma sin dibujo (vive de sus entradas), nunca rompe el cálculo; los números que llegan
 * como string (`numeric`) se convierten. Los métodos de un tipo desconocido se descartan (el CHECK del
 * CRM hoy sólo admite `tarifa_zona`; un tipo futuro que este código no entiende no se inventa).
 */
export function armarMetodosEnvio(
  metodos: FilaMetodo[],
  zonas: FilaZona[],
  entradas: FilaEntrada[],
  localidades: FilaLocalidad[],
): MetodoEnvioTienda[] {
  return metodos
    .filter((m) => m.tipo === "tarifa_zona")
    .map((m): MetodoEnvioTienda => {
      const zonasDelMetodo = zonas
        .filter((z) => z.metodoId === m.id)
        .map((z): ZonaEnvio => ({
          id: z.id,
          nombre: z.nombre,
          precio: Number(z.precio),
          orden: z.orden,
          activa: z.activa,
          geometria: (Array.isArray(z.geometria) ? z.geometria : []) as Geometria,
          entradas: entradas
            .filter((e) => e.zonaId === z.id)
            .map((e): EntradaZona => ({
              tipo: e.tipo === "cp" ? "cp" : "georef",
              valor: e.valor,
              etiqueta: e.etiqueta,
              nombreNorm: e.nombreNorm,
            })),
        }));
      const locs = localidades
        .filter((l) => l.metodoId === m.id)
        .map((l): LocalidadAtendida => {
          const sur = numeroONull(l.bboxSur);
          const oeste = numeroONull(l.bboxOeste);
          const norte = numeroONull(l.bboxNorte);
          const este = numeroONull(l.bboxEste);
          const lat = numeroONull(l.centroLat);
          const lon = numeroONull(l.centroLon);
          return {
            georefId: l.georefId,
            etiqueta: l.etiqueta,
            nombreNorm: l.nombreNorm,
            abreviaturas: l.abreviaturas,
            centro: lat !== null && lon !== null ? { lat, lon } : null,
            bbox: sur !== null && oeste !== null && norte !== null && este !== null ? { sur, oeste, norte, este } : null,
          };
        });
      return {
        id: m.id,
        slug: m.slug,
        nombre: m.nombre,
        tipo: "tarifa_zona",
        activo: m.activo,
        orden: m.orden,
        provinciaClave: m.provinciaClave,
        sucursalOrigen: m.sucursalOrigen,
        diasOperativos: m.diasOperativos,
        horaCorte: horaCorte(m.horaCorte),
        margenMin: m.margenMin,
        promesa: m.promesa,
        avisoFeriados: m.avisoFeriados,
        gratisAplica: m.gratisAplica,
        itemAlegraId: m.itemAlegraId,
        itemAlegraIva: Number(m.itemAlegraIva),
        zonas: zonasDelMetodo,
        localidades: locs,
        // `config.horarioEntrega` del CRM (change `envio-rapido`); sin horario no se agrega la clave.
        ...(horarioEntregaDeConfig(m.config) ? { horarioEntrega: horarioEntregaDeConfig(m.config) } : {}),
      };
    });
}

/**
 * Métodos de envío por zona del tenant (`public.metodos_envio*`, migración 0101 del CRM), SIN caché.
 * Cuatro SELECT (los métodos y, sólo si hay, sus zonas, entradas y localidades). Solo se llama con el
 * flag `envio-por-zona` prendido. Si la lectura falla (migración sin aplicar, base caída) devuelve `[]`:
 * el envío queda a coordinar, nunca un precio inventado.
 */
export async function leerMetodosEnvio(db?: Ejecutor): Promise<MetodoEnvioTienda[]> {
  try {
    const ejecutor = db ?? getDb();
    const metodos = await ejecutor.select().from(crmMetodosEnvio).where(eq(crmMetodosEnvio.tenantId, shopTenantId()));
    if (metodos.length === 0) return [];
    const ids = metodos.map((m) => m.id);
    const [zonas, entradas, localidades] = await Promise.all([
      ejecutor.select().from(crmMetodosEnvioZonas).where(inArray(crmMetodosEnvioZonas.metodoId, ids)),
      ejecutor.select().from(crmMetodosEnvioEntradas).where(inArray(crmMetodosEnvioEntradas.metodoId, ids)),
      ejecutor.select().from(crmMetodosEnvioLocalidades).where(inArray(crmMetodosEnvioLocalidades.metodoId, ids)),
    ]);
    return armarMetodosEnvio(metodos, zonas, entradas, localidades);
  } catch (err) {
    console.error("[sucursales-repo] no se pudieron leer los métodos de envío:", err);
    return [];
  }
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
export async function leerConfigEnvio(db?: Ejecutor, opts: { conMetodos?: boolean } = {}): Promise<ConfigEnvio> {
  const config = await leerConfigEnvioTienda(db);
  // `metodos` sólo viaja con el flag `envio-por-zona` prendido (lo decide quien llama: acá no se
  // evalúa el flag, porque esta función también corre dentro de scopes cacheados). Apagado = igual que
  // siempre, sin tocar las tablas nuevas.
  return opts.conMetodos ? { ...config, metodos: await leerMetodosEnvio(db) } : config;
}

async function leerConfigEnvioTienda(db?: Ejecutor): Promise<ConfigEnvio> {
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

/**
 * Plazo de despacho del tenant (`reglas_venta.despacho_*`, migración 0093 del CRM). Sólo para
 * MOSTRAR (ficha, carrito, checkout): ningún pedido depende de él.
 *
 * Consulta propia, como `leerConfigEnvio`: si la migración del CRM todavía no está aplicada (o la
 * base falla) devuelve el default, que es lo que el Shop mostraba antes. Un valor fuera de rango
 * (el CHECK del CRM lo impide) también cae al default.
 */
export async function leerConfigDespacho(db?: Ejecutor): Promise<ConfigDespacho> {
  try {
    const [fila] = await (db ?? getDb())
      .select({
        visible: crmReglasVenta.despachoVisible,
        diasHabiles: crmReglasVenta.despachoDiasHabiles,
      })
      .from(crmReglasVenta)
      .where(eq(crmReglasVenta.tenantId, shopTenantId()))
      .limit(1);
    if (!fila) return CONFIG_DESPACHO_DEFAULT;
    const dias = Number.isInteger(fila.diasHabiles) && fila.diasHabiles >= 1 ? fila.diasHabiles : CONFIG_DESPACHO_DEFAULT.diasHabiles;
    return { visible: fila.visible, diasHabiles: dias };
  } catch (err) {
    console.error("[sucursales-repo] no se pudo leer el plazo de despacho:", err);
    return CONFIG_DESPACHO_DEFAULT;
  }
}
