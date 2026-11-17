/**
 * Cliente WebUSB de la impresora de etiquetas (VID 0x0416, PID 0x5011). Port del flujo de
 * `scripts/etiquetas/imprimir.ts` (interfaz 0, endpoint bulk OUT) al navegador.
 *
 * Tipos mínimos escritos a mano (sin `@types/w3c-web-usb`): son la parte de la API que se usa y
 * permiten inyectar un doble en los tests. Un trabajo colgado sólo se suelta apagando la
 * impresora, así que NO hay reintentos automáticos: ante un fallo se informa y la persona decide.
 */
import { ascii, cabeceraTspl, type OpcionesCabecera } from "./bitmap"
import { barras, code128b, PUNTOS_POR_MM } from "./code128"

export const VID = 0x0416
export const PID = 0x5011
/** 16 KB: múltiplo del paquete bulk (512 B en HS, 64 B en FS); el bitmap grande sale en 8 envíos. */
export const TAMANIO_TROZO = 16384

// ---------------------------------------------------------------------------
// Tipos mínimos de WebUSB
// ---------------------------------------------------------------------------

export interface UsbEndpointMin {
  endpointNumber: number
  direction: "in" | "out"
}

export interface UsbInterfazMin {
  interfaceNumber: number
  alternate: { endpoints: UsbEndpointMin[] }
}

export interface UsbConfiguracionMin {
  interfaces: UsbInterfazMin[]
}

export interface UsbResultadoSalida {
  status: "ok" | "stall" | "babble"
  bytesWritten: number
}

export interface UsbDispositivoMin {
  vendorId: number
  productId: number
  configuration: UsbConfiguracionMin | null
  open(): Promise<void>
  close(): Promise<void>
  selectConfiguration(valor: number): Promise<void>
  claimInterface(numero: number): Promise<void>
  releaseInterface(numero: number): Promise<void>
  transferOut(endpoint: number, datos: Uint8Array<ArrayBuffer>): Promise<UsbResultadoSalida>
}

export interface UsbApiMin {
  getDevices(): Promise<UsbDispositivoMin[]>
  requestDevice(opciones: { filters: { vendorId: number; productId: number }[] }): Promise<UsbDispositivoMin>
  addEventListener?(tipo: "connect" | "disconnect", oyente: (e: { device: UsbDispositivoMin }) => void): void
  removeEventListener?(tipo: "connect" | "disconnect", oyente: (e: { device: UsbDispositivoMin }) => void): void
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

export type CodigoErrorImpresora = "sin-webusb" | "ocupada" | "desconectada" | "transferencia" | "desconocido"

export const MENSAJES_IMPRESORA: Record<CodigoErrorImpresora, string> = {
  "sin-webusb":
    "Su navegador no permite imprimir por USB. Use Chrome o Edge en una computadora de escritorio, con conexión segura (HTTPS).",
  ocupada: "No se pudo acceder a la impresora. Cierre otros programas que la estén usando e inténtelo nuevamente.",
  desconectada: "No se encontró la impresora. Verifique que esté encendida y conectada por USB.",
  transferencia: "El envío a la impresora se interrumpió. Revise la impresora antes de volver a intentarlo.",
  desconocido: "No se pudo imprimir. Revise la impresora e inténtelo nuevamente.",
}

export const MENSAJE_PRUEBA_ENVIADA = "Prueba enviada a la impresora."

export class ErrorImpresora extends Error {
  readonly codigo: CodigoErrorImpresora
  constructor(codigo: CodigoErrorImpresora, opciones?: { cause?: unknown }) {
    super(MENSAJES_IMPRESORA[codigo], opciones)
    this.name = "ErrorImpresora"
    this.codigo = codigo
  }
}

function nombreError(e: unknown): string {
  return typeof e === "object" && e !== null && "name" in e ? String((e as { name: unknown }).name) : ""
}

/** Traduce un error de WebUSB (DOMException) a un `ErrorImpresora` con mensaje en usted. */
export function traducirError(e: unknown): ErrorImpresora {
  if (e instanceof ErrorImpresora) return e
  switch (nombreError(e)) {
    case "NotFoundError":
      return new ErrorImpresora("desconectada", { cause: e })
    case "NetworkError":
    case "SecurityError":
    case "InvalidStateError":
      return new ErrorImpresora("ocupada", { cause: e })
    default:
      return new ErrorImpresora("desconocido", { cause: e })
  }
}

// ---------------------------------------------------------------------------
// Soporte y conexión
// ---------------------------------------------------------------------------

/** La API WebUSB del navegador, o null (Safari, Firefox, móvil, contexto no seguro, servidor). */
export function obtenerApiUsb(): UsbApiMin | null {
  if (typeof navigator === "undefined") return null
  return (navigator as Navigator & { usb?: UsbApiMin }).usb ?? null
}

export function soportaWebUsb(): boolean {
  return obtenerApiUsb() !== null
}

function esLaImpresora(d: UsbDispositivoMin): boolean {
  return d.vendorId === VID && d.productId === PID
}

/** Impresora ya autorizada en este sitio (sin abrir el selector), o null. */
export async function dispositivoAutorizado(api: UsbApiMin): Promise<UsbDispositivoMin | null> {
  const dispositivos = await api.getDevices()
  return dispositivos.find(esLaImpresora) ?? null
}

/**
 * Reutiliza la impresora ya autorizada o, si no hay, abre el selector filtrado por VID/PID
 * (debe llamarse desde un gesto del usuario). Si la persona cancela el selector devuelve null:
 * no es un error.
 */
export async function conectar(api: UsbApiMin): Promise<UsbDispositivoMin | null> {
  try {
    const previo = await dispositivoAutorizado(api)
    if (previo) return previo
    return await api.requestDevice({ filters: [{ vendorId: VID, productId: PID }] })
  } catch (e) {
    if (nombreError(e) === "NotFoundError") return null
    throw traducirError(e)
  }
}

// ---------------------------------------------------------------------------
// Envío
// ---------------------------------------------------------------------------

/** Primera interfaz con un endpoint OUT (en esta impresora, la 0 con el endpoint 3). */
export function buscarSalida(config: UsbConfiguracionMin | null): { interfaz: number; endpoint: number } | null {
  for (const i of config?.interfaces ?? []) {
    const salida = i.alternate.endpoints.find((e) => e.direction === "out")
    if (salida) return { interfaz: i.interfaceNumber, endpoint: salida.endpointNumber }
  }
  return null
}

/** Parte los datos en trozos de a lo sumo `tamanio` bytes, en orden (vistas, sin copiar). */
export function trozos(datos: Uint8Array<ArrayBuffer>, tamanio = TAMANIO_TROZO): Uint8Array<ArrayBuffer>[] {
  const out: Uint8Array<ArrayBuffer>[] = []
  for (let i = 0; i < datos.length; i += tamanio) out.push(datos.subarray(i, i + tamanio))
  return out
}

export interface OpcionesEnvio {
  alProgreso?: (enviados: number, total: number) => void
  tamanioTrozo?: number
}

/**
 * Manda un trabajo completo: abre, elige la configuración 1 si no hay una activa, reclama la
 * interfaz con endpoint OUT y envía en trozos secuenciales. Siempre libera y cierra. Un trabajo
 * vacío no toca el dispositivo. Un fallo corta el envío y NO se reintenta.
 */
export async function enviar(
  disp: UsbDispositivoMin,
  datos: Uint8Array<ArrayBuffer>,
  { alProgreso, tamanioTrozo = TAMANIO_TROZO }: OpcionesEnvio = {},
): Promise<void> {
  if (datos.length === 0) return

  try {
    await disp.open()
  } catch (e) {
    throw traducirError(e)
  }

  let reclamada: number | null = null
  try {
    try {
      if (disp.configuration === null) await disp.selectConfiguration(1)
    } catch (e) {
      throw traducirError(e)
    }
    const salida = buscarSalida(disp.configuration)
    if (!salida) throw new ErrorImpresora("desconocido")
    try {
      await disp.claimInterface(salida.interfaz)
      reclamada = salida.interfaz
    } catch (e) {
      // Al reclamar, cualquier rechazo es "la tiene otro" (CUPS, driver de Windows, otra pestaña).
      throw nombreError(e) === "NotFoundError" ? traducirError(e) : new ErrorImpresora("ocupada", { cause: e })
    }

    let enviados = 0
    alProgreso?.(0, datos.length)
    for (const trozo of trozos(datos, tamanioTrozo)) {
      let resultado: UsbResultadoSalida
      try {
        resultado = await disp.transferOut(salida.endpoint, trozo)
      } catch (e) {
        throw new ErrorImpresora("transferencia", { cause: e })
      }
      if (resultado.status !== "ok") throw new ErrorImpresora("transferencia")
      enviados += trozo.length
      alProgreso?.(enviados, datos.length)
    }
  } finally {
    if (reclamada !== null) await disp.releaseInterface(reclamada).catch(() => {})
    await disp.close().catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Trabajo de prueba
// ---------------------------------------------------------------------------

export type RolloPrueba = "chico" | "grande"

export const ROLLOS_PRUEBA: { value: RolloPrueba; label: string }[] = [
  { value: "chico", label: "Rollo chico 29×20" },
  { value: "grande", label: "Rollo grande 100×150" },
]

const CABECERA_PRUEBA: Record<RolloPrueba, OpcionesCabecera> = {
  chico: { anchoMm: 100, altoMm: 20, gapMm: 2 },
  grande: { anchoMm: 100, altoMm: 150, gapMm: 3, densidad: 10 },
}

const TEXTO_PRUEBA = "PRUEBA"

/**
 * Trabajo mínimo para verificar la conexión: una sola etiqueta con texto y un código de barras.
 * En el rollo chico ocupa la primera etiqueta de la fila (x = 2 mm, como el trabajo 29x20).
 */
export function trabajoPrueba(rollo: RolloPrueba): Uint8Array<ArrayBuffer> {
  const patron = code128b(TEXTO_PRUEBA)
  const x = (rollo === "chico" ? 2 : 10) * PUNTOS_POR_MM
  const L = [cabeceraTspl(CABECERA_PRUEBA[rollo]) + "CLS"]
  L.push(`TEXT ${x + 16},20,"2",0,1,1,"${TEXTO_PRUEBA}"`)
  L.push(...barras(patron, x + 16, 46, 64).comandos)
  L.push("PRINT 1,1")
  return ascii(L.join("\r\n") + "\r\n") as Uint8Array<ArrayBuffer>
}
