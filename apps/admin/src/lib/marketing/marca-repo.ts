// src/lib/marketing/marca-repo.ts
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { marketingMarca, type ReglaMarca } from "@/db/schema"

export interface MarcaEditable {
  voz: string
  reglas: ReglaMarca[]
  paleta: Record<string, string>
  tipografias: Record<string, string>
  logoKey: string | null
  hashtagsBase: string[]
  horariosPreferidos: Record<string, string[]>
  plantillasHabilitadas: string[]
  reparto: { publico?: Record<string, number>; tema?: Record<string, number> }
  politicaComentarios: Record<string, "sugerir" | "auto" | "derivar" | "ocultar">
}
export type MarcaDto = MarcaEditable & { actualizadaEn: string }

type Fila = typeof marketingMarca.$inferSelect

function aDto(f: Fila): MarcaDto {
  return {
    voz: f.voz,
    reglas: f.reglas,
    paleta: f.paleta,
    tipografias: f.tipografias,
    logoKey: f.logoKey,
    hashtagsBase: f.hashtagsBase,
    horariosPreferidos: f.horariosPreferidos,
    plantillasHabilitadas: f.plantillasHabilitadas,
    reparto: f.reparto,
    politicaComentarios: f.politicaComentarios,
    actualizadaEn: f.updatedAt.toISOString(),
  }
}

export async function obtenerMarca(tenantId: string): Promise<MarcaDto> {
  const db = getDb()
  await db.insert(marketingMarca).values({ tenantId }).onConflictDoNothing()
  const [f] = await db.select().from(marketingMarca).where(eq(marketingMarca.tenantId, tenantId))
  return aDto(f)
}

export async function guardarMarca(tenantId: string, cambios: Partial<MarcaEditable>): Promise<MarcaDto> {
  await obtenerMarca(tenantId)
  const [f] = await getDb()
    .update(marketingMarca)
    .set({ ...cambios, updatedAt: new Date() })
    .where(eq(marketingMarca.tenantId, tenantId))
    .returning()
  return aDto(f)
}
