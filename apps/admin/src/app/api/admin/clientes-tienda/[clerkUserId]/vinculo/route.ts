import { adminNotFoundResponse, requireAdminPlus } from "@/lib/admin-route-guard"
import {
  ALEGRA_ID_RE,
  CLERK_USER_ID_RE,
  desvincularUsuario,
  vincularUsuario,
  type DesvincularResult,
  type VincularResult,
} from "@/lib/clientes-tienda-acciones"

// Vínculo de un usuario de la tienda con un contacto de Alegra, a mano desde el admin
// ("Clientes de la tienda"). Sólo admin y superadmin (`requireAdminPlus`).
//
//   POST   /api/admin/clientes-tienda/[clerkUserId]/vinculo  body {alegraContactId}
//          → vínculo activo, metodo 'operador', con quién y cuándo. 200 {cambio, razonSocial}.
//   DELETE /api/admin/clientes-tienda/[clerkUserId]/vinculo
//          → el activo pasa a 'revocada' (nunca se borra). 200 {cambio}.
//
// Un operador recibe el MISMO 404 que devuelve `requireAdminPlus` en todas las rutas admin
// nuevas (cuerpo idéntico al de un id inexistente: no hay oráculo de existencia ni de permisos).
// Usuario con formato inválido, inexistente, eliminado o de otro tenant ⇒ ese mismo 404.

const NO_STORE = { "Cache-Control": "private, no-store" }

type Params = { params: Promise<{ clerkUserId: string }> }

const fail = (status: number, code: string, error: string) =>
  Response.json({ error, code }, { status, headers: NO_STORE })

const MSG = {
  invalido: "Seleccione un cliente de Alegra.",
  contactoInvalido: "El cliente seleccionado no existe o no está activo en Alegra.",
  yaVinculado: (razonSocial: string | null) =>
    `El usuario ya está vinculado a ${razonSocial ?? "otro cliente"}. Desvincúlelo antes de vincularlo a otro cliente.`,
  vincular: "No se pudo vincular la cuenta. Inténtelo nuevamente.",
  desvincular: "No se pudo desvincular la cuenta. Inténtelo nuevamente.",
} as const

function logError(accion: string, tenant: string, err: unknown) {
  // Sólo nombre y código: el mensaje de Postgres puede traer datos.
  const e = err as { name?: unknown; code?: unknown }
  console.error(
    `[admin/clientes-tienda/vinculo] no se pudo ${accion} tenant=${tenant} error=${String(e?.name ?? "Error")} codigo=${String(e?.code ?? "sin código")}`,
  )
}

export async function POST(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { clerkUserId } = await params
  if (!CLERK_USER_ID_RE.test(clerkUserId)) return adminNotFoundResponse()

  const body = (await req.json().catch(() => null)) as { alegraContactId?: unknown } | null
  const alegraContactId = body?.alegraContactId
  if (typeof alegraContactId !== "string" || !ALEGRA_ID_RE.test(alegraContactId)) {
    return fail(400, "invalid", MSG.invalido)
  }

  let result: VincularResult
  try {
    result = await vincularUsuario(guard.tenantId, clerkUserId, alegraContactId, {
      id: guard.user.id,
      name: guard.user.name,
    })
  } catch (err) {
    logError("vincular", guard.tenantId, err)
    return fail(500, "internal", MSG.vincular)
  }

  if (result.kind === "not_found") return adminNotFoundResponse()
  if (result.kind === "contacto_invalido") return fail(422, "contacto_invalido", MSG.contactoInvalido)
  if (result.kind === "ya_vinculado") return fail(409, "ya_vinculado", MSG.yaVinculado(result.razonSocial))
  return Response.json({ cambio: result.cambio, razonSocial: result.razonSocial }, { headers: NO_STORE })
}

export async function DELETE(req: Request, { params }: Params) {
  const guard = await requireAdminPlus(req)
  if (!guard.ok) return guard.response

  const { clerkUserId } = await params
  if (!CLERK_USER_ID_RE.test(clerkUserId)) return adminNotFoundResponse()

  let result: DesvincularResult
  try {
    result = await desvincularUsuario(guard.tenantId, clerkUserId, { id: guard.user.id, name: guard.user.name })
  } catch (err) {
    logError("desvincular", guard.tenantId, err)
    return fail(500, "internal", MSG.desvincular)
  }

  if (result.kind === "not_found") return adminNotFoundResponse()
  return Response.json({ cambio: result.cambio }, { headers: NO_STORE })
}
