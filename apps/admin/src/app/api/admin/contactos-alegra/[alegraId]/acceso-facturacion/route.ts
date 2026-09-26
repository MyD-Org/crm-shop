import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import { ALEGRA_ID_RE, otorgarAcceso, quitarAcceso, type OtorgarResult } from "@/lib/clientes-tienda-acciones"

// Excepción de acceso a Facturación de Mi cuenta del Shop, por CONTACTO de Alegra (empresa).
// Sólo admin y superadmin (`requireAdminPlus`; un operador recibe su 404, igual que un id
// inexistente). La regla que ve el Shop es `alegra_contacts_shop.acceso_facturacion` (0039).
//
//   POST   /api/admin/contactos-alegra/[alegraId]/acceso-facturacion → excepción vigente con
//          quién y cuándo. Idempotente: 200 {cambio:false} si ya había una.
//   DELETE /api/admin/contactos-alegra/[alegraId]/acceso-facturacion → la revoca (UPDATE, el
//          historial queda). Idempotente.

const NO_STORE = { "Cache-Control": "private, no-store" }

type Params = { params: Promise<{ alegraId: string }> }

const fail = (status: number, code: string, error: string) =>
  Response.json({ error, code }, { status, headers: NO_STORE })

const MSG = {
  contactoInvalido: "El cliente seleccionado no existe o no está activo en Alegra.",
  esCuentaCorriente: "Este cliente ya tiene acceso a Facturación por ser cuenta corriente.",
  otorgar: "No se pudo dar acceso a Facturación. Inténtelo nuevamente.",
  quitar: "No se pudo quitar el acceso a Facturación. Inténtelo nuevamente.",
} as const

function logError(accion: string, tenant: string, err: unknown) {
  const e = err as { name?: unknown; code?: unknown }
  console.error(
    `[admin/acceso-facturacion] no se pudo ${accion} tenant=${tenant} error=${String(e?.name ?? "Error")} codigo=${String(e?.code ?? "sin código")}`,
  )
}

export async function POST(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { alegraId } = await params
  if (!ALEGRA_ID_RE.test(alegraId)) return adminNotFoundResponse()

  let result: OtorgarResult
  try {
    result = await otorgarAcceso(guard.tenantId, alegraId, { id: guard.user.id, name: guard.user.name })
  } catch (err) {
    logError("otorgar", guard.tenantId, err)
    return fail(500, "internal", MSG.otorgar)
  }

  if (result.kind === "contacto_invalido") return fail(422, "contacto_invalido", MSG.contactoInvalido)
  if (result.kind === "es_cuenta_corriente") return fail(422, "es_cuenta_corriente", MSG.esCuentaCorriente)
  return Response.json({ cambio: result.cambio }, { headers: NO_STORE })
}

export async function DELETE(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { alegraId } = await params
  if (!ALEGRA_ID_RE.test(alegraId)) return adminNotFoundResponse()

  try {
    const result = await quitarAcceso(guard.tenantId, alegraId, { id: guard.user.id, name: guard.user.name })
    return Response.json({ cambio: result.cambio }, { headers: NO_STORE })
  } catch (err) {
    logError("quitar", guard.tenantId, err)
    return fail(500, "internal", MSG.quitar)
  }
}
