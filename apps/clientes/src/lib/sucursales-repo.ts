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

/** Sucursal tal como se muestra: lo de `SucursalDato` más lo que ve el visitante. */
export interface SucursalVista extends SucursalDato {
  nombre: string;
  ciudad: string;
  provincia: string;
  direccion: string;
  horario: string;
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
  return { sucursales, zonas };
}

/** Reglas de venta del tenant tal como las guarda el CRM (`public.reglas_venta`). */
export interface ReglasVentaTenant extends ReglasVenta {
  respaldoEnvio: boolean;
  retiroSinStock: "bloquear" | "ofrecer";
  /** Días que dura la reserva de un pedido sin cobro online; 0 = nunca vence. */
  reservaDias: number;
  avisoSinContactarHoras: number;
  contactoHorasHabiles: number;
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
  return fila ?? REGLAS_VENTA_DEFAULT;
}
