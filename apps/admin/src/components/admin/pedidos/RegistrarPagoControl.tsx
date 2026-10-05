"use client"

import { useState } from "react"
import { Button, Dialog, Field, Input, Select, useToast } from "@myd-org/ui"
import type { PedidoDetalleDto } from "@/lib/pedidos-repo"
import { interpretarRespuestaCambio } from "./logica"
import {
  SIN_COMPROBANTE,
  cuerpoRegistrarPago,
  formularioPagoInicial,
  hoyArgentina,
  opcionesComprobante,
  type FormularioPago,
} from "./pago-formulario"

// "Registrar pago": para transferencia, efectivo y cuenta corriente, el operador carga el pago
// cuando le llega la plata (POST: monto, fecha, referencia y, si hay, el comprobante que subió el
// comprador, ya precargado) y el cliente recibe un mail. "Anular pago" (DELETE) deshace uno
// cargado por error (baja lógica: el pago queda en la lista como anulado). Los pagos en línea no
// muestran nada: los mueve el proveedor.

interface Props {
  pedido: PedidoDetalleDto
  onChanged: (pedido: PedidoDetalleDto) => void
}

type Accion = "registrar" | "anular"

export function RegistrarPagoControl({ pedido, onChanged }: Props) {
  const { toast } = useToast()
  const [confirmar, setConfirmar] = useState<Accion | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [form, setForm] = useState<FormularioPago>(() => formularioPagoInicial(pedido, pedido.comprobantes))

  if (!pedido.pagoManual) return null
  const pagado = pedido.pagoEstado === "pagado"
  if (!pagado && pedido.estado === "cancelado") return null

  function abrir(accion: Accion) {
    // Cada vez que se abre "Registrar", se vuelve a precargar con lo último que subió el comprador.
    if (accion === "registrar") setForm(formularioPagoInicial(pedido, pedido.comprobantes))
    setConfirmar(accion)
  }

  async function enviar(accion: Accion) {
    setGuardando(true)
    const res = await fetch(`/api/admin/pedidos/${pedido.id}/pago`, {
      method: accion === "registrar" ? "POST" : "DELETE",
      ...(accion === "registrar"
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpoRegistrarPago(form)) }
        : {}),
    }).catch(() => null)
    const body: unknown = res ? await res.json().catch(() => null) : null
    const resultado = interpretarRespuestaCambio<PedidoDetalleDto>(res?.status ?? null, body)
    setGuardando(false)
    if (resultado.tipo === "ok") {
      setConfirmar(null)
      toast({ title: accion === "registrar" ? "El pago quedó registrado." : "El pago se anuló.", tone: "success" })
      onChanged(resultado.pedido)
      return
    }
    toast({ title: resultado.mensaje, tone: "danger" })
  }

  const sinEmail = !pedido.cliente.email

  return (
    <>
      <div className="mt-3">
        {pagado ? (
          <Button variant="ghost" onClick={() => abrir("anular")}>Anular pago</Button>
        ) : (
          <Button onClick={() => abrir("registrar")}>Registrar pago</Button>
        )}
      </div>

      <Dialog
        dismissible={false}
        open={confirmar !== null}
        onOpenChange={(open) => { if (!open && !guardando) setConfirmar(null) }}
        title={confirmar === "anular" ? "Anular pago" : "Registrar pago"}
        description={
          confirmar === "anular"
            ? "El pedido volverá a quedar con el pago pendiente y el pago registrado quedará como anulado. No se le avisará al cliente."
            : sinEmail
              ? "Indique los datos del pago recibido. El pedido no tiene email, así que no se le avisará al cliente."
              : `Indique los datos del pago recibido. Le enviaremos un aviso por email a ${pedido.cliente.email}.`
        }
        headerBorder={false}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setConfirmar(null)} disabled={guardando}>Volver</Button>
            <Button
              variant={confirmar === "anular" ? "danger" : "primary"}
              loading={guardando}
              onClick={() => confirmar && void enviar(confirmar)}
            >
              {confirmar === "anular" ? "Anular pago" : "Registrar pago"}
            </Button>
          </div>
        }
      >
        {confirmar === "registrar" && (
          <div className="flex flex-col gap-3">
            <Field label="Monto" hint="Sin separador de miles, por ejemplo 150000,50.">
              <Input
                value={form.monto}
                onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))}
                inputMode="decimal"
                disabled={guardando}
              />
            </Field>
            <Field label="Fecha del pago">
              <Input
                type="date"
                value={form.fecha}
                max={hoyArgentina()}
                onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))}
                disabled={guardando}
              />
            </Field>
            <Field label="Referencia (opcional)" hint="Número de operación u otro dato que ayude a identificar el pago.">
              <Input
                value={form.referencia}
                maxLength={100}
                onChange={(e) => setForm((f) => ({ ...f, referencia: e.target.value }))}
                disabled={guardando}
              />
            </Field>
            <Field
              label="Comprobante"
              hint={pedido.comprobantes.length === 0 ? "El comprador no subió ningún comprobante." : undefined}
            >
              <Select
                options={opcionesComprobante(pedido.comprobantes)}
                value={form.comprobante}
                onValueChange={(v) => setForm((f) => ({ ...f, comprobante: v }))}
                disabled={guardando || pedido.comprobantes.length === 0}
              />
            </Field>
            {form.comprobante !== SIN_COMPROBANTE && pedido.comprobantes.some((c) => c.id === form.comprobante && c.tieneArchivo) && (
              <a
                href={`/api/admin/pedidos/${pedido.id}/comprobantes/${form.comprobante}/file`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm underline"
                style={{ color: "var(--blue)" }}
              >
                Ver el comprobante
              </a>
            )}
          </div>
        )}
      </Dialog>
    </>
  )
}
