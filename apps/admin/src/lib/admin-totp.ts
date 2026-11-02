// Verificación en dos pasos del backoffice: TOTP (RFC 6238) con una app autenticadora
// (Google Authenticator, Authy, 1Password…), más códigos de respaldo de un solo uso.
//
// Sólo funciones puras + node:crypto: la parte con base de datos está en admin-2fa.ts.
//
// Parámetros fijos y compatibles con todas las apps: HMAC-SHA1, 6 dígitos, paso de 30 s.
// Se acepta el paso actual y uno para cada lado (±30 s) por relojes desfasados.
//
// El secreto se guarda CIFRADO (AES-256-GCM). La clave sale por HKDF de `OTP_SECRET` (si está)
// o de `SESSION_SECRET`. OJO: rotar ese secreto deja inservibles todos los 2FA dados de alta
// (habría que restablecerlos desde Usuarios). Por eso conviene cargar `OTP_SECRET` aparte.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"
import { SESSION_SECRET } from "@/lib/session-secret"

export const TOTP_PASO_SEG = 30
export const TOTP_DIGITOS = 6
/** Pasos aceptados a cada lado del actual. */
export const TOTP_VENTANA = 1
export const CANTIDAD_CODIGOS_RESPALDO = 10

// ── Base32 (RFC 4648, sin padding), el formato que esperan las apps ──────────
const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let valor = 0
  let out = ""
  for (const byte of buf) {
    valor = (valor << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALFABETO[(valor >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALFABETO[(valor << (5 - bits)) & 31]
  return out
}

export function base32Decode(texto: string): Buffer {
  const limpio = texto.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "")
  let bits = 0
  let valor = 0
  const out: number[] = []
  for (const c of limpio) {
    const i = ALFABETO.indexOf(c)
    if (i < 0) throw new Error("base32 inválido")
    valor = (valor << 5) | i
    bits += 5
    if (bits >= 8) {
      out.push((valor >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** Secreto nuevo: 20 bytes (160 bits, lo que recomienda la RFC 4226), en base32. */
export function generarSecreto(): string {
  return base32Encode(randomBytes(20))
}

export function pasoActual(ahoraMs: number): number {
  return Math.floor(ahoraMs / 1000 / TOTP_PASO_SEG)
}

/** Código TOTP de un paso. */
export function codigoDelPaso(secretoBase32: string, paso: number): string {
  const contador = Buffer.alloc(8)
  contador.writeBigUInt64BE(BigInt(paso))
  const hmac = createHmac("sha1", base32Decode(secretoBase32)).update(contador).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binario =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3]
  return String(binario % 10 ** TOTP_DIGITOS).padStart(TOTP_DIGITOS, "0")
}

/** Deja sólo los dígitos ("123 456" → "123456"). */
export function normalizarCodigoTotp(codigo: string): string {
  return codigo.replace(/\D/g, "")
}

/**
 * Paso con el que coincide el código, o null. Quien llama guarda el paso y rechaza
 * cualquier paso <= al último usado (un código no vale dos veces).
 */
export function verificarTotp(secretoBase32: string, codigo: string, ahoraMs: number): number | null {
  const limpio = normalizarCodigoTotp(codigo)
  if (limpio.length !== TOTP_DIGITOS) return null
  const actual = pasoActual(ahoraMs)
  let encontrado: number | null = null
  // Recorre toda la ventana siempre (sin cortar al encontrar) para no variar el tiempo.
  for (let d = -TOTP_VENTANA; d <= TOTP_VENTANA; d++) {
    const esperado = codigoDelPaso(secretoBase32, actual + d)
    if (timingSafeEqual(Buffer.from(esperado), Buffer.from(limpio)) && encontrado === null) {
      encontrado = actual + d
    }
  }
  return encontrado
}

/** URI que codifica el QR (formato de Google Authenticator, lo entienden todas). */
export function uriOtpauth(secretoBase32: string, emisor: string, cuenta: string): string {
  const etiqueta = encodeURIComponent(`${emisor}:${cuenta}`)
  // encodeURIComponent y no URLSearchParams: este codifica el espacio como "+" y Google Authenticator
  // lo muestra literal ("Empresa+Ejemplo").
  const params = [
    `secret=${secretoBase32}`,
    `issuer=${encodeURIComponent(emisor)}`,
    "algorithm=SHA1",
    `digits=${TOTP_DIGITOS}`,
    `period=${TOTP_PASO_SEG}`,
  ].join("&")
  return `otpauth://totp/${etiqueta}?${params}`
}

// ── Cifrado del secreto en la base ───────────────────────────────────────────
function claveCifrado(): Buffer {
  const base = process.env.OTP_SECRET?.trim() || SESSION_SECRET
  return Buffer.from(hkdfSync("sha256", base, Buffer.alloc(0), "admin-totp-v1", 32))
}

/** `v1:<iv>:<tag>:<cifrado>` en base64url. */
export function cifrarSecreto(secretoBase32: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", claveCifrado(), iv)
  const cifrado = Buffer.concat([cipher.update(secretoBase32, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), cifrado.toString("base64url")].join(":")
}

export function descifrarSecreto(guardado: string): string {
  const [version, iv, tag, cifrado] = guardado.split(":")
  if (version !== "v1" || !iv || !tag || !cifrado) throw new Error("secreto 2FA con formato desconocido")
  const decipher = createDecipheriv("aes-256-gcm", claveCifrado(), Buffer.from(iv, "base64url"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(cifrado, "base64url")), decipher.final()]).toString("utf8")
}

// ── Códigos de respaldo ──────────────────────────────────────────────────────
// 10 caracteres de un alfabeto sin ambigüedades (sin 0/O, 1/I/L): ~50 bits cada uno, de un solo
// uso. Se guardan como SHA-256 (con esa entropía no hace falta un hash lento).
const ALFABETO_RESPALDO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

export function normalizarCodigoRespaldo(codigo: string): string {
  return codigo.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

export function hashCodigoRespaldo(codigo: string): string {
  return createHash("sha256").update(`admin-2fa-respaldo:${normalizarCodigoRespaldo(codigo)}`).digest("hex")
}

/** Códigos para mostrar UNA vez (formato "ABCDE-FGHJK") y sus hashes para guardar. */
export function generarCodigosRespaldo(cantidad = CANTIDAD_CODIGOS_RESPALDO): { codigos: string[]; hashes: string[] } {
  const codigos: string[] = []
  for (let i = 0; i < cantidad; i++) {
    let c = ""
    for (const b of randomBytes(10)) c += ALFABETO_RESPALDO[b % ALFABETO_RESPALDO.length]
    codigos.push(`${c.slice(0, 5)}-${c.slice(5)}`)
  }
  return { codigos, hashes: codigos.map(hashCodigoRespaldo) }
}

/** ¿Parece un código de respaldo (y no uno de la app)? */
export function pareceCodigoRespaldo(codigo: string): boolean {
  return /[A-Z]/i.test(codigo) && normalizarCodigoRespaldo(codigo).length === 10
}
