import { describe, expect, it, vi } from "vitest"
import {
  crearClavesIdempotencia,
  crearEnvioUnico,
  enviarCorreo,
  parseDestinatarios,
  validarAdjuntoCliente,
} from "@/lib/correo-envio-cliente"

const MB = 1024 * 1024

describe("crearEnvioUnico (sin doble envío)", () => {
  it("dos disparos seguidos hacen UN solo envío y comparten el resultado", async () => {
    let resolver!: (v: string) => void
    const fn = vi.fn(() => new Promise<string>((r) => (resolver = r)))
    const enviar = crearEnvioUnico(fn)
    const a = enviar()
    const b = enviar()
    expect(fn).toHaveBeenCalledTimes(1)
    resolver("ok")
    expect(await a).toBe("ok")
    expect(await b).toBe("ok")
  })
  it("terminado el envío (con éxito o error) se puede volver a enviar", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce("ok")
    const enviar = crearEnvioUnico(fn)
    await expect(enviar()).rejects.toThrow("x")
    await expect(enviar()).resolves.toBe("ok")
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe("crearClavesIdempotencia", () => {
  it("misma intención -> misma clave; si cambia el contenido, otra", () => {
    let n = 0
    const clave = crearClavesIdempotencia(() => `clave-${++n}-xxxxxxxx`)
    expect(clave("a")).toBe(clave("a"))
    const antes = clave("a")
    expect(clave("b")).not.toBe(antes)
  })
  it("reiniciar fuerza una clave nueva (tras un envío exitoso)", () => {
    let n = 0
    const claves = crearClavesIdempotencia(() => `clave-${++n}-xxxxxxxx`)
    const a = claves("a")
    claves.reiniciar()
    expect(claves("a")).not.toBe(a)
  })
})

describe("enviarCorreo", () => {
  it("éxito: devuelve el aviso del servidor", async () => {
    const fetchFn = vi.fn(async () => Response.json({ ok: true, id: "s1", aviso: "La respuesta podría no agruparse en la conversación." }))
    const r = await enviarCorreo(fetchFn as unknown as typeof fetch, { casillaId: "c" })
    expect(r).toEqual({ ok: true, aviso: "La respuesta podría no agruparse en la conversación." })
    expect(fetchFn).toHaveBeenCalledWith("/api/admin/correo/enviar", expect.objectContaining({ method: "POST" }))
  })
  it("error del servidor: devuelve el mensaje en usted y NO lanza (el borrador se conserva)", async () => {
    const fetchFn = async () => Response.json({ error: "El servicio de correo no está disponible. Inténtelo nuevamente en unos instantes." }, { status: 502 })
    const r = await enviarCorreo(fetchFn as unknown as typeof fetch, {})
    expect(r).toEqual({ ok: false, error: "El servicio de correo no está disponible. Inténtelo nuevamente en unos instantes." })
  })
  it("corte de red: mensaje genérico en usted", async () => {
    const r = await enviarCorreo((async () => { throw new TypeError("fail") }) as unknown as typeof fetch, {})
    expect(r).toEqual({ ok: false, error: "No se pudo enviar el mensaje. Revise su conexión e inténtelo nuevamente." })
  })
  it("respuesta no JSON con error: mensaje genérico", async () => {
    const r = await enviarCorreo((async () => new Response("<html>", { status: 500 })) as unknown as typeof fetch, {})
    expect(r).toEqual({ ok: false, error: "No se pudo enviar el mensaje. Inténtelo nuevamente." })
  })
})

describe("parseDestinatarios", () => {
  it("separa por coma, punto y coma, espacios y saltos", () => {
    expect(parseDestinatarios("a@x.example, b@x.example;c@x.example\nd@x.example  ")).toEqual(["a@x.example", "b@x.example", "c@x.example", "d@x.example"])
    expect(parseDestinatarios("")).toEqual([])
  })
  it("conserva 'Nombre <mail>' con su nombre", () => {
    expect(parseDestinatarios("Ana Prueba <a@x.example>, b@x.example")).toEqual(["Ana Prueba <a@x.example>", "b@x.example"])
  })
})

describe("validarAdjuntoCliente", () => {
  it("acepta un archivo normal", () => {
    expect(validarAdjuntoCliente({ name: "a.pdf", size: 1 * MB }, [])).toBeNull()
  })
  it("bloquea ejecutables", () => {
    expect(validarAdjuntoCliente({ name: "a.exe", size: 10 }, [])).toBe("No se permite adjuntar archivos .exe.")
  })
  it("vacío", () => {
    expect(validarAdjuntoCliente({ name: "a.pdf", size: 0 }, [])).toBe("El archivo está vacío.")
  })
  it("tope de 40 MB sumando los ya cargados", () => {
    expect(validarAdjuntoCliente({ name: "b.zip", size: 15 * MB }, [15 * MB])).toBe("Los adjuntos superan el máximo de 40 MB.")
    expect(validarAdjuntoCliente({ name: "b.zip", size: 10 * MB }, [10 * MB])).toBeNull()
  })
})
