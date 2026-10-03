import { MAX_DESTINATARIOS, extensionBloqueada, type ModoEnvio } from "@/lib/correo-compose"
import { esIdResend } from "@/lib/correo-lectura"

// Validación de la forma de los cuerpos JSON de las rutas de envío. Solo forma y límites: las
// reglas de negocio (destinatarios válidos, tope de 40 MB, tipos bloqueados) las aplica
// `armarEnvio` en el servidor.

export type ParseResult<T> = { ok: true; valor: T } | { ok: false; error: string }

const MODOS: ModoEnvio[] = ["responder", "responderATodos", "reenviar", "nuevo"]
const MAX_TEXTO = 200_000
const MAX_ASUNTO = 300
const MAX_ADJUNTOS = 20
const MAX_NOMBRE = 200
const INVALIDO = "Los datos enviados no son válidos."
const CLAVE_IDEMPOTENCIA = /^[A-Za-z0-9_-]{8,128}$/
const TIPO_MIME = /^[A-Za-z0-9!#$&^_.+-]{1,60}\/[A-Za-z0-9!#$&^_.+-]{1,100}$/

const esObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

function listaDeTextos(v: unknown): string[] | null {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.length > MAX_DESTINATARIOS * 2 || !v.every((x) => typeof x === "string" && x.length <= 320)) return null
  return v as string[]
}

export interface SubidaBody {
  casillaId: string
  nombre: string
  tamano: number
  tipo: string
}

export function parseSubidaBody(body: unknown): ParseResult<SubidaBody> {
  if (!esObjeto(body)) return { ok: false, error: INVALIDO }
  const nombre = typeof body.nombre === "string" ? body.nombre.trim() : ""
  if (!nombre || nombre.length > MAX_NOMBRE) return { ok: false, error: "Indique el nombre del archivo." }
  const ext = extensionBloqueada(nombre)
  if (ext) return { ok: false, error: `No se permite adjuntar archivos .${ext}.` }
  const tamano = body.tamano
  if (typeof tamano !== "number" || !Number.isInteger(tamano) || tamano <= 0) return { ok: false, error: "El archivo está vacío o no es válido." }
  const tipoCrudo = typeof body.tipo === "string" ? body.tipo.trim().toLowerCase() : ""
  const tipo = TIPO_MIME.test(tipoCrudo) ? tipoCrudo : "application/octet-stream"
  return { ok: true, valor: { casillaId: typeof body.casillaId === "string" ? body.casillaId : "", nombre, tamano, tipo } }
}

export interface EnvioBody {
  casillaId: string
  modo: ModoEnvio
  hiloId?: string
  mensajeId?: string
  para: string[]
  cc: string[]
  cco: string[]
  asunto: string
  texto: string
  adjuntos: { key: string; nombre: string }[]
  reenviarAdjuntos: boolean
  claveIdempotencia?: string
}

export function parseEnvioBody(body: unknown): ParseResult<EnvioBody> {
  if (!esObjeto(body)) return { ok: false, error: INVALIDO }
  if (!MODOS.includes(body.modo as ModoEnvio)) return { ok: false, error: INVALIDO }
  const modo = body.modo as ModoEnvio
  const para = listaDeTextos(body.para)
  const cc = listaDeTextos(body.cc)
  const cco = listaDeTextos(body.cco)
  if (!para || !cc || !cco) return { ok: false, error: "Revise las direcciones de correo ingresadas." }
  const asunto = typeof body.asunto === "string" ? body.asunto : ""
  const texto = typeof body.texto === "string" ? body.texto : ""
  if (asunto.length > MAX_ASUNTO) return { ok: false, error: "El asunto es demasiado largo." }
  if (texto.length > MAX_TEXTO) return { ok: false, error: "El mensaje es demasiado largo." }

  let hiloId: string | undefined
  let mensajeId: string | undefined
  if (modo !== "nuevo") {
    hiloId = typeof body.hiloId === "string" ? body.hiloId : ""
    mensajeId = typeof body.mensajeId === "string" ? body.mensajeId : ""
    if (!esIdResend(hiloId) || !esIdResend(mensajeId)) return { ok: false, error: "Indique el mensaje que desea responder o reenviar." }
  }

  const crudos = body.adjuntos === undefined ? [] : body.adjuntos
  if (!Array.isArray(crudos) || crudos.length > MAX_ADJUNTOS) return { ok: false, error: "Hay demasiados archivos adjuntos." }
  const adjuntos: { key: string; nombre: string }[] = []
  for (const a of crudos) {
    if (!esObjeto(a) || typeof a.key !== "string" || typeof a.nombre !== "string") return { ok: false, error: INVALIDO }
    const nombre = a.nombre.trim()
    if (!nombre || nombre.length > MAX_NOMBRE) return { ok: false, error: INVALIDO }
    adjuntos.push({ key: a.key, nombre })
  }

  const clave = typeof body.claveIdempotencia === "string" && CLAVE_IDEMPOTENCIA.test(body.claveIdempotencia) ? body.claveIdempotencia : undefined
  return {
    ok: true,
    valor: {
      casillaId: typeof body.casillaId === "string" ? body.casillaId : "",
      modo,
      hiloId,
      mensajeId,
      para,
      cc,
      cco,
      asunto,
      texto,
      adjuntos,
      reenviarAdjuntos: body.reenviarAdjuntos === true,
      claveIdempotencia: clave,
    },
  }
}
