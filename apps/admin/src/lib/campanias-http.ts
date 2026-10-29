import { NO_STORE } from "@/lib/catalogo-admin"
import { validarCampania, type CampaniaEntrada } from "@/lib/campanias-validar"

// Piezas HTTP de /api/admin/campanias/*. Textos en usted.

/** La campaña validada, o un 400 con el primer error y la lista completa (`errores`). */
export function leerCampania(raw: unknown): CampaniaEntrada | Response {
  const v = validarCampania(raw)
  if (v.ok) return v.valor
  return Response.json({ error: v.errores[0], code: "invalid", errores: v.errores }, { status: 400, headers: NO_STORE })
}
