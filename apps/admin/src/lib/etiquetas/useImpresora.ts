"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  conectar as conectarUsb,
  dispositivoAutorizado,
  enviar,
  ErrorImpresora,
  MENSAJE_PRUEBA_ENVIADA,
  MENSAJES_IMPRESORA,
  obtenerApiUsb,
  trabajoPrueba,
  traducirError,
  type RolloPrueba,
  type UsbDispositivoMin,
  PID,
  VID,
} from "./usb"

/**
 * - verificando: primer render (en el servidor no hay `navigator`), hasta mirar la API.
 * - sin-soporte: el navegador no tiene WebUSB.
 * - sin-conectar / conectada: hay o no una impresora autorizada.
 * - imprimiendo: envío en curso (no se acepta otro).
 * - error: el último intento falló; el mensaje queda en `error` y la persona decide si reintenta.
 */
export type EstadoImpresora = "verificando" | "sin-soporte" | "sin-conectar" | "conectada" | "imprimiendo" | "error"

export interface Progreso {
  enviados: number
  total: number
}

export function useImpresora() {
  const [estado, setEstado] = useState<EstadoImpresora>("verificando")
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [progreso, setProgreso] = useState<Progreso | null>(null)
  const dispositivo = useRef<UsbDispositivoMin | null>(null)
  // Espejo en estado de `dispositivo.current` para poder leerlo durante el render.
  const [conDispositivo, setConDispositivo] = useState(false)
  const fijarDispositivo = useCallback((d: UsbDispositivoMin | null) => {
    dispositivo.current = d
    setConDispositivo(d !== null)
  }, [])
  const enCurso = useRef(false)

  // Al montar: reutiliza la impresora ya autorizada sin abrir el selector, y sigue las
  // conexiones/desconexiones del cable.
  useEffect(() => {
    const api = obtenerApiUsb()
    let vigente = true
    void (async () => {
      if (!api) {
        setEstado("sin-soporte")
        return
      }
      const previo = await dispositivoAutorizado(api).catch(() => null)
      if (!vigente) return
      fijarDispositivo(previo)
      setEstado(previo ? "conectada" : "sin-conectar")
    })()
    if (!api?.addEventListener) return () => void (vigente = false)

    const alConectar = ({ device }: { device: UsbDispositivoMin }) => {
      if (device.vendorId !== VID || device.productId !== PID || enCurso.current) return
      fijarDispositivo(device)
      setEstado("conectada")
    }
    const alDesconectar = ({ device }: { device: UsbDispositivoMin }) => {
      if (device !== dispositivo.current || enCurso.current) return
      fijarDispositivo(null)
      setEstado("sin-conectar")
    }
    api.addEventListener("connect", alConectar)
    api.addEventListener("disconnect", alDesconectar)
    return () => {
      vigente = false
      api.removeEventListener?.("connect", alConectar)
      api.removeEventListener?.("disconnect", alDesconectar)
    }
  }, [fijarDispositivo])

  const fallar = useCallback((e: unknown) => {
    setError(traducirError(e).message)
    setEstado("error")
  }, [])

  /** Debe llamarse desde un click: puede abrir el selector del navegador. */
  const conectar = useCallback(async (): Promise<boolean> => {
    const api = obtenerApiUsb()
    if (!api) {
      setEstado("sin-soporte")
      return false
    }
    setError(null)
    setAviso(null)
    try {
      const d = await conectarUsb(api)
      if (!d) return false // canceló el selector: no es un error
      fijarDispositivo(d)
      setEstado("conectada")
      return true
    } catch (e) {
      fallar(e)
      return false
    }
  }, [fallar, fijarDispositivo])

  /** Envía uno o varios trabajos, uno tras otro. Devuelve true si salieron todos. */
  const imprimir = useCallback(
    async (trabajos: Uint8Array<ArrayBuffer> | Uint8Array<ArrayBuffer>[], mensajeExito?: string): Promise<boolean> => {
      if (enCurso.current) return false
      const lista = Array.isArray(trabajos) ? trabajos : [trabajos]
      enCurso.current = true
      setError(null)
      setAviso(null)
      try {
        if (!dispositivo.current && !(await conectar())) return false
        const d = dispositivo.current
        if (!d) return false
        const total = lista.reduce((n, t) => n + t.length, 0)
        let previos = 0
        setEstado("imprimiendo")
        setProgreso({ enviados: 0, total })
        for (const datos of lista) {
          await enviar(d, datos, { alProgreso: (enviados) => setProgreso({ enviados: previos + enviados, total }) })
          previos += datos.length
        }
        setEstado("conectada")
        if (mensajeExito) setAviso(mensajeExito)
        return true
      } catch (e) {
        if (e instanceof ErrorImpresora && e.codigo === "desconectada") fijarDispositivo(null)
        fallar(e)
        return false
      } finally {
        setProgreso(null)
        enCurso.current = false
      }
    },
    [conectar, fallar, fijarDispositivo],
  )

  const imprimirPrueba = useCallback(
    (rollo: RolloPrueba) => imprimir(trabajoPrueba(rollo), MENSAJE_PRUEBA_ENVIADA),
    [imprimir],
  )

  return {
    estado,
    /** Hay una impresora elegida (aunque el último intento haya fallado). */
    tieneDispositivo: estado === "conectada" || (estado === "error" && conDispositivo),
    error: estado === "sin-soporte" ? MENSAJES_IMPRESORA["sin-webusb"] : error,
    aviso,
    progreso,
    conectar,
    imprimir,
    imprimirPrueba,
  }
}
