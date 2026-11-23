import { adminNotFoundResponse, requireSeccion } from "@/lib/admin-route-guard"
import {
  ALEGRA_ID_RE,
  CLERK_USER_ID_RE,
  CUENTA_ALEGRA_RE,
  desvincularUsuario,
  vincularUsuario,
  type DesvincularResult,
  type VincularResult,
} from "@/lib/clientes-tienda-acciones"

// Vínculo de un usuario de la tienda con un contacto de Alegra, a mano desde el admin
// ("Clientes de la tienda"). Sólo con la sección Clientes de la tienda (`requireSeccion`).
//
//   POST   /api/admin/clientes-tienda/[clerkUserId]/vinculo  body {alegraContactId, cuenta?}
//          → vínculo activo, metodo 'operador', con quién y cuándo, en la cuenta de Alegra
//            `cuenta` ('principal' por defecto; validada contra las del tenant, nunca confiada).
//            200 {cambio, razonSocial}.
//   DELETE /api/admin/clientes-tienda/[clerkUserId]/vinculo?cuenta=
//          → el activo de la cuenta `cuenta` ('principal' por defecto; sólo se valida el formato)
//            pasa a 'revocada' (nunca se borra); los de otras cuentas no se tocan. 200 {cambio}.
//
// Sin la sección se recibe el MISMO 404 que devuelve `requireSeccion` en todas las rutas admin
// nuevas (cuerpo idéntico al de un id inexistente: no hay oráculo de existencia ni de permisos).
// Usuario con formato inválido, inexistente, eliminado o de otro tenant ⇒ ese mismo 404.

const NO_STORE = { "Cache-Control": "private, no-store" }

type Params = { params: Promise<{ clerkUserId: string }> }

const fail = (status: number, code: string, error: string) =>
  Response.json({ error, code }, { status, headers: NO_STORE })

const MSG = {
  invalido: "Seleccione un cliente de Alegra.",
  cuentaInvalida: "Seleccione una cuenta de Alegra válida.",
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
  const guard = await requireSeccion(req, "clientes-tienda")
  if (!guard.ok) return guard.response

  const { clerkUserId } = await params
  if (!CLERK_USER_ID_RE.test(clerkUserId)) return adminNotFoundResponse()

  const body = (await req.json().catch(() => null)) as { alegraContactId?: unknown; cuenta?: unknown } | null
  const alegraContactId = body?.alegraContactId
  if (typeof alegraContactId !== "string" || !ALEGRA_ID_RE.test(alegraContactId)) {
    return fail(400, "invalid", MSG.invalido)
  }
  const cuenta = body?.cuenta ?? "principal"
  if (typeof cuenta !== "string" || !CUENTA_ALEGRA_RE.test(cuenta)) return fail(400, "cuenta_invalida", MSG.cuentaInvalida)

  let result: VincularResult
  try {
    result = await vincularUsuario(
      guard.tenantId,
      clerkUserId,
      alegraContactId,
      { id: guard.user.id, name: guard.user.name },
      cuenta,
    )
  } catch (err) {
    logError("vincular", guard.tenantId, err)
    return fail(500, "internal", MSG.vincular)
  }

  if (result.kind === "not_found") return adminNotFoundResponse()
  if (result.kind === "cuenta_invalida") return fail(400, "cuenta_invalida", MSG.cuentaInvalida)
  if (result.kind === "contacto_invalido") return fail(422, "contacto_invalido", MSG.contactoInvalido)
  if (result.kind === "ya_vinculado") return fail(409, "ya_vinculado", MSG.yaVinculado(result.razonSocial))
  return Response.json({ cambio: result.cambio, razonSocial: result.razonSocial }, { headers: NO_STORE })
}

export async function DELETE(req: Request, { params }: Params) {
  const guard = await requireSeccion(req, "clientes-tienda")
  if (!guard.ok) return guard.response

  const { clerkUserId } = await params
  if (!CLERK_USER_ID_RE.test(clerkUserId)) return adminNotFoundResponse()

  const cuenta = new URL(req.url).searchParams.get("cuenta") ?? "principal"
  if (!CUENTA_ALEGRA_RE.test(cuenta)) return fail(400, "cuenta_invalida", MSG.cuentaInvalida)

  let result: DesvincularResult
  try {
    result = await desvincularUsuario(guard.tenantId, clerkUserId, { id: guard.user.id, name: guard.user.name }, cuenta)
  } catch (err) {
    logError("desvincular", guard.tenantId, err)
    return fail(500, "internal", MSG.desvincular)
  }

  if (result.kind === "not_found") return adminNotFoundResponse()
  return Response.json({ cambio: result.cambio }, { headers: NO_STORE })
}
