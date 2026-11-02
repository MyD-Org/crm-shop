import { NO_STORE } from "@/lib/catalogo-admin"
import { validarPromocion, type PromocionEntrada } from "@/lib/cupones-validar"

// Piezas HTTP de /api/admin/cupones/*. Textos en usted.

/** La promoción validada, o un 400 con el primer error y la lista completa (`errores`). */
export function leerPromocionEntrada(raw: unknown): PromocionEntrada | Response {
  const v = validarPromocion(raw)
  if (v.ok) return v.valor
  return Response.json({ error: v.errores[0], code: "invalid", errores: v.errores }, { status: 400, headers: NO_STORE })
}
