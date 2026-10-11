export const ERROR_GENERICO = "No se pudo completar la acción. Inténtelo de nuevo"

// Error con un mensaje apto para mostrar tal cual (viene del servidor o lo redactamos acá).
export class ErrorUsuario extends Error {
  constructor(mensaje: string, readonly code?: string) {
    super(mensaje)
  }
}

// Los errores de red o de parseo nunca se muestran crudos: sólo los ErrorUsuario conservan su texto.
export function mensajeDeError(e: unknown, generico = ERROR_GENERICO): string {
  return e instanceof ErrorUsuario ? e.message : generico
}

export async function pedirJson(url: string, init: RequestInit, generico = ERROR_GENERICO): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw new ErrorUsuario(generico)
  }
  const datos = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new ErrorUsuario(
      typeof datos.error === "string" && datos.error.trim() ? datos.error : generico,
      typeof datos.code === "string" ? datos.code : undefined,
    )
  }
  return datos
}
