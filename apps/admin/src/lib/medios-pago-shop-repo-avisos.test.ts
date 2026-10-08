import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { conAvisos, type MedioPagoDto } from "@/lib/medios-pago-shop-repo"
import { vaciarCacheDeInteresMP } from "@/lib/mercadopago-planes-aviso"

// conAvisos suma el aviso de cuotas sin interés vs. Mercado Pago. Sin listas enlazadas no toca la base;
// Mercado Pago se simula con fetch. Clave de ejemplo, sin datos reales.

const medio = (parcial: Partial<MedioPagoDto>): MedioPagoDto => ({
  slug: "mercadopago",
  nombre: "Mercado Pago",
  instrucciones: "",
  activo: true,
  aplicaRetiro: true,
  aplicaEnvio: true,
  cobroOnline: true,
  orden: 0,
  listaOnlineId: null,
  listaOnlineNombre: null,
  listaOnlineActiva: false,
  condicionesCuotas: [{ cuotas: 6, montoMinimo: null, listaId: "l1", listaNombre: "Lista 6", listaActiva: true }],
  destacarEnCatalogo: false,
  mostrarEnFicha: false,
  audiencia: "publico",
  chips: [],
  opcionesCobro: ["credito", "debito", "cuenta_mp"],
  ...parcial,
})

const ok = (cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status: 200 })
const planes = (tasa6: number) => [{ payment_type_id: "credit_card", payer_costs: [{ installments: 3, installment_rate: 0 }, { installments: 6, installment_rate: tasa6 }] }]

describe("conAvisos: cuotas sin interés vs Mercado Pago", () => {
  beforeEach(() => {
    vaciarCacheDeInteresMP()
    vi.stubEnv("MP_PUBLIC_KEY", "APP_USR-clave-ejemplo")
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("avisa cuando Mercado Pago cobra interés en una cantidad configurada sin interés", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (u: URL) => ok(planes(u.searchParams.get("payment_method_id") === "naranja" ? 40 : 0))))
    const [m] = await conAvisos("t1", [medio({})])
    expect(m.avisos).toEqual([
      "En Mercado Pago, 6 cuotas tienen interés con Naranja. Márquelas sin interés en el panel de Mercado Pago o el cliente pagará interés encima.",
    ])
  })

  it("tasa 0 en todas las marcas: sin aviso", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ok(planes(0))))
    const [m] = await conAvisos("t1", [medio({})])
    expect(m.avisos).toEqual([])
  })

  it("sin MP_PUBLIC_KEY: sin aviso y sin llamar a Mercado Pago", async () => {
    vi.stubEnv("MP_PUBLIC_KEY", "")
    const f = vi.fn()
    vi.stubGlobal("fetch", f)
    const [m] = await conAvisos("t1", [medio({})])
    expect(m.avisos).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })

  it("Mercado Pago caído: sin aviso y sin error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")))
    const [m] = await conAvisos("t1", [medio({})])
    expect(m.avisos).toEqual([])
  })

  it("sin cuotas sin interés configuradas no consulta", async () => {
    const f = vi.fn()
    vi.stubGlobal("fetch", f)
    await conAvisos("t1", [medio({ condicionesCuotas: [] })])
    expect(f).not.toHaveBeenCalled()
  })

  it("consulta con el mayor mínimo configurado como monto de referencia", async () => {
    const f = vi.fn().mockImplementation(async () => ok(planes(0)))
    vi.stubGlobal("fetch", f)
    await conAvisos("t1", [
      medio({ condicionesCuotas: [{ cuotas: 12, montoMinimo: "250000.50", listaId: "l1", listaNombre: "L", listaActiva: true }] }),
    ])
    expect((f.mock.calls[0][0] as URL).searchParams.get("amount")).toBe("250001")
  })
})
