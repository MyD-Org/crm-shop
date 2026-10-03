// Avisos NO bloqueantes de un medio de pago con lista de precios (change
// `listas-por-medio-de-pago`). Función pura: el repo calcula los conjuntos y acá se arman los
// textos. Todo en usted. Nunca impiden guardar.

export interface MedioParaAvisos {
  nombre: string
  activo: boolean
  idListaPrecios: string | null
  listaPreciosNombre: string | null
  destacarEnCatalogo: boolean
  mostrarEnFicha: boolean
}

export interface ContextoAvisos {
  /** Ids de las listas que hoy existen en la cuenta principal de Alegra. */
  listasExistentes: ReadonlySet<string>
  /** Ids de listas que, en general, cuestan más que la lista por defecto. */
  listasMasCaras: ReadonlySet<string>
}

export function avisosDeMedio(m: MedioParaAvisos, ctx: ContextoAvisos): string[] {
  const avisos: string[] = []
  const nombreLista = m.listaPreciosNombre ?? "enlazada"
  const huerfana = m.idListaPrecios !== null && !ctx.listasExistentes.has(m.idListaPrecios)

  if (huerfana) {
    avisos.push(`La lista "${nombreLista}" ya no existe en Alegra. Este medio usa la lista por defecto hasta que seleccione otra.`)
  } else if (m.idListaPrecios !== null && ctx.listasMasCaras.has(m.idListaPrecios)) {
    avisos.push(
      `La lista "${nombreLista}" es, en general, más cara que la lista por defecto: sólo se aplica en los productos donde cuesta menos.`,
    )
  }

  const motivo = !m.activo
    ? "el medio está inactivo"
    : m.idListaPrecios === null || huerfana
      ? "el medio no tiene una lista de precios enlazada"
      : null
  if (motivo) {
    if (m.destacarEnCatalogo) avisos.push(`No se mostrará "con ${m.nombre}" en el catálogo: ${motivo}.`)
    if (m.mostrarEnFicha) avisos.push(`No aparecerá en la ficha del producto: ${motivo}.`)
  }
  return avisos
}
