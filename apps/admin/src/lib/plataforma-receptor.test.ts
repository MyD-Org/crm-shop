import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHmac } from "node:crypto"

// La transacción la abre el repo: acá se simula pasando un tx de mentira para ver que llega a cada escritura.
const TX = vi.hoisted(() => ({ tx: true }))
const repo = vi.hoisted(() => ({
  enTransaccion: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX)),
  registrarEntrega: vi.fn(async () => true),
  upsertProyeccion: vi.fn(async (): Promise<"escrita" | "vieja"> => "escrita"),
  upsertSpecProyectada: vi.fn(async (): Promise<"escrita" | "vieja"> => "escrita"),
}))
vi.mock("@/lib/plataforma-proyeccion-repo", () => repo)

import { firmaValida, procesarEvento } from "./plataforma-receptor"

const secret = "ab".repeat(32)
const firmar = (body: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex")
const evento = (action: string, payload: unknown) => ({ id: "e1", account_id: "a", source: "entity", action, resource: "r", actor: "app:crm", occurred_at: "2026-10-15T12:00:00Z", version: 1, payload })
const inst = (data: unknown, updated_at = "2026-10-15T12:00:00Z") => ({ instance: { id: "i", spec: "atributos_tecnicos", spec_version: 1, external_key: "42", data, anchors: {}, updated_at } })

describe("firmaValida", () => {
  it("acepta la firma correcta y rechaza largo distinto, header ausente o firma alterada", () => {
    const body = JSON.stringify({ a: 1 })
    expect(firmaValida(secret, body, firmar(body))).toBe(true)
    expect(firmaValida(secret, body, null)).toBe(false)
    expect(firmaValida(secret, body, "sha256=abc")).toBe(false)
    expect(firmaValida(secret, body, firmar(body).replace(/.$/, (c) => (c === "0" ? "1" : "0")))).toBe(false)
  })
})

describe("procesarEvento", () => {
  beforeEach(() => { repo.enTransaccion.mockClear(); repo.registrarEntrega.mockClear(); repo.upsertProyeccion.mockClear(); repo.upsertSpecProyectada.mockClear() })

  it("atributos_tecnicos:update → upsert de la proyección con updated_at del payload", async () => {
    const r = await procesarEvento("central-led", "d1", evento("atributos_tecnicos:update", { instance: { id: "i1", spec: "atributos_tecnicos", spec_version: 1, external_key: "42", data: { ip: { n: 65, t: null }, fuentes: { ip: "pdf" } }, anchors: {}, updated_at: "2026-10-15T12:00:00.000Z" } }))
    expect(r).toBe("procesado")
    expect(repo.upsertProyeccion).toHaveBeenCalledWith("central-led", "atributos_tecnicos", "42", "i1", { ip: { n: 65, t: null }, fuentes: { ip: "pdf" } }, new Date("2026-10-15T12:00:00.000Z"), TX)
    expect(repo.registrarEntrega).toHaveBeenCalledWith("central-led", "d1", "e1", "atributos_tecnicos:update", TX)
    expect(repo.enTransaccion).toHaveBeenCalledTimes(1)
  })
  it("una entrega repetida no escribe", async () => {
    repo.registrarEntrega.mockResolvedValueOnce(false)
    expect(await procesarEvento("central-led", "d1", evento("atributos_tecnicos:update", inst({})))).toBe("repetido")
    expect(repo.upsertProyeccion).not.toHaveBeenCalled()
  })
  it("una entrega vieja devuelve 'viejo' (el repo no pisó)", async () => {
    repo.upsertProyeccion.mockResolvedValueOnce("vieja")
    expect(await procesarEvento("central-led", "d2", evento("atributos_tecnicos:update", inst({}, "2026-10-15T11:00:00Z")))).toBe("viejo")
  })
  it("spec:update → upsert de la spec; otra acción → ignorado", async () => {
    expect(await procesarEvento("central-led", "d3", evento("spec:update", { slug: "atributos_tecnicos", spec: { slug: "atributos_tecnicos", version: 2, fields: {} } }))).toBe("procesado")
    expect(repo.upsertSpecProyectada).toHaveBeenCalledWith("central-led", "atributos_tecnicos", 2, { slug: "atributos_tecnicos", version: 2, fields: {} }, TX)
    expect(await procesarEvento("central-led", "d4", evento("producto:create", { instance: {} }))).toBe("ignorado")
  })

  it("si la escritura falla, el error sale de la transacción (que deshace el registro de la entrega)", async () => {
    repo.upsertProyeccion.mockRejectedValueOnce(new Error("db"))
    await expect(procesarEvento("central-led", "d11", evento("atributos_tecnicos:update", inst({})))).rejects.toThrow("db")
    repo.upsertSpecProyectada.mockRejectedValueOnce(new Error("db2"))
    await expect(procesarEvento("central-led", "d12", evento("spec:update", { slug: "atributos_tecnicos", spec: { version: 2 } }))).rejects.toThrow("db2")
    expect(repo.registrarEntrega).toHaveBeenCalledTimes(2)
    for (const c of repo.registrarEntrega.mock.calls as unknown[][]) expect(c[4]).toBe(TX)
  })
  it("spec:update con versión vieja → viejo; slug del spec distinto del payload → ignorado", async () => {
    repo.upsertSpecProyectada.mockResolvedValueOnce("vieja")
    expect(await procesarEvento("central-led", "d15", evento("spec:update", { slug: "atributos_tecnicos", spec: { slug: "atributos_tecnicos", version: 1 } }))).toBe("viejo")
    repo.upsertSpecProyectada.mockClear()
    expect(await procesarEvento("central-led", "d16", evento("spec:update", { slug: "atributos_tecnicos", spec: { slug: "otra", version: 3 } }))).toBe("ignorado")
    expect(repo.upsertSpecProyectada).not.toHaveBeenCalled()
  })
  it("instance.id ausente o no string → ignorado", async () => {
    const sinId = { instance: { ...inst({}).instance, id: undefined } }
    expect(await procesarEvento("central-led", "d14", evento("atributos_tecnicos:update", sinId))).toBe("ignorado")
    expect(repo.upsertProyeccion).not.toHaveBeenCalled()
  })

  describe("validación de forma (la vista jsonb_each/numeric no tolera filas malformadas)", () => {
    beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}) })
    it("data como array → ignorado sin proyectar", async () => {
      expect(await procesarEvento("central-led", "d5", evento("atributos_tecnicos:update", inst([1, 2])))).toBe("ignorado")
      expect(repo.upsertProyeccion).not.toHaveBeenCalled()
    })
    it("n no numérico → ignorado sin proyectar", async () => {
      expect(await procesarEvento("central-led", "d6", evento("atributos_tecnicos:update", inst({ ip: { n: "abc", t: null } })))).toBe("ignorado")
      expect(repo.upsertProyeccion).not.toHaveBeenCalled()
    })
    it("t no string, entrada no objeto o updated_at inválido → ignorado", async () => {
      expect(await procesarEvento("central-led", "d7", evento("atributos_tecnicos:update", inst({ ip: { n: 1, t: 5 } })))).toBe("ignorado")
      expect(await procesarEvento("central-led", "d8", evento("atributos_tecnicos:update", inst({ ip: "x" })))).toBe("ignorado")
      expect(await procesarEvento("central-led", "d9", evento("atributos_tecnicos:update", inst({}, "no-fecha")))).toBe("ignorado")
      expect(repo.upsertProyeccion).not.toHaveBeenCalled()
    })
    it("datos válidos (n/t nulos o ausentes, fuentes intacta) siguen procesándose", async () => {
      expect(await procesarEvento("central-led", "d10", evento("atributos_tecnicos:update", inst({ a: { n: null, t: "x" }, b: {}, fuentes: "lo-que-sea" })))).toBe("procesado")
      expect(repo.upsertProyeccion).toHaveBeenCalledTimes(1)
    })
  })
})
