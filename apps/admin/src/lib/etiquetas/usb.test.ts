import { describe, expect, it, vi } from "vitest"
import {
  buscarSalida,
  conectar,
  enviar,
  ErrorImpresora,
  MENSAJES_IMPRESORA,
  PID,
  TAMANIO_TROZO,
  trabajoPrueba,
  traducirError,
  trozos,
  VID,
  type UsbApiMin,
  type UsbConfiguracionMin,
  type UsbDispositivoMin,
  type UsbResultadoSalida,
} from "./usb"

const CONFIG: UsbConfiguracionMin = {
  interfaces: [{ interfaceNumber: 0, alternate: { endpoints: [{ endpointNumber: 1, direction: "in" }, { endpointNumber: 3, direction: "out" }] } }],
}

function domError(name: string): Error {
  const e = new Error(name)
  e.name = name
  return e
}

function doble(opciones: {
  configuration?: UsbConfiguracionMin | null
  transferOut?: (n: number, d: Uint8Array) => Promise<UsbResultadoSalida>
  claimInterface?: () => Promise<void>
  vendorId?: number
} = {}) {
  const enviados: Uint8Array[] = []
  const d = {
    vendorId: opciones.vendorId ?? VID,
    productId: PID,
    configuration: opciones.configuration === undefined ? CONFIG : opciones.configuration,
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    selectConfiguration: vi.fn(async function (this: void) {
      d.configuration = CONFIG
    }),
    claimInterface: vi.fn(opciones.claimInterface ?? (async () => {})),
    releaseInterface: vi.fn(async () => {}),
    transferOut: vi.fn(async (n: number, datos: Uint8Array) => {
      if (opciones.transferOut) return opciones.transferOut(n, datos)
      enviados.push(datos.slice())
      return { status: "ok" as const, bytesWritten: datos.length }
    }),
  }
  return { d: d satisfies UsbDispositivoMin, enviados }
}

function datosDe(n: number): Uint8Array<ArrayBuffer> {
  const a = new Uint8Array(n)
  for (let i = 0; i < n; i++) a[i] = i % 251
  return a
}

describe("enviar", () => {
  it("120 KB salen en trozos de a lo sumo 16 KB, en orden, y la concatenación es el original", async () => {
    const { d, enviados } = doble()
    const datos = datosDe(120 * 1024)
    const progreso: number[] = []
    await enviar(d, datos, { alProgreso: (e) => progreso.push(e) })

    expect(enviados.length).toBe(Math.ceil(datos.length / TAMANIO_TROZO))
    expect(enviados.every((t) => t.length <= TAMANIO_TROZO)).toBe(true)
    expect(enviados.at(-1)!.length).toBeLessThan(TAMANIO_TROZO)
    const unido = new Uint8Array(enviados.reduce((n, t) => n + t.length, 0))
    let o = 0
    for (const t of enviados) {
      unido.set(t, o)
      o += t.length
    }
    expect(unido).toEqual(datos)
    expect(d.transferOut.mock.calls.every(([ep]) => ep === 3)).toBe(true)
    expect(progreso.at(-1)).toBe(datos.length)
    expect(d.claimInterface).toHaveBeenCalledWith(0)
    expect(d.releaseInterface).toHaveBeenCalledWith(0)
    expect(d.close).toHaveBeenCalled()
  })

  it("0 bytes: no toca el dispositivo ni falla", async () => {
    const { d } = doble()
    await enviar(d, new Uint8Array(0))
    expect(d.open).not.toHaveBeenCalled()
    expect(d.transferOut).not.toHaveBeenCalled()
  })

  it("selectConfiguration sólo cuando no hay configuración activa", async () => {
    const con = doble()
    await enviar(con.d, datosDe(10))
    expect(con.d.selectConfiguration).not.toHaveBeenCalled()

    const sin = doble({ configuration: null })
    await enviar(sin.d, datosDe(10))
    expect(sin.d.selectConfiguration).toHaveBeenCalledWith(1)
    expect(sin.d.transferOut).toHaveBeenCalledTimes(1)
  })

  it("rechazo en el 3.er trozo: corta, informa interrupción, no reintenta y libera", async () => {
    let n = 0
    const { d } = doble({
      transferOut: async (_e, datos) => {
        n++
        if (n === 3) throw domError("NetworkError")
        return { status: "ok", bytesWritten: datos.length }
      },
    })
    const err = await enviar(d, datosDe(5 * TAMANIO_TROZO)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ErrorImpresora)
    expect((err as ErrorImpresora).codigo).toBe("transferencia")
    expect((err as ErrorImpresora).message).toBe(MENSAJES_IMPRESORA.transferencia)
    expect(d.transferOut).toHaveBeenCalledTimes(3)
    expect(d.releaseInterface).toHaveBeenCalled()
    expect(d.close).toHaveBeenCalled()
  })

  it("status distinto de ok corta el envío", async () => {
    const { d } = doble({ transferOut: async () => ({ status: "stall", bytesWritten: 0 }) })
    const err = await enviar(d, datosDe(3 * TAMANIO_TROZO)).catch((e: unknown) => e)
    expect((err as ErrorImpresora).codigo).toBe("transferencia")
    expect(d.transferOut).toHaveBeenCalledTimes(1)
  })

  it("claimInterface rechazado: mensaje de acceso, sin transferir, cierra igual", async () => {
    for (const nombre of ["NetworkError", "SecurityError"]) {
      const { d } = doble({ claimInterface: async () => Promise.reject(domError(nombre)) })
      const err = await enviar(d, datosDe(10)).catch((e: unknown) => e)
      expect((err as ErrorImpresora).codigo, nombre).toBe("ocupada")
      expect((err as ErrorImpresora).message).toBe(MENSAJES_IMPRESORA.ocupada)
      expect(d.transferOut).not.toHaveBeenCalled()
      expect(d.releaseInterface).not.toHaveBeenCalled()
      expect(d.close).toHaveBeenCalled()
    }
  })
})

describe("conectar", () => {
  function api(previos: UsbDispositivoMin[], requestDevice: UsbApiMin["requestDevice"]) {
    return { getDevices: vi.fn(async () => previos), requestDevice: vi.fn(requestDevice) }
  }

  it("usa getDevices antes que requestDevice", async () => {
    const { d } = doble()
    const a = api([d], async () => d)
    expect(await conectar(a)).toBe(d)
    expect(a.requestDevice).not.toHaveBeenCalled()
  })

  it("sin autorizados, abre el selector filtrado por VID/PID", async () => {
    const { d } = doble()
    const otro = doble({ vendorId: 0x1234 }).d
    const a = api([otro], async () => d)
    expect(await conectar(a)).toBe(d)
    expect(a.requestDevice).toHaveBeenCalledWith({ filters: [{ vendorId: 0x0416, productId: 0x5011 }] })
  })

  it("cancelar el selector no es error", async () => {
    const a = api([], async () => Promise.reject(domError("NotFoundError")))
    expect(await conectar(a)).toBeNull()
  })
})

describe("traducirError", () => {
  it("mapea los DOMException de WebUSB a mensajes en usted", () => {
    expect(traducirError(domError("NotFoundError")).message).toBe(
      "No se encontró la impresora. Verifique que esté encendida y conectada por USB.",
    )
    expect(traducirError(domError("NetworkError")).message).toBe(
      "No se pudo acceder a la impresora. Cierre otros programas que la estén usando e inténtelo nuevamente.",
    )
    expect(traducirError(domError("SecurityError")).codigo).toBe("ocupada")
    expect(traducirError(new Error("x")).codigo).toBe("desconocido")
    const propio = new ErrorImpresora("transferencia")
    expect(traducirError(propio)).toBe(propio)
  })
})

describe("auxiliares", () => {
  it("buscarSalida encuentra la interfaz con endpoint OUT", () => {
    expect(buscarSalida(CONFIG)).toEqual({ interfaz: 0, endpoint: 3 })
    expect(buscarSalida(null)).toBeNull()
  })

  it("trozos con tamaño exacto no deja un trozo vacío", () => {
    expect(trozos(datosDe(2 * TAMANIO_TROZO)).map((t) => t.length)).toEqual([TAMANIO_TROZO, TAMANIO_TROZO])
  })

  it("trabajoPrueba: una etiqueta con texto y barras para cada rollo", () => {
    const chico = new TextDecoder().decode(trabajoPrueba("chico"))
    expect(chico).toContain("SIZE 100 mm,20 mm\r\nGAP 2 mm,0 mm")
    expect(chico).toContain('TEXT 32,20,"2",0,1,1,"PRUEBA"')
    expect(chico).toMatch(/BAR \d+,46,\d,64/)
    expect(chico.match(/PRINT 1,1/g)).toHaveLength(1)
    expect(chico.endsWith("PRINT 1,1\r\n")).toBe(true)

    const grande = new TextDecoder().decode(trabajoPrueba("grande"))
    expect(grande).toContain("SIZE 100 mm,150 mm\r\nGAP 3 mm,0 mm")
    expect(grande).toContain("DENSITY 10")
    expect(grande.match(/PRINT 1,1/g)).toHaveLength(1)
  })
})
