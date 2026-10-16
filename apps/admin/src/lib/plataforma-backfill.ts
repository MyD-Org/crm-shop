import { sql } from "drizzle-orm"
import { getDb } from "@/db"
import type { Valor } from "@/lib/plataforma-atributos"

// Backfill one-off de `catalog_atributos` a la plataforma y comparación de paridad con la vista
// `catalog_atributos_shop` (migración 0090). Lo usan sólo los scripts de rollout.

export const ORDEN_FUENTES = ["nombre", "pdf", "manual"] as const
type Fuente = (typeof ORDEN_FUENTES)[number]
interface FilaVieja { alegraId: string; clave: string; valorNum: number | string | null; valorTexto: string | null; fuente: string }

export interface PasadaFuente { fuente: Fuente; alegraId: string; data: Record<string, Valor>; reemplaza: boolean }

/**
 * El backfill no puede mandar un producto en un solo PATCH: cada PATCH lleva UNA meta.fuente y las
 * claves de un producto tienen fuentes mezcladas. Se arma una pasada por (producto, fuente) en
 * orden de precedencia ascendente, así la plataforma deja `fuentes` igual que la tabla.
 *
 * La pasada `nombre` lleva `reemplaza: true` (reemplaza_fuente) y cubre a TODO producto con alguna
 * fila en la tabla, aunque no tenga filas de nombre (entonces `data: {}`): así las claves de nombre
 * que la plataforma tiene y la tabla no (re-backfill tras cambios) convergen. pdf y manual sólo agregan.
 */
export function pasadasPorFuente(filas: FilaVieja[]): PasadaFuente[] {
  const out: PasadaFuente[] = []
  const productos = [...new Set(filas.map((f) => f.alegraId))]
  for (const fuente of ORDEN_FUENTES) {
    const porProducto = new Map<string, Record<string, Valor>>()
    if (fuente === "nombre") for (const id of productos) porProducto.set(id, {})
    for (const f of filas) {
      if (f.fuente !== fuente) continue
      const d = porProducto.get(f.alegraId) ?? {}
      d[f.clave] = { n: f.valorNum == null ? null : Number(f.valorNum), t: f.valorTexto }
      porProducto.set(f.alegraId, d)
    }
    for (const [alegraId, data] of porProducto) out.push({ fuente, alegraId, data, reemplaza: fuente === "nombre" })
  }
  return out
}

/**
 * Compara `catalog_atributos` (tabla) con `catalog_atributos_shop` (vista) por (alegra_id, clave).
 * "distintos" se decide en SQL con IS DISTINCT FROM: valor_num es numeric sin escala, así que la
 * tabla guarda "20.50" y la vista (desde jsonb) 20.5; comparar texto daría falsos distintos.
 */
export async function compararParidad(tenantId: string): Promise<{ soloTabla: string[]; soloVista: string[]; distintos: string[] }> {
  const filas = await getDb().execute(sql`
    select coalesce(t.alegra_id, v.alegra_id) as alegra_id, coalesce(t.clave, v.clave) as clave,
           (t.alegra_id is null) as solo_vista, (v.alegra_id is null) as solo_tabla,
           (t.valor_num is distinct from v.valor_num or t.valor_texto is distinct from v.valor_texto) as distinto
    from (select alegra_id, clave, valor_num, valor_texto from catalog_atributos where tenant_id = ${tenantId}) t
    full outer join (select alegra_id, clave, valor_num, valor_texto from catalog_atributos_shop where tenant_id = ${tenantId}) v
      on t.alegra_id = v.alegra_id and t.clave = v.clave
    order by 1, 2`)
  const r = { soloTabla: [] as string[], soloVista: [] as string[], distintos: [] as string[] }
  for (const f of filas as unknown as Record<string, unknown>[]) {
    const k = `${f.alegra_id}|${f.clave}`
    if (f.solo_tabla) r.soloTabla.push(k)
    else if (f.solo_vista) r.soloVista.push(k)
    else if (f.distinto) r.distintos.push(k)
  }
  return r
}
