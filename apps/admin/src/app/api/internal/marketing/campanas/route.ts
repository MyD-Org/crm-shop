// src/app/api/internal/marketing/campanas/route.ts
import { and, asc, eq } from "drizzle-orm"
import { getDb } from "@/db"
import { marketingCampanas } from "@/db/schema"
import { autenticarInterno, jsonInterno } from "@/lib/marketing/auth-interna"

export const dynamic = "force-dynamic"
const ESTADOS = ["activa", "pausada", "cerrada"]

export async function GET(req: Request) {
  const auth = autenticarInterno(req, ["planificador", "studio"])
  if (!auth.ok) return auth.response
  const estado = new URL(req.url).searchParams.get("estado") ?? "activa"
  if (!ESTADOS.includes(estado)) return jsonInterno({ error: "invalid_estado" }, 400)
  const filas = await getDb()
    .select()
    .from(marketingCampanas)
    .where(and(eq(marketingCampanas.tenantId, auth.tenantId), eq(marketingCampanas.estado, estado)))
    .orderBy(asc(marketingCampanas.desde))
  return jsonInterno({
    items: filas.map((c) => ({ id: c.id, nombre: c.nombre, objetivo: c.objetivo, desde: c.desde, hasta: c.hasta, sucursalId: c.sucursalId, estado: c.estado })),
  })
}
