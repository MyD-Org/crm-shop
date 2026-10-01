import { cargarContextoCuentaFactura, configDeCuentaRow, resolverParaPedido, MSG_SIN_CUENTA_FACTURA } from "./pedido-factura-cuenta-repo"
import type { PedidoRow } from "./pedidos-repo"
import { getTenantByIdFromDb, type TenantConfig } from "./tenants"

// Cuenta de Alegra de un pedido para TODO lo que lee o vincula documentos ya existentes (vincular
// factura, reenviar el mail con el PDF, vincular remito, ver el PDF del remito). Es la misma
// resolución que usa "Emitir factura": la cuenta con la que se emitió la factura (si quedó
// registrada), o la elegida/calculada del pedido (sucursal que despacha o que fuerza la zona).
// Nunca se cae a la principal en silencio: buscar el número en otra cuenta da "no encontrada" o,
// peor, devuelve la factura de otro cliente.

const MSG_SIN_CONFIG = "No se pudo consultar Alegra para esta empresa. Inténtelo nuevamente en unos minutos."

export type ConfigAlegraPedido =
  | { ok: true; config: TenantConfig; cuentaSlug: string }
  | { ok: false; status: number; code: string; error: string }

export async function configAlegraDelPedido(tenantId: string, pedido: Pick<PedidoRow, "id" | "sucursal" | "sucursalRegla">): Promise<ConfigAlegraPedido> {
  const base = await getTenantByIdFromDb(tenantId)
  if (!base) {
    console.error(`[pedido-cuenta-alegra] sin config para tenant "${tenantId}"`)
    return { ok: false, status: 500, code: "internal", error: MSG_SIN_CONFIG }
  }
  const ctx = await cargarContextoCuentaFactura(tenantId, pedido.id)
  const deLaFactura = ctx.fila?.facturaCuentaId ? ctx.cuentas.find((c) => c.id === ctx.fila?.facturaCuentaId) : undefined
  const cuenta = deLaFactura ?? resolverParaPedido(pedido, ctx).cuenta
  if (!cuenta) return { ok: false, status: 422, code: "sin_cuenta", error: MSG_SIN_CUENTA_FACTURA }
  try {
    return { ok: true, config: configDeCuentaRow(base, cuenta), cuentaSlug: cuenta.slug }
  } catch (err) {
    return { ok: false, status: 422, code: "cuenta_sin_credenciales", error: err instanceof Error ? err.message : MSG_SIN_CONFIG }
  }
}
