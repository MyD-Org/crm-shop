import { completarLocalidades } from "@/lib/metodos-envio-localidades"
import type { MetodoParaGuardar, ResultadoMetodo } from "@/lib/metodos-envio-repo"
import { validarMetodoEnvio } from "@/lib/metodos-envio-validacion"
import { NO_STORE } from "@/lib/sucursales-respuestas"

// Paso común de POST y PUT de /api/admin/metodos-envio: valida el cuerpo y completa el centro y el
// rectángulo de las localidades atendidas (Georef/Nominatim, best-effort, fuera de la transacción).

export type Preparado =
  | { ok: true; metodo: MetodoParaGuardar; avisos: string[] }
  | { ok: false; response: Response }

export async function prepararMetodo(body: unknown): Promise<Preparado> {
  const v = validarMetodoEnvio(body)
  if (!v.ok) {
    return { ok: false, response: Response.json({ error: v.error, code: "invalid", campo: v.campo }, { status: 400, headers: NO_STORE }) }
  }
  const localidades = await completarLocalidades(v.metodo.localidades)
  return { ok: true, avisos: v.avisos, metodo: { ...v.metodo, localidades } }
}

/** 404 / 409 de un resultado del repo que no es `ok`. */
export function errorDeResultadoMetodo(r: Exclude<ResultadoMetodo, { kind: "ok" }>): Response {
  if (r.kind === "not_found") {
    return Response.json({ error: "No encontramos el registro indicado.", code: "not_found" }, { status: 404, headers: NO_STORE })
  }
  return Response.json({ error: r.error, code: "conflict", campo: r.campo }, { status: 409, headers: NO_STORE })
}
