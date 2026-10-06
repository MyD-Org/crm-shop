// Avisos NO bloqueantes de un medio de pago con lista de precio online. Función pura: el repo
// calcula los conjuntos y acá se arman los textos. Todo en usted. Nunca impiden guardar.

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
}

export interface ContextoAvisos {
  /** Ids de listas online que, en general, cuestan más que la lista de referencia. */
  listasMasCaras: ReadonlySet<string>
}

export function avisosDeMedio(m: MedioParaAvisos, ctx: ContextoAvisos): string[] {
  const avisos: string[] = []
  // El admin no ve las credenciales de la tienda: sólo puede recordar que el medio las necesita.
  if (m.slug === "payway" && m.activo) {
    avisos.push(
      "Payway solo se ofrece en la tienda si las credenciales de Payway están cargadas. Sin ellas, este medio no aparece en el checkout aunque esté activo.",
    )
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
