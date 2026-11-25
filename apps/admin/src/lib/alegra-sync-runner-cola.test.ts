import { beforeEach, describe, expect, it, vi } from "vitest"
import type { EventoProgreso, SyncTenantResult } from "./alegra-sync-tenant"
import type { TenantConfig } from "./tenants"

// correrSync limpia la cola de re-lectura sólo para las cuentas que ESTA corrida leyó enteras.

const { syncTenantMock, limpiarMock } = vi.hoisted(() => ({ syncTenantMock: vi.fn(), limpiarMock: vi.fn() }))
vi.mock("./alegra-sync-tenant", () => ({ syncTenant: syncTenantMock }))
vi.mock("./alegra-stock-cola", () => ({ limpiarColaCubiertaPorSync: limpiarMock }))

const { correrSync } = await import("./alegra-sync-runner")
const cfg = { id: "tenant-a" } as TenantConfig
const sinLog = () => {}

/** syncTenant que emite `eventos` y devuelve `r`. */
function sync(eventos: EventoProgreso[], r: SyncTenantResult) {
  syncTenantMock.mockImplementationOnce(async (_c: unknown, _t: unknown, o: { onProgreso: (e: EventoProgreso) => void }) => {
    for (const e of eventos) o.onProgreso(e)
    return r
  })
}
const ini = (cuenta: string): EventoProgreso => ({ tipo: "cuenta-inicio", cuenta })
const fin = (cuenta: string, ok = true): EventoProgreso => ({ tipo: "cuenta-fin", cuenta, ok, itemsSynced: 10 })

beforeEach(() => {
  syncTenantMock.mockReset()
  limpiarMock.mockReset()
  limpiarMock.mockResolvedValue(0)
})

describe("correrSync: limpieza de la cola", () => {
  it("principal y mdp enteras y bien → limpia las dos desde el inicio de la corrida", async () => {
    const antes = Date.now()
    sync([ini("principal"), fin("principal"), ini("mdp"), fin("mdp")], {
      ok: true, itemsSynced: 10, categoriesSynced: 1, cuentas: [{ ok: true, cuenta: "mdp", itemsSynced: 10, categoriesSynced: 0 }],
    })
    await correrSync([cfg], { log: sinLog })
    expect(limpiarMock).toHaveBeenCalledWith("tenant-a", { principal: true, slugs: ["mdp"] }, expect.any(Date))
    expect((limpiarMock.mock.calls[0][2] as Date).getTime()).toBeGreaterThanOrEqual(antes - 1)
  })

  it("falla mdp → limpia sólo la principal (aunque el resultado del tenant sea ok:false)", async () => {
    sync([ini("principal"), fin("principal"), ini("mdp"), fin("mdp", false)], {
      ok: false, itemsSynced: 10, categoriesSynced: 1, cuentas: [{ ok: false, cuenta: "mdp", itemsSynced: 0, categoriesSynced: 0 }],
    })
    await correrSync([cfg], { log: sinLog })
    expect(limpiarMock).toHaveBeenCalledWith("tenant-a", { principal: true, slugs: [] }, expect.any(Date))
  })

  it("principal parcial (la guarda frenó una baja) → no la limpia", async () => {
    sync([ini("principal"), fin("principal")], { ok: true, parcial: true, itemsSynced: 10, categoriesSynced: 1 })
    await correrSync([cfg], { log: sinLog })
    expect(limpiarMock).toHaveBeenCalledWith("tenant-a", { principal: false, slugs: [] }, expect.any(Date))
  })

  it("retoma un cursor con la principal ya leída antes → no limpia la principal", async () => {
    sync([ini("mdp"), fin("mdp")], {
      ok: true, itemsSynced: 10, categoriesSynced: 1, cuentas: [{ ok: true, cuenta: "mdp", itemsSynced: 10, categoriesSynced: 0 }],
    })
    await correrSync([cfg], { log: sinLog })
    expect(limpiarMock).toHaveBeenCalledWith("tenant-a", { principal: false, slugs: ["mdp"] }, expect.any(Date))
  })

  it("si limpiar falla, la sync no se entera", async () => {
    limpiarMock.mockRejectedValue(new Error("base caída"))
    sync([ini("principal"), fin("principal")], { ok: true, itemsSynced: 10, categoriesSynced: 1 })
    const { exitCode } = await correrSync([cfg], { log: sinLog })
    expect(exitCode).toBe(0)
  })
})
