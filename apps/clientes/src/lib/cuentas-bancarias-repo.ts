/**
 * Lectura de las cuentas bancarias del CRM (`public.cuentas_bancarias_shop`, migración 0055 del
 * CRM). SOLO servidor.
 *
 * La tabla la crea una migración del CRM que puede no estar aplicada todavía: la lectura que se usa
 * dentro de la transacción de `crearPedido` TOLERA que no exista (o que falte el permiso) y
 * devuelve `[]`, que se interpreta como "sin cuenta aplicable". Va en un savepoint: un error de
 * lectura dentro de una transacción de Postgres la aborta entera, y eso tumbaría el pedido.
 *
 * Trae TODAS las filas del tenant (activas o no): el filtro por activa, sucursal y monto es puro
 * (`resolverCuenta`).
 */
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { crmCuentasBancariasShop } from "@/db/crm";
import { shopTenantId } from "./tenant";
import type { CuentaBancaria } from "./cuentas-bancarias";

type Ejecutor = Pick<ReturnType<typeof getDb>, "select">;
type EjecutorTx = Pick<ReturnType<typeof getDb>, "select" | "transaction">;

const aNumero = (v: string | null): number | null => (v === null ? null : Number(v));

/** Lectura que TIRA si la tabla no existe. La usa la lectura cacheada (que elige su perfil de caché). */
export async function leerCuentasBancarias(db: Ejecutor = getDb()): Promise<CuentaBancaria[]> {
  const filas = await db
    .select({
      id: crmCuentasBancariasShop.id,
      alias: crmCuentasBancariasShop.alias,
      cbu: crmCuentasBancariasShop.cbu,
      banco: crmCuentasBancariasShop.banco,
      titular: crmCuentasBancariasShop.titular,
      cuit: crmCuentasBancariasShop.cuit,
      todasLasSucursales: crmCuentasBancariasShop.todasLasSucursales,
      sucursalSlugs: crmCuentasBancariasShop.sucursalSlugs,
      montoMin: crmCuentasBancariasShop.montoMin,
      montoMax: crmCuentasBancariasShop.montoMax,
      activa: crmCuentasBancariasShop.activa,
      predeterminada: crmCuentasBancariasShop.predeterminada,
      orden: crmCuentasBancariasShop.orden,
    })
    .from(crmCuentasBancariasShop)
    .where(eq(crmCuentasBancariasShop.tenantId, shopTenantId()))
    .orderBy(asc(crmCuentasBancariasShop.orden), asc(crmCuentasBancariasShop.alias));
  return filas.map((f) => ({
    ...f,
    montoMin: aNumero(f.montoMin),
    montoMax: aNumero(f.montoMax),
  }));
}

/** Lectura fresca dentro de una transacción: tabla ausente o sin permiso = `[]`, sin abortarla. */
export async function leerCuentasBancariasEnTx(tx: EjecutorTx): Promise<CuentaBancaria[]> {
  try {
    return await tx.transaction((sp) => leerCuentasBancarias(sp));
  } catch (err) {
    console.warn(
      "[cuentas-bancarias] no se pudieron leer las cuentas del CRM; el pedido queda sin cuenta:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
