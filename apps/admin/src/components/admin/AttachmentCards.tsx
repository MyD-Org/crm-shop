"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Copy, ExternalLink, MapPin, MessageSquare, Phone } from "lucide-react"
import { contactThreadHref, type InboxContact, type SharedContact, type SharedLocation } from "@/lib/inbox-api"
import {
  buscarConversacion, coordenadas, inicial, mapsUrl, numeroDelContacto, soloDigitos, telefonoVisible,
} from "@/lib/tarjetas-adjunto"

// Tarjetas del hilo para lo que el cliente comparte SIN archivo: un contacto o una
// ubicación. Mismo lenguaje visual que la burbuja del cliente (fondo card + borde).

const cardStyle = { background: "var(--card)", border: "1px solid var(--border)", color: "var(--ink)" }
const accionClass = "flex items-center justify-center gap-1.5 px-3 py-2 text-xs transition-colors hover:bg-[var(--surface-hover)]"

function useCopiar() {
  const [copiado, setCopiado] = useState(false)
  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    } catch {
      // Sin permiso de portapapeles no hay nada útil que hacer: el dato sigue a la vista.
    }
  }
  return { copiado, copiar }
}

function Acciones({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-[var(--border)]" style={{ borderTop: "1px solid var(--border)" }}>
      {children}
    </div>
  )
}

export function ContactCard({ contact, channelAccountId }: { contact: SharedContact; channelAccountId?: string | null }) {
  const router = useRouter()
  const { copiado, copiar } = useCopiar()
  const [buscando, setBuscando] = useState(false)
  const [sinConversacion, setSinConversacion] = useState(false)
  const numero = numeroDelContacto(contact)
  const principal = contact.phones[0]
  const visible = principal ? telefonoVisible(principal) : ""

  // Se busca recién al hacer clic: la lista completa del inbox no hace falta para dibujar
  // la tarjeta, y la mayoría de los contactos compartidos nunca se abren.
  async function abrirConversacion() {
    if (!numero || buscando) return
    setBuscando(true)
    setSinConversacion(false)
    try {
      // Por número (q): la lista sin filtro trae solo los últimos 100 contactos.
      const res = await fetch(`/api/admin/inbox/contacts?q=${encodeURIComponent(numero)}`)
      const contacts = res.ok ? ((await res.json()) as InboxContact[]) : []
      const encontrada = buscarConversacion(contacts, numero, channelAccountId)
      if (encontrada) router.push(contactThreadHref(encontrada))
      else setSinConversacion(true)
    } finally {
      setBuscando(false)
    }
  }

  return (
    <div className="w-[300px] max-w-full rounded-[var(--radius)] overflow-hidden text-sm" style={cardStyle}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-medium"
          style={{ background: "var(--blue-soft)", color: "var(--blue)" }}
          aria-hidden="true"
        >
          {inicial(contact)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate">
            {contact.name || "Contacto sin nombre"}
            {contact.company && <span style={{ color: "var(--ink-soft)" }}> · {contact.company}</span>}
          </p>
          {contact.phones.map((p, i) => (
            <a
              key={i}
              href={`tel:+${soloDigitos(p.waId) || soloDigitos(p.phone)}`}
              className="block text-xs truncate"
              style={{ color: "var(--blue)" }}
            >
              {telefonoVisible(p)}
            </a>
          ))}
        </div>
        {visible && (
          <button
            type="button"
            onClick={() => copiar(visible)}
            aria-label={copiado ? "Número copiado" : "Copiar número"}
            title={copiado ? "Copiado" : "Copiar número"}
            className="p-1.5 shrink-0"
            style={{ color: "var(--ink-soft)" }}
          >
            {copiado ? <Check size={16} /> : <Copy size={16} />}
          </button>
        )}
      </div>
      {sinConversacion && (
        <p className="px-3 pb-2 text-xs" style={{ color: "var(--ink-soft)" }}>
          Este número todavía no tiene una conversación en el inbox.
        </p>
      )}
      {numero && (
        <Acciones>
          <button type="button" onClick={abrirConversacion} className={accionClass} style={{ color: "var(--blue)" }}>
            <MessageSquare size={14} />
            {buscando ? "Buscando..." : "Abrir conversación"}
          </button>
          <a href={`tel:+${numero}`} className={accionClass} style={{ color: "var(--blue)" }}>
            <Phone size={14} />
            Llamar
          </a>
        </Acciones>
      )}
    </div>
  )
}

export function LocationCard({ location }: { location: SharedLocation }) {
  const { copiado, copiar } = useCopiar()
  const titulo = location.name || (location.address ? null : "Ubicación compartida")
  const textoCopiable = location.address || coordenadas(location)

  return (
    <div className="w-[300px] max-w-full rounded-[var(--radius)] overflow-hidden text-sm" style={cardStyle}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "var(--color-danger-soft)", color: "var(--color-danger)" }}
          aria-hidden="true"
        >
          <MapPin size={18} />
        </div>
        <div className="min-w-0 flex-1">
          {titulo && <p className="font-medium truncate">{titulo}</p>}
          <p className="text-xs" style={{ color: "var(--ink-soft)" }}>
            {location.address || coordenadas(location)}
          </p>
        </div>
      </div>
      <Acciones>
        <a href={mapsUrl(location)} target="_blank" rel="noopener noreferrer" className={accionClass} style={{ color: "var(--blue)" }}>
          <ExternalLink size={14} />
          Abrir en Maps
        </a>
        <button type="button" onClick={() => copiar(textoCopiable)} className={accionClass} style={{ color: "var(--blue)" }}>
          {copiado ? <Check size={14} /> : <Copy size={14} />}
          {copiado ? "Copiado" : location.address ? "Copiar dirección" : "Copiar coordenadas"}
        </button>
      </Acciones>
    </div>
  )
}
