// Textos y helpers de presentación del panel de precios online (change `listas-precio-online`,
// rebanada B). Todo texto visible va en español formal de USTED. Vive aparte para poder
// verificarlo con un test (precios-online-textos.test.ts) sin montar componentes.

import type { OrigenCoeficiente } from "@/lib/precios-online-grilla"

export const TEXTOS = {
  titulo: "Precios online",
  ayudaGeneral:
    "El precio de cada producto es su costo (sin impuestos) multiplicado por el coeficiente de cada lista. Los precios de las listas de Alegra no intervienen en el cálculo.",
  sinPendientes: "No hay productos pendientes.",
  alertas: {
    sinCosto: "Sin costo",
    sinPrecio: "Sin precio online",
    nuevos: "Nuevos sin revisar",
    retenidos: "Retenidos por variación de costo",
  },
  grilla: {
    buscar: "Buscar por código o nombre",
    marca: "Marca",
    categoria: "Categoría",
    todasCategorias: "Todas las categorías",
    sinCategoria: "Sin categoría",
    estado: "Estado",
    todosEstados: "Todos los estados",
    producto: "Producto",
    costo: "Costo",
    estadoCol: "Estado",
    sinResultados: "No hay productos que coincidan con los filtros indicados.",
    mostrarReferencia: "Mostrar listas de Alegra",
    referenciaTitulo: "Referencia Alegra (solo informativo)",
    referenciaAyuda: "Estos precios se muestran como referencia. No participan del cálculo.",
    anterior: "Anterior",
    siguiente: "Siguiente",
    cargando: "Cargando…",
    errorCarga: "No pudimos cargar los precios online.",
    sinListas: "Todavía no hay listas de precio online. Cree la primera desde la solapa Listas.",
    coeficiente: "Coeficiente",
  },
  estados: {
    ok: "Con precio",
    "sin-costo": "Sin costo",
    "sin-precio": "Sin precio online",
    retenido: "Retenido",
    nuevo: "Nuevo sin revisar",
  } as Record<string, string>,
  origen: {
    general: "General",
    marca: (m: string) => `Marca ${m}`,
    categoria: (n: string, heredado: boolean) => `Categoría ${n}${heredado ? " (heredado)" : ""}`,
  },
  listas: {
    titulo: "Listas de precio online",
    nueva: "Nueva lista",
    editar: "Editar",
    eliminar: "Eliminar",
    activar: "Activar",
    desactivar: "Desactivar",
    marcarReferencia: "Usar como referencia",
    referencia: "Referencia",
    inactiva: "Inactiva",
    nombre: "Nombre",
    coeficiente: "Coeficiente",
    coeficienteAyuda: "Debe ser mayor o igual a 1. Por ejemplo, 1,60 indica costo más 60 %.",
    orden: "Orden",
    guardar: "Revisar cambio",
    cancelar: "Cancelar",
    ajustes: "Ajustes por marca o categoría",
    ajustesAyuda: "El ajuste de marca tiene prioridad sobre el de categoría, y éste sobre el coeficiente general.",
    nuevoAjuste: "Nuevo ajuste",
    ajusteMarca: "Por marca",
    ajusteCategoria: "Por categoría",
    quitarAjuste: "Quitar",
    sinListas: "Todavía no hay listas de precio online.",
    sinAjustes: "Esta lista no tiene ajustes.",
    umbrales: "Umbrales de control",
    ajustesAvanzados: "Ajustes avanzados",
    umbralConfirmacion: "Confirmación adicional (variación mayor a, en %)",
    umbralRetencion: "Retención de costos de Alegra (variación mayor a, en %)",
    umbralAyuda: "Los umbrales actúan solo cuando la variación los supera.",
    umbralConfirmacionInfo:
      "Si un cambio de coeficiente mueve algún precio más que este porcentaje, se le pide una segunda confirmación antes de aplicar. Sirve para atajar errores de tipeo (por ejemplo, 16 en vez de 1,6).",
    umbralRetencionInfo:
      "Si el costo de un producto cambia en Alegra más que este porcentaje, su precio online no se actualiza solo: queda en Retenidos hasta que usted lo apruebe.",
    masInformacion: "Más información",
    revisarCambio: "Revisar cambio",
    cerrar: "Cerrar",
    confirmarEliminar: (n: string, enlaces = 0) =>
      `¿Desea eliminar la lista ${n}? ${
        enlaces > 0
          ? `También se ${enlaces === 1 ? "quitará su enlace" : `quitarán sus ${enlaces} enlaces`} con listas de Alegra. `
          : ""
      }Se mostrará una vista previa antes de aplicar el cambio.`,
    privada: "Privada",
    privadaCampo: "Lista privada",
    privadaAyuda:
      "Solo la ven los clientes con cuenta corriente cuya lista de Alegra esté enlazada. No puede ser la lista de referencia ni usarse en un medio de pago.",
    hacerPrivada: "Hacer privada",
    hacerPublica: "Hacer pública",
    confirmarPublica: (n: string, enlaces: number) =>
      `¿Desea hacer pública la lista ${n}? ${
        enlaces > 0
          ? `${enlaces === 1 ? "Se quitará su enlace" : `Se quitarán sus ${enlaces} enlaces`} con listas de Alegra. `
          : ""
      }Dejará de ser exclusiva de los clientes con cuenta corriente. Se mostrará una vista previa antes de aplicar el cambio.`,
    enlaces: "Corresponde a la lista de Alegra",
    enlacesAyuda:
      "Los clientes con cuenta corriente cuya lista en Alegra sea una de estas verán los precios de esta lista. Se ofrecen todas las listas de precios de cada cuenta de Alegra.",
    sinEnlaces: "Esta lista privada todavía no está enlazada a ninguna lista de Alegra: ningún cliente la ve.",
    agregarEnlace: "Enlazar lista de Alegra",
    quitarEnlace: "Quitar enlace",
    cuentaAlegra: "Cuenta de Alegra",
    listaAlegra: "Lista de Alegra",
    seleccioneCuenta: "Seleccione la cuenta",
    seleccioneListaAlegra: "Seleccione la lista de Alegra",
    sinListasAlegra: "No hay listas de precios de Alegra disponibles para enlazar.",
    avisoListasAlegra: (cuentas: string[]) =>
      `No se pudieron obtener todas las listas de Alegra de ${cuentas.length === 1 ? "la cuenta" : "las cuentas"} ${cuentas.join(", ")}: de ${cuentas.length === 1 ? "esa cuenta" : "esas cuentas"} solo se muestran las listas de sus clientes ya sincronizados. Inténtelo nuevamente en unos minutos.`,
    contactos: (n: number) => (n === 0 ? "sin clientes" : `${n} cliente${n === 1 ? "" : "s"}`),
    cuentaPrincipal: "Cuenta principal",
  },
  previa: {
    titulo: "Vista previa del cambio",
    generando: "Generando la vista previa…",
    afectados: "Productos afectados",
    suben: "Precios que suben",
    bajan: "Precios que bajan",
    nuevos: "Precios nuevos",
    quitan: "Precios que se quitan",
    mayorSuba: "Mayor suba",
    mayorBaja: "Mayor baja",
    sinCosto: "Productos sin costo (excluidos del cálculo)",
    muestra: "Muestra de los mayores cambios",
    columnaProducto: "Producto",
    columnaLista: "Lista",
    columnaAntes: "Anterior",
    columnaDespues: "Nuevo",
    columnaVariacion: "Variación",
    sinCambios: "Este cambio no modifica ningún precio.",
    avisoSuperaReferencia: (n: number) =>
      `En ${n} producto${n === 1 ? "" : "s"} una lista queda más cara que la de referencia. Puede aplicar el cambio igualmente.`,
    confirmacionExtra: (umbral: number) =>
      `Este cambio modifica algún precio en más de ${umbral} %. Para aplicarlo, escriba el nombre de la lista.`,
    escribirNombre: "Nombre de la lista",
    aplicar: "Aplicar cambios",
    cancelar: "Cancelar",
    cerrar: "Cerrar",
    aplicando: "Aplicando…",
    aplicado: "Los cambios se aplicaron correctamente.",
    vencida: "La vista previa quedó desactualizada. Genere una nueva.",
    generarOtra: "Generar nueva vista previa",
    errorGenerico: "No pudimos completar la operación. Inténtelo nuevamente.",
  },
  historial: {
    titulo: "Historial de cambios",
    sinCambios: "Todavía no hay cambios registrados.",
    fecha: "Fecha",
    usuario: "Usuario",
    cambio: "Cambio",
    afectados: "Productos afectados",
    revertir: "Revertir",
    revertido: "Revertido",
    errorCarga: "No pudimos cargar el historial.",
    confirmarRevertir: "Revertir este cambio",
  },
  retenidos: {
    titulo: "Cambios de costo retenidos",
    ayuda:
      "Alegra informó un costo que varía más que el umbral permitido. Mientras no lo apruebe, se mantiene el precio vigente.",
    sinRetenidos: "No hay cambios de costo pendientes de aprobación.",
    costoVigente: "Costo vigente",
    costoPropuesto: "Costo propuesto",
    variacion: "Variación",
    sinCostoPropuesto: "Sin costo",
    aprobar: "Aprobar",
    rechazar: "Rechazar",
    seleccion: (n: number) => `${n} seleccionado${n === 1 ? "" : "s"}`,
    confirmarVarios: (accion: string, n: number) => `¿Desea ${accion} ${n} cambios de costo a la vez?`,
    confirmar: "Confirmar",
    cancelar: "Cancelar",
    omitidos: (n: number) =>
      `${n} cambio${n === 1 ? "" : "s"} no se pudo aprobar porque Alegra no informa un costo. Puede rechazarlo.`,
    resuelto: "Los cambios se resolvieron correctamente.",
    errorCarga: "No pudimos cargar los cambios retenidos.",
  },
  tipoCambio: {
    lista_alta: "Lista creada",
    lista_edicion: "Lista modificada",
    lista_baja: "Lista eliminada",
    referencia: "Lista de referencia",
    override_alta: "Ajuste agregado",
    override_edicion: "Ajuste modificado",
    override_baja: "Ajuste quitado",
    umbral: "Umbrales",
    condicion: "Lista de un medio de pago",
    mapeo: "Enlace con lista de Alegra",
    revertir: "Reversión",
    costo_aprobado: "Costo aprobado",
    costo_rechazado: "Costo rechazado",
  } as Record<string, string>,
} as const

/** "150.00" -> "$ 150,00". Un valor ausente se muestra como un guion. */
export function fmtPrecio(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return "—"
  const n = typeof valor === "number" ? valor : Number(valor)
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 })
}

/** "1.6000" -> "1,6". */
export function fmtCoef(valor: string | null | undefined): string {
  if (!valor) return "—"
  const n = Number(valor)
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—"
  const signo = n > 0 ? "+" : ""
  return `${signo}${n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} %`
}

export function textoOrigen(o: OrigenCoeficiente): string {
  if (o.tipo === "marca") return TEXTOS.origen.marca(o.marca ?? "")
  if (o.tipo === "categoria") return TEXTOS.origen.categoria(o.categoriaNombre ?? "sin nombre", Boolean(o.heredado))
  return TEXTOS.origen.general
}
