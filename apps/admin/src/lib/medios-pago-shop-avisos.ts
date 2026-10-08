// Avisos NO bloqueantes de un medio de pago con lista de precio online. Función pura: el repo
// calcula los conjuntos y acá se arman los textos. Todo en usted. Nunca impiden guardar.

import { SLUG_MERCADOPAGO } from "@/lib/medios-pago-shop-validacion"
import type { InteresMPCuenta } from "@/lib/mercadopago-planes-aviso"

export interface MedioParaAvisos {
  /** Identificador del medio; sólo se usa para los avisos de cobro en línea. */
  slug?: string
  nombre: string
  activo: boolean
  listaOnlineId: string | null
  listaOnlineNombre: string | null
  listaOnlineActiva: boolean
  destacarEnCatalogo: boolean
  mostrarEnFicha: boolean
  /** Ausente = público. */
  audiencia?: "publico" | "cuenta_corriente"
  /** Cuotas sin interés configuradas; sólo se usan para comparar con lo que Mercado Pago cobra con interés. */
  condicionesCuotas?: readonly { cuotas: number }[]
}

export interface ContextoAvisos {
  /** Ids de listas online que, en general, cuestan más que la lista de referencia. */
  listasMasCaras: ReadonlySet<string>
  /** Cuotas con interés en Mercado Pago por cuenta y marca. Ausente = no se pudo consultar: sin aviso. */
  interesMP?: readonly InteresMPCuenta[]
}

const lista = (xs: readonly (string | number)[]): string =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`

/**
 * Cuotas que la tienda ofrece "sin interés" pero que Mercado Pago cobra CON interés al cliente en
 * alguna marca principal: si no se marcan sin interés en el panel de Mercado Pago, el cliente paga el
 * interés encima del precio de la lista. Un aviso por cuenta y por grupo de marcas afectadas.
 */
function avisosDeInteresMP(cuotasConfiguradas: readonly number[], cuentas: readonly InteresMPCuenta[]): string[] {
  const avisos: string[] = []
  for (const cuenta of cuentas) {
    const porMarcas = new Map<string, { marcas: string[]; cuotas: number[] }>()
    for (const n of [...new Set(cuotasConfiguradas)].sort((a, b) => a - b)) {
      const marcas = cuenta.marcas.filter((m) => m.cuotasConInteres.has(n)).map((m) => m.nombre)
      if (marcas.length === 0) continue
      const clave = marcas.join("|")
      const grupo = porMarcas.get(clave) ?? { marcas, cuotas: [] }
      grupo.cuotas.push(n)
      porMarcas.set(clave, grupo)
    }
    const donde = cuenta.cuentaId === "principal" ? "En Mercado Pago" : `En la cuenta «${cuenta.cuentaId}» de Mercado Pago`
    for (const { marcas, cuotas } of porMarcas.values()) {
      avisos.push(
        `${donde}, ${lista(cuotas)} cuotas tienen interés con ${lista(marcas)}. Márquelas sin interés en el panel de Mercado Pago o el cliente pagará interés encima.`,
      )
    }
  }
  return avisos
}

export function avisosDeMedio(m: MedioParaAvisos, ctx: ContextoAvisos): string[] {
  const avisos: string[] = []
  // El admin no ve las credenciales de la tienda: sólo puede recordar que el medio las necesita.
  if (m.slug === "payway" && m.activo) {
    avisos.push(
      "Payway solo se ofrece en la tienda si las credenciales de Payway están cargadas. Sin ellas, este medio no aparece en el checkout aunque esté activo.",
    )
  }
  if (m.slug === SLUG_MERCADOPAGO && m.activo && ctx.interesMP && m.condicionesCuotas?.length) {
    avisos.push(...avisosDeInteresMP(m.condicionesCuotas.map((c) => c.cuotas), ctx.interesMP))
  }
  if (m.audiencia === "cuenta_corriente") {
    // Lo usan solo las cuentas corrientes: no entra en "con medio", ficha ni listas por medio.
    if (!m.activo) avisos.push("Con este medio inactivo, los pedidos de las cuentas corrientes quedarán a coordinar.")
    if (m.listaOnlineId !== null) avisos.push("Este medio es solo para cuentas corrientes: la lista enlazada no se usa.")
    return avisos
  }
  const nombreLista = m.listaOnlineNombre ?? "enlazada"
  const sinLista = m.listaOnlineId === null || !m.listaOnlineActiva

  if (m.listaOnlineId !== null && !m.listaOnlineActiva) {
    avisos.push(`La lista "${nombreLista}" está desactivada. Este medio usa la lista de referencia hasta que la active o seleccione otra.`)
  } else if (m.listaOnlineId !== null && ctx.listasMasCaras.has(m.listaOnlineId)) {
    avisos.push(
      `La lista "${nombreLista}" es, en general, más cara que la lista de referencia: sólo se aplica en los productos donde cuesta menos.`,
    )
  }

  const motivo = !m.activo
    ? "el medio está inactivo"
    : sinLista
      ? "el medio no tiene una lista de precios enlazada"
      : null
  if (motivo) {
    if (m.destacarEnCatalogo) avisos.push(`No se mostrará "con ${m.nombre}" en el catálogo: ${motivo}.`)
    if (m.mostrarEnFicha) avisos.push(`No aparecerá en la ficha del producto: ${motivo}.`)
  }
  return avisos
}
