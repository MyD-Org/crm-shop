import { MAX_MAIL_BYTES, extensionBloqueada } from "@/lib/correo-compose"

// Lógica del compositor que corre en el navegador, aislada de React para poder probarla: sin doble
// envío, clave de idempotencia estable, parseo de destinatarios y validación de adjuntos. El
// servidor revalida todo (esto es solo para dar la respuesta rápida).

/** Envuelve un envío para que, mientras uno está en curso, otro disparo reciba la MISMA promesa. */
export function crearEnvioUnico<T>(fn: () => Promise<T>): () => Promise<T> {
  let enCurso: Promise<T> | null = null
  return () => {
    if (enCurso) return enCurso
    const p = fn().finally(() => {
      enCurso = null
    })
    enCurso = p
    return p
  }
}

export interface ClavesIdempotencia {
  (huella: string): string
  /** Tras un envío exitoso: el próximo mensaje usa una clave nueva aunque sea igual. */
  reiniciar: () => void
}

/**
 * Misma intención (mismo contenido) => misma Idempotency-Key, así un reintento tras un corte de
 * red no duplica el mail; si la persona cambia algo, la clave cambia (Resend rechaza reusar una
 * clave con otro cuerpo).
 */
export function crearClavesIdempotencia(generar: () => string = () => crypto.randomUUID()): ClavesIdempotencia {
  let ultima: { huella: string; clave: string } | null = null
  const f = ((huella: string) => {
    if (!ultima || ultima.huella !== huella) ultima = { huella, clave: generar() }
    return ultima.clave
  }) as ClavesIdempotencia
  f.reiniciar = () => {
    ultima = null
  }
  return f
}

export type ResultadoEnviar = { ok: true; aviso?: string } | { ok: false; error: string }

/** POST al servidor. Nunca lanza: devuelve el error en usted para que el borrador se conserve. */
export async function enviarCorreo(fetchFn: typeof fetch, cuerpo: unknown): Promise<ResultadoEnviar> {
  let res: Response
  try {
    res = await fetchFn("/api/admin/correo/enviar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    })
  } catch {
    return { ok: false, error: "No se pudo enviar el mensaje. Revise su conexión e inténtelo nuevamente." }
  }
  const data = (await res.json().catch(() => null)) as { error?: unknown; aviso?: unknown } | null
  if (!res.ok) {
    return { ok: false, error: typeof data?.error === "string" && data.error ? data.error : "No se pudo enviar el mensaje. Inténtelo nuevamente." }
  }
  return { ok: true, ...(typeof data?.aviso === "string" ? { aviso: data.aviso } : {}) }
}

/** "a@x.example, Ana <b@x.example>; c@x.example" -> lista (conserva "Nombre <mail>"). */
export function parseDestinatarios(texto: string): string[] {
  const salida: string[] = []
  let actual = ""
  let enAngulo = false
  for (const c of texto) {
    if (c === "<") enAngulo = true
    if (c === ">") enAngulo = false
    if (!enAngulo && (c === "," || c === ";" || c === "\n")) {
      if (actual.trim()) salida.push(actual.trim())
      actual = ""
    } else actual += c
  }
  if (actual.trim()) salida.push(actual.trim())
  // Direcciones sueltas separadas solo por espacios: "a@x.example b@x.example".
  return salida.flatMap((p) => (p.includes("<") ? [p] : p.split(/\s+/).filter(Boolean)))
}

const FACTOR_BASE64 = 1.37

/** Mensaje de error si el archivo no puede adjuntarse; null si está bien. `yaCargados` = tamaños. */
export function validarAdjuntoCliente(archivo: { name: string; size: number }, yaCargados: number[]): string | null {
  const ext = extensionBloqueada(archivo.name)
  if (ext) return `No se permite adjuntar archivos .${ext}.`
  if (archivo.size <= 0) return "El archivo está vacío."
  const total = yaCargados.reduce((s, n) => s + n, 0) + archivo.size
  if (total * FACTOR_BASE64 > MAX_MAIL_BYTES) return "Los adjuntos superan el máximo de 40 MB."
  return null
}
