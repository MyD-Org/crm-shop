import { textoPlazo, type FlujoSinStock, type ModalidadSinStock } from "@/lib/modalidades-sin-stock-validacion"

// Lógica pura de la tarjeta "Venta sin stock" (sin React): la importan la tarjeta y los tests.

export type FormModalidad = { nombre: string; texto: string; plazo: string; aCoordinar: boolean; flujo: FlujoSinStock; activa: boolean }

export const ETIQUETA_FLUJO: Record<FlujoSinStock, string> = {
  en_linea: "Pago en línea",
  a_confirmar: "A confirmar",
}

export function formDesdeModalidad(m?: ModalidadSinStock): FormModalidad {
  if (!m) return { nombre: "", texto: "", plazo: "", aCoordinar: false, flujo: "en_linea", activa: true }
  return {
    nombre: m.nombre,
    texto: m.texto,
    plazo: m.plazoDias === null ? "" : String(m.plazoDias),
    aCoordinar: m.plazoDias === null,
    flujo: m.flujo,
    activa: m.activa,
  }
}

/** Cuerpo para la API: "A coordinar" manda plazoDias null; si no, el texto del plazo (lo valida validarModalidad). */
export function bodyDesdeForm(f: FormModalidad): unknown {
  return {
    nombre: f.nombre,
    texto: f.texto,
    plazoDias: f.aCoordinar ? null : f.plazo.trim(),
    flujo: f.flujo,
    activa: f.activa,
  }
}

/** Opciones del selector del producto. "ninguna" (Radix no admite "") se traduce a null al guardar. */
export function opcionesModalidad(modalidades: ModalidadSinStock[]): { value: string; label: string }[] {
  return [
    { value: "ninguna", label: "Ninguna" },
    ...modalidades.map((m) => ({ value: m.id, label: m.activa ? m.nombre : `${m.nombre} (inactiva)` })),
  ]
}

export function resumenModalidad(m: ModalidadSinStock): string {
  return [m.texto, textoPlazo(m.plazoDias), ETIQUETA_FLUJO[m.flujo]].join(" · ")
}
