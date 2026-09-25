import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// avisarShop: ping al Shop + registro de frescura. El registro es informativo: si la base falla,
// el aviso igual devuelve lo que pasó con el ping y no tira.

const { pingMock, registrarMock } = vi.hoisted(() => ({ pingMock: vi.fn(), registrarMock: vi.fn() }))
vi.mock("@/lib/shop-revalidar", () => ({ pingShopRevalidarCatalogo: pingMock }))
vi.mock("@/lib/catalogo-overlay-repo", () => ({ registrarAvisoShop: registrarMock }))

const { avisarShop } = await import("@/lib/aviso-shop")

beforeEach(() => {
  pingMock.mockReset()
  registrarMock.mockReset()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("avisarShop", () => {
  it("ping entregado → registra ok para el tenant y devuelve propagado", async () => {
    pingMock.mockResolvedValue({ propagado: true })
    registrarMock.mockResolvedValue(undefined)
    await expect(avisarShop("tenant-a")).resolves.toEqual({ propagado: true })
    expect(registrarMock).toHaveBeenCalledWith("tenant-a", true)
  })

  it("ping no entregado → registra el intento sin ok", async () => {
    pingMock.mockResolvedValue({ propagado: false })
    registrarMock.mockResolvedValue(undefined)
    await expect(avisarShop("tenant-a")).resolves.toEqual({ propagado: false })
    expect(registrarMock).toHaveBeenCalledWith("tenant-a", false)
  })

  it("el registro falla → no tira y devuelve lo del ping", async () => {
    pingMock.mockResolvedValue({ propagado: true })
    registrarMock.mockRejectedValue(new Error("db caída"))
    await expect(avisarShop("tenant-a")).resolves.toEqual({ propagado: true })
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("no se pudo registrar el aviso al Shop"))
  })
})
