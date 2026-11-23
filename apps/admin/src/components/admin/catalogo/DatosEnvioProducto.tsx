"use client"

import { useEffect, useState } from "react"
import { textosDatosEnvio, type DatosEnvio } from "@/lib/catalogo-datos-envio"
import { api, ErrorApi } from "./tipos"

/**
 * Datos de envío del producto (`catalog_datos_envio`): peso y medidas de la unidad de venta embalada,
 * unidad mínima y unidades por caja master. Sólo lectura (se cargan por script) y sólo en el admin:
 * la tienda no los muestra. Sirven para calcular el envío más adelante.
 */
export function DatosEnvioProducto({ alegraId }: { alegraId: string }) {
  const [datos, setDatos] = useState<DatosEnvio | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const url = `/api/admin/catalogo/productos/${encodeURIComponent(alegraId)}/envio`

  useEffect(() => {
    let vigente = true
    api<{ datosEnvio: DatosEnvio | null }>(url)
      .then((r) => {
        if (vigente) setDatos(r.datosEnvio)
      })
      .catch((err) => {
        if (vigente) setError(err instanceof ErrorApi ? err.message : "No pudimos cargar los datos de envío.")
      })
    return () => {
      vigente = false
    }
  }, [url])

  return (
    <section className="flex flex-col gap-2">
      <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
        Datos de envío
      </span>
      {error ? (
        <p className="text-xs" role="alert" style={{ color: "var(--red)" }}>
          {error}
        </p>
      ) : datos === undefined ? (
        <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
          Cargando…
        </p>
      ) : datos === null ? (
        <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
          Este producto no tiene datos de envío cargados.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {textosDatosEnvio(datos).map((t) => (
            <div key={t.etiqueta} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="shrink-0 text-xs" style={{ color: "var(--ink-faint)" }}>
                {t.etiqueta}
              </span>
              <span className="text-right" style={{ color: "var(--ink)" }}>
                {t.valor}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
        Corresponden a la unidad de venta embalada. No se muestran en la tienda: se usarán para calcular el envío.
      </p>
    </section>
  )
}
