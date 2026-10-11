import { requireAdminPlus } from "@/lib/admin-route-guard"
import { NO_STORE } from "@/lib/catalogo-admin"
import { guardarMarca, obtenerMarca, type MarcaEditable } from "@/lib/marketing/marca-repo"
import { validarFrases } from "@/lib/marketing/reglas"
import { esHorarios, esListaHashtags, esPoliticaComentarios, esReglaMarca, esReparto, MAX_REGLAS, MAX_VOZ } from "@/lib/marketing/validar"

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
  const rechazo = (error: string, code: string) => Response.json({ error, code }, { status: 400, headers: NO_STORE })
  const cambios: Partial<MarcaEditable> = {}
  if (b.voz !== undefined) {
    if (typeof b.voz !== "string" || b.voz.length > MAX_VOZ) return rechazo(`La voz de marca debe ser un texto de hasta ${MAX_VOZ} caracteres`, "invalid_voz")
    cambios.voz = b.voz
  }
  if (b.reglas !== undefined) {
    if (!Array.isArray(b.reglas) || b.reglas.length > MAX_REGLAS || !b.reglas.every(esReglaMarca)) {
      return rechazo(`Revise las reglas de marca: hasta ${MAX_REGLAS}, con identificador, texto y severidad`, "invalid_reglas")
    }
    for (const r of b.reglas) {
      const motivo = r.patron === undefined ? null : validarFrases(r.patron)
      if (motivo) return rechazo(`Regla «${r.texto}»: ${motivo}`, "invalid_patron")
    }
    cambios.reglas = b.reglas.map((r) => ({ id: r.id, texto: r.texto, severidad: r.severidad, ...(r.patron !== undefined ? { patron: r.patron } : {}) }))
  }
  if (b.hashtagsBase !== undefined) {
    if (!esListaHashtags(b.hashtagsBase)) return rechazo("Los hashtags deben ser hasta 30 textos de hasta 50 caracteres", "invalid_hashtags")
    cambios.hashtagsBase = b.hashtagsBase
  }
  if (b.horariosPreferidos !== undefined) {
    if (!esHorarios(b.horariosPreferidos)) return rechazo("Revise los horarios: día de la semana y horas con formato HH:MM, hasta 6 por día", "invalid_horarios")
    cambios.horariosPreferidos = b.horariosPreferidos
  }
  if (b.reparto !== undefined) {
    if (!esReparto(b.reparto)) return rechazo("Revise el reparto: porcentajes de 0 a 100 por público y por tema", "invalid_reparto")
    cambios.reparto = b.reparto
  }
  if (b.politicaComentarios !== undefined) {
    if (!esPoliticaComentarios(b.politicaComentarios)) return rechazo("Revise la política de comentarios", "invalid_politica")
    cambios.politicaComentarios = b.politicaComentarios
  }
  return Response.json(await guardarMarca(guard.tenantId, cambios), { headers: NO_STORE })
}
