// Seguimiento de contacto de los pedidos pendientes (change `sucursales-igz-mdp`, rebanada B).
// Lógica pura: sin DB, sin reloj propio (`now` entra por parámetro).
//
// "Sin contactar" = pedido PENDIENTE (todavía sin confirmar) que nadie marcó como contactado y que
// lleva más de `umbralHoras` horas creado. Con umbral 0 el aviso está apagado (nada se resalta).

export interface PedidoParaContacto {
  estado: string
  creadoEn: Date
  contactadoEn: Date | null
}

const HORA_MS = 3_600_000

/** Horas enteras transcurridas desde `desde` (nunca negativo). */
export function horasDesde(desde: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - desde.getTime()) / HORA_MS))
}

export function estaSinContactar(p: PedidoParaContacto, umbralHoras: number, now: Date = new Date()): boolean {
  if (umbralHoras <= 0) return false
  if (p.estado !== "pendiente") return false
  if (p.contactadoEn) return false
  return now.getTime() - p.creadoEn.getTime() > umbralHoras * HORA_MS
}

/** Etiqueta con el tiempo real transcurrido: "Sin contactar hace 25 h" (o en días desde las 48 h). */
export function textoSinContactar(creadoEn: Date, now: Date = new Date()): string {
  const h = horasDesde(creadoEn, now)
  return h < 48 ? `Sin contactar hace ${h} h` : `Sin contactar hace ${Math.floor(h / 24)} días`
}
