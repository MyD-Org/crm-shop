// Piezas puras de la solapa "Campañas" (spec 2026-10-28-campanias-precios-design.md): fechas en
// hora de Argentina (-03:00, sin horario de verano), rótulos de estado y el cuerpo que se manda a
// /api/admin/campanias. Textos en usted.

import type { CampaniaEntrada } from "@/lib/campanias-validar"
import type { EstadoCampania } from "@/lib/campanias-validar"
import type { ProductoElegido } from "./BuscadorProducto"

const OFFSET_AR = "-03:00"
const OFFSET_AR_MS = -3 * 3_600_000

export type TipoRegla = "producto" | "marca" | "categoria"

export interface FormRegla {
  /** Clave local de la fila (React key); no viaja. */
  clave: string
  tipo: TipoRegla
  marca: string
  categoriaId: string
  producto: ProductoElegido | null
  pct: string
  unidades: string
}

export interface FormCampania {
  nombre: string
  etiqueta: string
  inicioFecha: string
  inicioHora: string
  finFecha: string
  finHora: string
  reglas: FormRegla[]
}

/** "2026-11-27" + "00:00" -> "2026-11-27T00:00:00-03:00". */
export function aIsoArgentina(fecha: string, hora: string): string {
  return `${fecha}T${hora}:00${OFFSET_AR}`
}

/** Un instante -> su fecha y hora en Argentina (para precargar el formulario). */
export function deIsoArgentina(iso: string): { fecha: string; hora: string } {
  const local = new Date(new Date(iso).getTime() + OFFSET_AR_MS).toISOString()
  return { fecha: local.slice(0, 10), hora: local.slice(11, 16) }
}

function corta(iso: string): string {
  const { fecha, hora } = deIsoArgentina(iso)
  return `${fecha.slice(8, 10)}/${fecha.slice(5, 7)} ${hora}`
}

/** "27/11 00:00 → 30/11 23:59" en hora de Argentina. */
export function fmtVentana(inicio: string, fin: string): string {
  return `${corta(inicio)} → ${corta(fin)}`
}

export const ROTULO_ESTADO: Record<EstadoCampania, { texto: string; tono: "info" | "success" | "neutral" }> = {
  programada: { texto: "Programada", tono: "info" },
  activa: { texto: "Activa", tono: "success" },
  terminada: { texto: "Terminada", tono: "neutral" },
}

/** El formulario -> el cuerpo de POST/PUT. La validación la hace el servidor (un solo lugar). */
export function cuerpoCampania(f: FormCampania): CampaniaEntrada {
  const etiqueta = f.etiqueta.trim()
  return {
    nombre: f.nombre.trim(),
    ...(etiqueta ? { etiqueta } : {}),
    inicio: aIsoArgentina(f.inicioFecha, f.inicioHora),
    fin: aIsoArgentina(f.finFecha, f.finHora),
    reglas: f.reglas.map((r) => {
      const alcance =
        r.tipo === "producto"
          ? { tipo: "producto" as const, alegraId: r.producto?.alegraId ?? "" }
          : r.tipo === "marca"
            ? { tipo: "marca" as const, marca: r.marca }
            : { tipo: "categoria" as const, categoriaId: r.categoriaId }
      const unidades = r.tipo === "producto" && r.unidades.trim() ? Number(r.unidades.trim()) : null
      return { alcance, pct: Number(r.pct.trim()), ...(unidades !== null ? { unidades } : {}) }
    }),
  }
}

export const TEXTOS_CAMPANIAS = {
  titulo: "Campañas",
  ayuda:
    "Una campaña aplica un descuento con fecha y hora de inicio y de fin sobre el precio online normal, que no se modifica. Se activa y termina sola.",
  nueva: "Nueva campaña",
  editar: "Editar campaña",
  vacio: "Todavía no hay campañas.",
  nombre: "Nombre",
  etiqueta: "Etiqueta del badge",
  etiquetaAyuda: "Lo que ve el cliente en las tarjetas. Si la deja vacía, se usa el nombre.",
  inicio: "Inicio",
  fin: "Fin",
  horaAyuda: "Hora de Argentina.",
  reglas: "Reglas",
  reglasAyuda:
    "Producto le gana a marca y marca a categoría. Un producto con 0 % queda fuera de la campaña. Una regla de producto alcanza a todas las variantes del modelo.",
  agregarRegla: "Agregar regla",
  alcance: "Alcance",
  producto: "Producto",
  marca: "Marca",
  categoria: "Categoría",
  descuento: "Descuento (%)",
  unidades: "Unidades (opcional)",
  quitar: "Quitar",
  vistaPrevia: "Vista previa",
  guardar: "Guardar",
  cancelar: "Cancelar",
  cerrar: "Cerrar",
  terminar: "Terminar ahora",
  eliminar: "Eliminar",
  confirmarTerminar: (nombre: string) =>
    `La campaña "${nombre}" termina ahora y los precios vuelven al normal. ¿Desea continuar?`,
  confirmarEliminar: (nombre: string) => `Se eliminará la campaña "${nombre}". ¿Desea continuar?`,
  productosAlcanzados: (n: number) => (n === 1 ? "1 producto alcanzado." : `${n} productos alcanzados.`),
  bajoCosto: (n: number) =>
    n === 1 ? "1 producto quedaría por debajo del costo." : `${n} productos quedarían por debajo del costo.`,
  confirmarBajoCosto: (n: number) =>
    `Hay ${n === 1 ? "1 producto que quedaría" : `${n} productos que quedarían`} por debajo del costo. ¿Desea guardar igual?`,
  choque: (nombre: string) => `Las fechas se superponen con la campaña "${nombre}". Cambie las fechas para poder guardar.`,
  muestra: "Muestra",
  normal: "Normal",
  conCampania: "Con campaña",
  costo: "Costo",
  columnas: { nombre: "Campaña", ventana: "Vigencia", estado: "Estado", productos: "Productos" },
  sinPrevia: "Genere la vista previa antes de guardar.",
} as const
