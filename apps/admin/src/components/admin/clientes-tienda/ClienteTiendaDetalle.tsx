"use client"

import { useState } from "react"
import { Alert, Badge, Button, Dialog, useToast } from "@myd-org/ui"
import type { ClienteTiendaDto } from "@/lib/clientes-tienda-repo"
import type { ContactoParaVincular } from "@/lib/clientes-tienda-acciones"
import { fmtFechaCliente } from "./format"
import {
  accionesDisponibles,
  etiquetaAcceso,
  etiquetaMetodo,
  etiquetaTipoCuenta,
  etiquetaVinculo,
  mensajeDeError,
  textoConfirmarDarAcceso,
  textoConfirmarDesvincular,
  textoConfirmarQuitarAcceso,
  textoConfirmarVincular,
  tonoAcceso,
  tonoVinculo,
} from "./logica"
import { VincularContacto } from "./VincularContacto"

// Detalle de un cliente de la tienda (se abre al tocar una fila). Un solo Dialog que cambia de
// paso — detalle → buscar contacto → confirmación — para no apilar diálogos. Las acciones
// (vincular, desvincular, dar y quitar acceso a Facturación) sólo aparecen si `puedeGestionar`
// (admin+, calculado en el server con el rol fresco); la autoridad real es la API.
// Toda acción pide confirmación explícita. Al terminar avisa con un toast y pide recargar la
// lista (`onCambio`). Un error de la API se muestra en el mismo paso de confirmación.

type Accion = "vincular" | "desvincular" | "darAcceso" | "quitarAcceso"

type Paso =
  | { tipo: "detalle" }
  | { tipo: "buscar" }
  | { tipo: "confirmar"; accion: Accion; contacto?: ContactoParaVincular }

interface Props {
  cliente: ClienteTiendaDto
  puedeGestionar: boolean
  onClose: () => void
  onCambio: () => void
}

const TITULO: Record<Accion, string> = {
  vincular: "Vincular cuenta",
  desvincular: "Desvincular cuenta",
  darAcceso: "Dar acceso a Facturación",
  quitarAcceso: "Quitar acceso a Facturación",
}

const BOTON: Record<Accion, string> = {
  vincular: "Vincular",
  desvincular: "Desvincular",
  darAcceso: "Dar acceso",
  quitarAcceso: "Quitar acceso",
}

const EXITO: Record<Accion, string> = {
  vincular: "Cuenta vinculada.",
  desvincular: "Cuenta desvinculada.",
  darAcceso: "Acceso otorgado.",
  quitarAcceso: "Acceso quitado.",
}

const SIN_CAMBIOS: Record<Accion, string> = {
  vincular: "La cuenta ya estaba vinculada a ese cliente.",
  desvincular: "La cuenta ya no tenía un vínculo activo.",
  darAcceso: "El cliente ya tenía acceso a Facturación.",
  quitarAcceso: "El cliente ya no tenía acceso por excepción.",
}

const ERROR: Record<Accion, string> = {
  vincular: "No se pudo vincular la cuenta. Inténtelo nuevamente.",
  desvincular: "No se pudo desvincular la cuenta. Inténtelo nuevamente.",
  darAcceso: "No se pudo dar acceso a Facturación. Inténtelo nuevamente.",
  quitarAcceso: "No se pudo quitar el acceso a Facturación. Inténtelo nuevamente.",
}

function Fila({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <dt style={{ color: "var(--ink-soft)" }}>{label}</dt>
      <dd className="text-right" style={{ color: "var(--ink)" }}>{children || "—"}</dd>
    </div>
  )
}

export function ClienteTiendaDetalle({ cliente, puedeGestionar, onClose, onCambio }: Props) {
  const { toast } = useToast()
  const [paso, setPaso] = useState<Paso>({ tipo: "detalle" })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState("")

  const acciones = accionesDisponibles(cliente, puedeGestionar)
  const razonSocial = cliente.vinculo.razonSocial
  const alegraId = cliente.vinculo.alegraContactId

  function ir(p: Paso) {
    setError("")
    setPaso(p)
  }

  function cerrar() {
    if (!guardando) onClose()
  }

  function pedido(accion: Accion, contacto?: ContactoParaVincular): { url: string; init: RequestInit } | null {
    const usuario = `/api/admin/clientes-tienda/${encodeURIComponent(cliente.clerkUserId)}/vinculo`
    if (accion === "vincular" && contacto) {
      return {
        url: usuario,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alegraContactId: contacto.alegraId }),
        },
      }
    }
    if (accion === "desvincular") return { url: usuario, init: { method: "DELETE" } }
    if (!alegraId) return null
    const acceso = `/api/admin/contactos-alegra/${encodeURIComponent(alegraId)}/acceso-facturacion`
    return { url: acceso, init: { method: accion === "darAcceso" ? "POST" : "DELETE" } }
  }

  async function confirmar(accion: Accion, contacto?: ContactoParaVincular) {
    const p = pedido(accion, contacto)
    if (!p) return
    setGuardando(true)
    setError("")
    const res = await fetch(p.url, { cache: "no-store", ...p.init }).catch(() => null)
    const body: unknown = res ? await res.json().catch(() => null) : null
    setGuardando(false)
    if (res?.ok) {
      const cambio = (body as { cambio?: unknown } | null)?.cambio !== false
      toast({ title: cambio ? EXITO[accion] : SIN_CAMBIOS[accion], tone: cambio ? "success" : "neutral" })
      onCambio()
      onClose()
      return
    }
    setError(mensajeDeError(res?.status ?? null, body, ERROR[accion]))
  }

  if (paso.tipo === "buscar") {
    return (
      <Dialog
        open
        onOpenChange={(open) => { if (!open) cerrar() }}
        title="Vincular cuenta"
        description={`Elija el cliente de Alegra al que pertenece ${cliente.nombre ?? cliente.email ?? "este usuario"}.`}
        headerBorder={false}
        footer={
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => ir({ tipo: "detalle" })}>
              Volver
            </Button>
          </div>
        }
      >
        <VincularContacto onElegir={(contacto) => ir({ tipo: "confirmar", accion: "vincular", contacto })} />
      </Dialog>
    )
  }

  if (paso.tipo === "confirmar") {
    const { accion, contacto } = paso
    const texto =
      accion === "vincular"
        ? textoConfirmarVincular(contacto?.nombre ?? "")
        : accion === "desvincular"
          ? textoConfirmarDesvincular(razonSocial)
          : accion === "darAcceso"
            ? textoConfirmarDarAcceso(razonSocial)
            : textoConfirmarQuitarAcceso(razonSocial)
    const peligrosa = accion === "desvincular" || accion === "quitarAcceso"
    return (
      <Dialog
        open
        onOpenChange={(open) => { if (!open) cerrar() }}
        title={TITULO[accion]}
        description={texto}
        headerBorder={false}
        footer={
          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              onClick={() => ir(accion === "vincular" ? { tipo: "buscar" } : { tipo: "detalle" })}
              disabled={guardando}
            >
              Cancelar
            </Button>
            <Button
              variant={peligrosa ? "danger" : "primary"}
              loading={guardando}
              onClick={() => void confirmar(accion, contacto)}
            >
              {BOTON[accion]}
            </Button>
          </div>
        }
      >
        {error && <Alert tone="danger">{error}</Alert>}
      </Dialog>
    )
  }

  const hayAcciones = acciones.vincular || acciones.desvincular || acciones.darAcceso || acciones.quitarAcceso

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) cerrar() }}
      title={cliente.nombre ?? "Cliente de la tienda"}
      description={cliente.email ?? undefined}
      footer={
        <div className="flex flex-wrap gap-2 justify-end">
          {acciones.vincular && <Button onClick={() => ir({ tipo: "buscar" })}>Vincular</Button>}
          {acciones.darAcceso && (
            <Button onClick={() => ir({ tipo: "confirmar", accion: "darAcceso" })}>Dar acceso a Facturación</Button>
          )}
          {acciones.quitarAcceso && (
            <Button variant="ghost" onClick={() => ir({ tipo: "confirmar", accion: "quitarAcceso" })}>
              Quitar acceso
            </Button>
          )}
          {acciones.desvincular && (
            <Button variant="ghost" onClick={() => ir({ tipo: "confirmar", accion: "desvincular" })}>
              Desvincular
            </Button>
          )}
          <Button variant={hayAcciones ? "ghost" : "primary"} onClick={cerrar}>
            Cerrar
          </Button>
        </div>
      }
    >
      <dl className="flex flex-col gap-1.5">
        <Fila label="Alta">{fmtFechaCliente(cliente.altaEn)}</Fila>
        <Fila label="Vínculo">
          <span className="inline-flex flex-wrap items-center justify-end gap-1">
            {razonSocial && <span>{razonSocial}</span>}
            <Badge tone={tonoVinculo(cliente.vinculo.estado)}>{etiquetaVinculo(cliente.vinculo.estado)}</Badge>
          </span>
        </Fila>
        {cliente.vinculo.estado === "vinculado" && (
          <Fila label="Método">{etiquetaMetodo(cliente.vinculo.metodo)}</Fila>
        )}
        <Fila label="Tipo de cuenta">{cliente.tipoCuenta ? etiquetaTipoCuenta(cliente.tipoCuenta) : null}</Fila>
        <Fila label="Acceso a Facturación">
          <Badge tone={tonoAcceso(cliente.acceso)}>{etiquetaAcceso(cliente.acceso)}</Badge>
        </Fila>
        <Fila label="Pedidos">{String(cliente.pedidos)}</Fila>
        <Fila label="Último pedido">{fmtFechaCliente(cliente.ultimoPedidoEn)}</Fila>
      </dl>
      {cliente.excepcionVigente && cliente.acceso === "no" && (
        <div className="mt-3">
          <Alert tone="warning">
            Este cliente tiene acceso a Facturación por excepción, pero hoy no figura activo en Alegra: sus usuarios no
            ven Facturación hasta que vuelva a estar activo.
          </Alert>
        </div>
      )}
    </Dialog>
  )
}
