import { ErrorCompras } from "./compras-dinero"
import type { CompraCompleta, CompraFila } from "./compras-repo"

// Helpers HTTP de las rutas de Compras (change `compras-en-transito`): respuestas sin caché,
// errores `{error, code}` en usted y DTOs sin datos internos (idempotencia, snapshot).

export const NO_STORE = { "Cache-Control": "private, no-store" }

export const fail = (status: number, code: string, error: string) =>
  Response.json({ error, code }, { status, headers: NO_STORE })

export const ok = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE })

const STATUS_POR_CODIGO: Record<string, number> = {
  validacion: 400,
  confirmacion_requerida: 400,
  producto_existente: 409,
  item_inactivo: 409,
  no_encontrada: 404,
  cuenta_inexistente: 404,
  numero_duplicado: 409,
  no_modificable: 409,
  con_pagos: 409,
  desincronizada: 409,
  incierta: 409,
  no_aplicada: 409,
  estado_no_abierto: 409,
  modificada_en_alegra: 409,
  bill_ajena: 409,
  bill_borrada: 409,
  alegra_rechazo: 422,
}

/** ErrorCompras -> respuesta; cualquier otro error -> 500 genérico (el detalle va al log). */
export function responderError(err: unknown, contexto: Record<string, unknown> = {}): Response {
  if (err instanceof ErrorCompras) {
    return fail(STATUS_POR_CODIGO[err.codigo] ?? 422, err.codigo, err.message)
  }
  console.error("[admin/compras] error inesperado", { ...contexto, err })
  return fail(500, "internal", "No se pudo completar la operación. Inténtelo nuevamente.")
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const esUuid = (s: string) => UUID.test(s)

export function toCompraListaDto(c: CompraFila) {
  return {
    id: c.id,
    cuentaId: c.cuentaId,
    proveedorNombre: c.proveedorNombre,
    numeroFactura: c.numeroFactura,
    fecha: c.fecha,
    vencimiento: c.vencimiento,
    estado: c.estado,
    totalCentavos: c.totalCentavos,
    createdAt: c.createdAt.toISOString(),
  }
}

export function toCompraDetalleDto(c: CompraCompleta) {
  return {
    ...toCompraListaDto(c),
    proveedorAlegraId: c.proveedorAlegraId,
    proveedorCuit: c.proveedorCuit,
    observaciones: c.observaciones,
    almacenId: c.almacenId,
    desincronizada: c.desincronizada,
    alegraBillId: c.alegraBillId,
    netoCentavos: c.netoCentavos,
    ivaCentavos: c.ivaCentavos,
    percepcionesCentavos: c.percepcionesCentavos,
    items: c.items.map((i) => ({
      id: i.id,
      alegraId: i.alegraId,
      codigo: i.codigo,
      nombre: i.nombre,
      cantidadPedida: i.cantidadPedida,
      cantidadRecibida: i.cantidadRecibida,
      costoUnitarioCentavos: i.costoUnitarioCentavos,
      ivaPorcentaje: i.ivaPorcentaje,
    })),
    percepciones: c.percepcionesDetalle.map((p) => ({
      nombre: p.nombre,
      importeCentavos: p.importeCentavos,
      numeroCertificado: p.numeroCertificado,
    })),
    recepciones: c.recepciones.length,
  }
}
