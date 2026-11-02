import { describe, expect, it } from "vitest"
import {
  base32Decode,
  base32Encode,
  cifrarSecreto,
  codigoDelPaso,
  descifrarSecreto,
  generarCodigosRespaldo,
  generarSecreto,
  hashCodigoRespaldo,
  pareceCodigoRespaldo,
  pasoActual,
  uriOtpauth,
  verificarTotp,
} from "./admin-totp"

// Vectores de la RFC 6238 (apéndice B), SHA-1, secreto ASCII "12345678901234567890", 8 dígitos.
// Usamos 6 dígitos: son los últimos 6 del valor de 8.
const SECRETO_RFC = base32Encode(Buffer.from("12345678901234567890"))
const VECTORES: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
]

describe("admin-totp", () => {
  it("base32 ida y vuelta", () => {
    const buf = Buffer.from("hola, mundo!!")
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true)
  })

  it.each(VECTORES)("RFC 6238 en t=%i", (t, esperado8) => {
    expect(codigoDelPaso(SECRETO_RFC, pasoActual(t * 1000))).toBe(esperado8.slice(-6))
  })

  it("acepta el paso anterior y el siguiente, no más", () => {
    const ahora = 1_800_000_000_000
    const paso = pasoActual(ahora)
    expect(verificarTotp(SECRETO_RFC, codigoDelPaso(SECRETO_RFC, paso), ahora)).toBe(paso)
    expect(verificarTotp(SECRETO_RFC, codigoDelPaso(SECRETO_RFC, paso - 1), ahora)).toBe(paso - 1)
    expect(verificarTotp(SECRETO_RFC, codigoDelPaso(SECRETO_RFC, paso + 1), ahora)).toBe(paso + 1)
    expect(verificarTotp(SECRETO_RFC, codigoDelPaso(SECRETO_RFC, paso - 2), ahora)).toBeNull()
  })

  it("tolera espacios y rechaza largos incorrectos", () => {
    const ahora = 1_800_000_000_000
    const c = codigoDelPaso(SECRETO_RFC, pasoActual(ahora))
    expect(verificarTotp(SECRETO_RFC, `${c.slice(0, 3)} ${c.slice(3)}`, ahora)).not.toBeNull()
    expect(verificarTotp(SECRETO_RFC, c.slice(0, 5), ahora)).toBeNull()
    expect(verificarTotp(SECRETO_RFC, "", ahora)).toBeNull()
  })

  it("cifra y descifra el secreto; un cifrado alterado falla", () => {
    const s = generarSecreto()
    const c = cifrarSecreto(s)
    expect(c).not.toContain(s)
    expect(descifrarSecreto(c)).toBe(s)
    const partes = c.split(":")
    partes[3] = Buffer.from("otra-cosa").toString("base64url")
    expect(() => descifrarSecreto(partes.join(":"))).toThrow()
  })

  it("códigos de respaldo: únicos, formato y hash independiente de guiones y mayúsculas", () => {
    const { codigos, hashes } = generarCodigosRespaldo()
    expect(codigos).toHaveLength(10)
    expect(new Set(codigos).size).toBe(10)
    for (const c of codigos) expect(c).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/)
    expect(hashCodigoRespaldo(codigos[0].toLowerCase().replace("-", ""))).toBe(hashes[0])
    expect(pareceCodigoRespaldo(codigos[0])).toBe(true)
    expect(pareceCodigoRespaldo("123456")).toBe(false)
  })

  it("arma la URI otpauth", () => {
    const uri = uriOtpauth("ABCDEF", "Empresa Ejemplo", "persona@cliente.example")
    expect(uri.startsWith("otpauth://totp/Empresa%20Ejemplo%3Apersona%40cliente.example?")).toBe(true)
    expect(uri).toContain("secret=ABCDEF")
    expect(uri).toContain("issuer=Empresa+Ejemplo")
  })
})
