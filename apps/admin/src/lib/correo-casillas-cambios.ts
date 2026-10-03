// Diferencias entre las casillas cargadas y lo editado en el Dialog "Administrar casillas":
// pura, para decidir qué PATCH/PUT mandar al guardar.

export interface CasillaEditable {
  id: string
  email: string
  nombre: string
  activa: boolean
  orden: number
  adminUserIds: string[]
}

export interface CambioCasilla {
  id: string
  /** Nombre y/o activa si cambiaron; null si solo cambiaron los accesos. */
  datos: { nombre?: string; activa?: boolean } | null
  /** Conjunto completo de usuarios con acceso si cambió; null si no. */
  accesos: string[] | null
}

function mismoConjunto(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((x) => s.has(x))
}

export function cambiosPendientes(original: CasillaEditable[], editado: CasillaEditable[]): CambioCasilla[] {
  const porId = new Map(original.map((c) => [c.id, c]))
  const out: CambioCasilla[] = []
  for (const e of editado) {
    const o = porId.get(e.id)
    if (!o) continue
    const datos: { nombre?: string; activa?: boolean } = {}
    const nombre = e.nombre.trim()
    if (nombre && nombre !== o.nombre.trim()) datos.nombre = nombre
    if (e.activa !== o.activa) datos.activa = e.activa
    const hayDatos = Object.keys(datos).length > 0
    const hayAccesos = !mismoConjunto(o.adminUserIds, e.adminUserIds)
    if (!hayDatos && !hayAccesos) continue
    out.push({ id: e.id, datos: hayDatos ? datos : null, accesos: hayAccesos ? e.adminUserIds : null })
  }
  return out
}
