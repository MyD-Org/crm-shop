"use client"

import { useRef, useState, type ReactNode } from "react"
import { Alert, Button, Card } from "@myd-org/ui"
import { formatoPesos } from "@/lib/compras-formato"

// «Leer factura (PDF)»: sube el PDF del proveedor, el servidor lo lee y el formulario se completa.
// Nada se registra hasta «Registrar compra». Muestra lo que no se pudo emparejar y el control de
// totales (Σ líneas del formulario vs subtotal del documento).

export interface LecturaFactura {
  tipoDocumento: "factura" | "remito" | "otro"
  proveedor: { id: string; nombre: string; cuit: string | null } | null
  proveedorLeido: { cuit: string | null; nombre: string | null } | null
  numeroFactura: string | null
  fecha: string | null
  vencimiento: string | null
  descuentoGeneralPct: number | null
  items: { alegraId: string; nombre: string; codigo: string | null; cantidad: number; costo: number; ivaPct: number | null }[]
  sinProducto: { codigo: string | null; descripcion: string; cantidad: number; costo: number; motivo: string }[]
  percepciones: { descripcion: string; importe: number }[]
  control: { netoCalculado: number; subtotalNetoLeido: number | null; totalLeido: number | null }
}

const pesos = (n: number) => formatoPesos(Math.round(n * 100))

export function LectorFacturaPdf({
  cuenta,
  lectura,
  netoFormulario,
  onLeida,
  selectorCuenta,
}: {
  cuenta: string
  /** Selector de la cuenta de Alegra: va primero, porque el PDF se lee contra esa cuenta. */
  selectorCuenta: ReactNode
  lectura: LecturaFactura | null
  /** Neto actual del formulario, en centavos (null si el formulario todavía no valida). */
  netoFormulario: number | null
  onLeida: (l: LecturaFactura) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function leer(archivo: File) {
    setLeyendo(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.set("archivo", archivo)
      fd.set("cuenta", cuenta)
      const res = await fetch("/api/admin/compras/leer-pdf", { method: "POST", body: fd })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error ?? "No se pudo leer el PDF. Cargue la compra a mano.")
        return
      }
      onLeida(json as LecturaFactura)
    } catch {
      setError("Error de conexión. Inténtelo nuevamente.")
    } finally {
      setLeyendo(false)
      if (input.current) input.current.value = ""
    }
  }

  const c = lectura?.control
  const subtotal = c?.subtotalNetoLeido ?? null
  const difiereDocumento = c && subtotal !== null && Math.abs(c.netoCalculado - subtotal) > 1
  const difiereFormulario = c && subtotal !== null && netoFormulario !== null && Math.abs(netoFormulario / 100 - subtotal) > 1

  return (
    <Card
      title="Leer factura (PDF)"
      description="1. Elija la cuenta de Alegra. 2. Suba el PDF del proveedor para completar el formulario. Revise los datos antes de registrar la compra."
    >
      <div className="mb-4 max-w-md">{selectorCuenta}</div>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void leer(f)
        }}
      />
      <Button variant="secondary" loading={leyendo} disabled={!cuenta} onClick={() => input.current?.click()}>
        {lectura ? "Leer otro PDF" : "Subir PDF"}
      </Button>
      {leyendo && (
        <p className="mt-2 text-sm" style={{ color: "var(--ink-soft)" }}>
          Leyendo el documento… puede tardar unos segundos.
        </p>
      )}
      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      {lectura && !leyendo && (
        <div className="mt-3 flex flex-col gap-3">
          <Alert tone={lectura.sinProducto.length || difiereDocumento || difiereFormulario || !lectura.proveedor ? "warning" : "success"}>
            <p>
              Se cargaron {lectura.items.length} de {lectura.items.length + lectura.sinProducto.length} renglones
              {lectura.descuentoGeneralPct ? ` (con el descuento general del ${String(lectura.descuentoGeneralPct).replace(".", ",")} % ya aplicado al costo)` : ""}.
            </p>
            {!lectura.proveedor && (
              <p className="mt-1">
                No se encontró el proveedor
                {lectura.proveedorLeido?.nombre || lectura.proveedorLeido?.cuit
                  ? ` «${[lectura.proveedorLeido?.nombre, lectura.proveedorLeido?.cuit].filter(Boolean).join(" · ")}»`
                  : ""}
                . Selecciónelo a mano.
              </p>
            )}
            {lectura.tipoDocumento !== "factura" && (
              <p className="mt-1">El documento no es una factura: ingrese el número de la factura del proveedor.</p>
            )}
            {subtotal !== null && (
              <p className="mt-1">
                Subtotal neto del documento: {pesos(subtotal)}
                {netoFormulario !== null ? ` · Neto del formulario: ${formatoPesos(netoFormulario)}` : ""}
                {difiereFormulario ? " — no coinciden, revise los renglones." : ""}
              </p>
            )}
            {difiereDocumento && !difiereFormulario && (
              <p className="mt-1">La suma de los renglones leídos no coincide con el subtotal del documento: revise cantidades y costos.</p>
            )}
            {lectura.percepciones.length > 0 && (
              <p className="mt-1">
                Percepciones del documento (cárguelas abajo):{" "}
                {lectura.percepciones.map((p) => `${p.descripcion} ${pesos(p.importe)}`).join(" · ")}
              </p>
            )}
          </Alert>
          {lectura.sinProducto.length > 0 && (
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                Renglones sin producto: búsquelos abajo por código; si no existen en esta cuenta, use «Copiar a» o «Crear producto».
              </p>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {lectura.sinProducto.map((l, i) => (
                  <li key={i}>
                    <span className="font-medium">{l.codigo ?? "—"}</span> · {l.descripcion} · {String(l.cantidad).replace(".", ",")} u ×{" "}
                    {pesos(l.costo)} <span style={{ color: "var(--ink-soft)" }}>({l.motivo})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
