// Piezas puras de la solapa "Cupones" (spec 2026-11-01-cupones-design.md): el formulario, el
// cuerpo que se manda a /api/admin/cupones, rótulos y textos. Textos en usted.

import type { EstadoCanje } from "@/lib/cupones-canjes"
import type { PromocionDto } from "@/lib/cupones-repo"
import type { EstadoPromocion, FormaCupon, PromocionEntrada, TipoPromocion } from "@/lib/cupones-validar"
import { aIsoArgentina, deIsoArgentina } from "./campanias-ui"

export const FORMAS: { value: FormaCupon; label: string }[] = [
  { value: "credito", label: "Tarjeta de crédito" },
  { value: "debito", label: "Tarjeta de débito" },
  { value: "cuenta_mp", label: "Cuenta de Mercado Pago" },
]
const TODAS_LAS_FORMAS = FORMAS.map((f) => f.value)

export interface FormPromocion {
  nombre: string
  tipo: TipoPromocion
  codigo: string
  prefijo: string
  pct: string
  envioGratis: boolean
  /** Claves de `claveProvincia` tildadas; ninguna = todas. */
  provincias: string[]
  inicioFecha: string
  inicioHora: string
  finFecha: string
  finHora: string
  venceDias: string
  soloPrimeraCompra: boolean
  minimo: string
  /** Slugs tildados. */
  medios: string[]
  formas: FormaCupon[]
  permiteCuotas: boolean
  limite: string
  condiciones: string
}

export function formVacioPromocion(medios: string[]): FormPromocion {
  return {
    nombre: "",
    tipo: "unicos",
    codigo: "",
    prefijo: "",
    pct: "",
    envioGratis: false,
    provincias: [],
    inicioFecha: "",
    inicioHora: "00:00",
    finFecha: "",
    finHora: "23:59",
    venceDias: "",
    soloPrimeraCompra: true,
    minimo: "",
    medios: [...medios],
    formas: [...TODAS_LAS_FORMAS],
    permiteCuotas: false,
    limite: "",
    condiciones: "",
  }
}

const num = (s: string): number | null => (s.trim() === "" ? null : Number(s.trim().replace(",", ".")))

/** Todos tildados = null (vale para todos); así un medio nuevo queda incluido sin editar. */
const listaONull = <T extends string>(elegidos: T[], todos: T[]): T[] | null =>
  todos.every((t) => elegidos.includes(t)) ? null : elegidos.filter((e) => todos.includes(e))

/** El formulario -> el cuerpo de POST/PUT. La validación la hace el servidor (un solo lugar). */
export function cuerpoPromocion(f: FormPromocion, mediosDisponibles: string[]): PromocionEntrada {
  return {
    nombre: f.nombre.trim(),
    tipo: f.tipo,
    ...(f.tipo === "generica" ? { codigo: f.codigo.trim() } : { prefijo: f.prefijo.trim() }),
    pct: num(f.pct),
    envioGratis: f.envioGratis,
    provinciasEnvio: f.provincias.length > 0 ? [...f.provincias] : null,
    inicio: aIsoArgentina(f.inicioFecha, f.inicioHora),
    fin: aIsoArgentina(f.finFecha, f.finHora),
    venceDiasDesdeEmision: f.tipo === "unicos" ? num(f.venceDias) : null,
    soloPrimeraCompra: f.soloPrimeraCompra,
    minimo: num(f.minimo),
    medios: listaONull(f.medios, mediosDisponibles),
    formas: listaONull(f.formas, TODAS_LAS_FORMAS),
    permiteCuotas: f.permiteCuotas,
    limiteCanjes: num(f.limite),
    condiciones: f.condiciones.trim(),
  }
}

export function formDesdeDto(d: PromocionDto, mediosDisponibles: string[]): FormPromocion {
  const i = deIsoArgentina(d.inicio)
  const f = deIsoArgentina(d.fin)
  const txt = (n: number | null) => (n === null ? "" : String(n))
  return {
    nombre: d.nombre,
    tipo: d.tipo,
    codigo: d.codigo ?? "",
    prefijo: d.prefijo ?? "",
    pct: txt(d.pct),
    envioGratis: d.envioGratis,
    provincias: d.provinciasEnvio ?? [],
    inicioFecha: i.fecha,
    inicioHora: i.hora,
    finFecha: f.fecha,
    finHora: f.hora,
    venceDias: txt(d.venceDiasDesdeEmision),
    soloPrimeraCompra: d.soloPrimeraCompra,
    minimo: txt(d.minimo),
    medios: d.medios ?? [...mediosDisponibles],
    formas: d.formas ?? [...TODAS_LAS_FORMAS],
    permiteCuotas: d.permiteCuotas,
    limite: txt(d.limiteCanjes),
    condiciones: d.condiciones,
  }
}

export const ROTULO_ESTADO_PROMO: Record<EstadoPromocion, { texto: string; tono: "info" | "success" | "neutral" | "warning" }> = {
  programada: { texto: "Programada", tono: "info" },
  activa: { texto: "Activa", tono: "success" },
  pausada: { texto: "Pausada", tono: "warning" },
  terminada: { texto: "Terminada", tono: "neutral" },
}

export const ROTULO_ESTADO_CANJE: Record<EstadoCanje, { texto: string; tono: "info" | "success" | "neutral" }> = {
  reservado: { texto: "Reservado", tono: "info" },
  canjeado: { texto: "Canjeado", tono: "success" },
  liberado: { texto: "Liberado", tono: "neutral" },
}

/** "10 % + envío gratis", "Envío gratis" o "10 %". */
export function textoBeneficio(p: { pct: number | null; envioGratis: boolean }): string {
  if (p.pct === null) return "Envío gratis"
  return p.envioGratis ? `${p.pct} % + envío gratis` : `${p.pct} %`
}

export const TEXTOS_CUPONES = {
  ayuda:
    "Un cupón da un descuento o envío gratis en la tienda online. La promoción genérica tiene un código que usan muchas personas; la de códigos únicos genera un código de un solo uso por persona (bot de Instagram o lote para volantes).",
  nueva: "Nueva promoción",
  editar: "Editar promoción",
  vacio: "Todavía no hay promociones de cupones.",
  nombre: "Nombre",
  nombreAyuda: "Lo ve el comprador junto al cupón y se usa en los reportes.",
  tipo: "Tipo",
  tipoGenerica: "Genérica (un código para todos)",
  tipoUnicos: "Códigos únicos (uno por persona)",
  codigo: "Código",
  codigoAyuda: "De 3 a 24 letras o números. Mayúsculas y guiones dan igual.",
  prefijo: "Prefijo",
  prefijoAyuda: "De 2 a 8 letras. Los códigos quedan como LUZ-7KQ2M.",
  venceDias: "Vence a los N días de emitido (opcional)",
  descuento: "Descuento (%)",
  descuentoAyuda: "Entero de 1 a 50. Déjelo vacío si el cupón sólo da envío gratis.",
  envioGratis: "Envío gratis",
  provincias: "Provincias del envío gratis (opcional)",
  provinciasAyuda: "Sin ninguna tildada, vale donde la tienda ya hace envío a domicilio.",
  inicio: "Inicio",
  fin: "Fin",
  horaAyuda: "Hora de Argentina.",
  primeraCompra: "Sólo primera compra",
  minimo: "Compra mínima con IVA (opcional)",
  minimoAyuda: "Sobre todo el carrito, a la lista general.",
  medios: "Medios de pago",
  mediosAyuda: "Con todos tildados vale para cualquier medio, incluidos los que se agreguen después.",
  aCoordinar: "A coordinar (venta sin stock)",
  formas: "Formas (Mercado Pago y Payway)",
  cuotas: "También en cuotas sin interés",
  limite: "Límite total de canjes (opcional)",
  condiciones: "Condiciones",
  condicionesAyuda: "Lo que ve el comprador en \"Condiciones\": vigencia, mínimo, que no acumula con otras promociones.",
  guardar: "Guardar",
  cancelar: "Cancelar",
  cerrar: "Cerrar",
  pausar: "Pausar",
  reanudar: "Reanudar",
  eliminar: "Eliminar",
  generarLote: "Generar lote",
  cantidad: "Cantidad (hasta 500)",
  descargar: "Generar y descargar",
  generarToken: "Generar token",
  regenerarToken: "Regenerar token",
  revocarToken: "Revocar token",
  tokenTitulo: "Token del bot",
  tokenAviso: "Copie este token ahora: no se volverá a mostrar.",
  confirmarPausar: (nombre: string) =>
    `La promoción "${nombre}" deja de aceptar canjes nuevos. Los pedidos ya creados conservan su descuento. ¿Desea continuar?`,
  confirmarEliminar: (nombre: string) => `Se eliminará la promoción "${nombre}" con todos sus códigos. ¿Desea continuar?`,
  confirmarRevocar: (nombre: string) => `El bot deja de poder pedir códigos de "${nombre}". ¿Desea continuar?`,
  columnas: {
    nombre: "Nombre",
    beneficio: "Beneficio",
    vigencia: "Vigencia",
    estado: "Estado",
    emitidos: "Emitidos",
    canjes: "Canjes",
    descuento: "Descuento otorgado",
  },
  tipoCorto: { generica: "Genérica", unicos: "Únicos" } as Record<TipoPromocion, string>,
  verCanjes: "Canjes",
  canjesTitulo: (nombre: string) => `Canjes de "${nombre}"`,
  sinCanjes: "Todavía no hay canjes.",
  duplicado: "Canje duplicado",
  columnasCanje: { pedido: "Pedido", fecha: "Fecha", estado: "Estado", descuento: "Descuento" },
}
