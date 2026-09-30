import { describe, expect, it } from "vitest"
import { normalizarIdentificador } from "./identificador"

describe("normalizarIdentificador", () => {
  it("pasa a minúsculas", () => expect(normalizarIdentificador("Mar")).toBe("mar"))
  it("reemplaza cada espacio por un guion", () => expect(normalizarIdentificador("mar del plata")).toBe("mar-del-plata"))
  it("no cambia lo que ya es válido", () => expect(normalizarIdentificador("igz-2")).toBe("igz-2"))
  it("un espacio al final queda como guion (se sigue escribiendo)", () => expect(normalizarIdentificador("mar ")).toBe("mar-"))
  it("vacío sigue vacío", () => expect(normalizarIdentificador("")).toBe(""))
})
