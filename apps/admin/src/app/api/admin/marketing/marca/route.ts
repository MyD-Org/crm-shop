import { requireAdminPlus } from "@/lib/admin-route-guard"
import { NO_STORE } from "@/lib/catalogo-admin"
import { guardarMarca, obtenerMarca, type MarcaEditable } from "@/lib/marketing/marca-repo"
import { validarPatron } from "@/lib/marketing/reglas"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  return Response.json(await obtenerMarca(guard.tenantId), { headers: NO_STORE })
}

export async function PUT(req: Request) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response
  const b = (await req.json().catch(() => null)) as Partial<MarcaEditable> | null
  if (!b) return Response.json({ error: "Datos inválidos", code: "invalid_json" }, { status: 400, headers: NO_STORE })
  const cambios: Partial<MarcaEditable> = {}
  if (typeof b.voz === "string") cambios.voz = b.voz.slice(0, 4000)
  if (Array.isArray(b.reglas)) {
    const validas = b.reglas.every((r) => r && typeof r.id === "string" && typeof r.texto === "string" && (r.severidad === "alta" || r.severidad === "media") && (r.patron === undefined || typeof r.patron === "string"))
    if (!validas) return Response.json({ error: "Revise las reglas de marca", code: "invalid_reglas" }, { status: 400, headers: NO_STORE })
    for (const r of b.reglas) {
      const motivo = r.patron === undefined ? null : validarPatron(r.patron)
      if (motivo) return Response.json({ error: `Regla «${r.texto}»: ${motivo}`, code: "invalid_patron" }, { status: 400, headers: NO_STORE })
    }
    cambios.reglas = b.reglas
  }
  if (Array.isArray(b.hashtagsBase)) cambios.hashtagsBase = b.hashtagsBase.map(String).slice(0, 30)
  if (b.horariosPreferidos && typeof b.horariosPreferidos === "object") cambios.horariosPreferidos = b.horariosPreferidos
  if (b.reparto && typeof b.reparto === "object") cambios.reparto = b.reparto
  if (b.politicaComentarios && typeof b.politicaComentarios === "object") cambios.politicaComentarios = b.politicaComentarios
  return Response.json(await guardarMarca(guard.tenantId, cambios), { headers: NO_STORE })
}
