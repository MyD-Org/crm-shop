"use client"

import { useEffect, useRef, useState } from "react"
import { Alert, Button, Field, SearchInput } from "@myd-org/ui"
import type { ContactoParaVincular } from "@/lib/clientes-tienda-acciones"
import { etiquetaTipoCuenta, mensajeDeError } from "./logica"

// Buscador del paso "Vincular" del detalle de un cliente de la tienda: busca clientes activos
// de Alegra del tenant (GET /api/admin/contactos-alegra, sólo admin+) y devuelve el elegido.
// No guarda nada: la confirmación y el POST los hace ClienteTiendaDetalle. `import type` para
// no arrastrar getDb al bundle del cliente.

const DEBOUNCE_MS = 300
const Q_MIN = 2
const ERROR_BUSQUEDA = "No se pudieron buscar los clientes de Alegra. Inténtelo nuevamente."

interface Props {
  onElegir: (contacto: ContactoParaVincular) => void
}

export function VincularContacto({ onElegir }: Props) {
  const [q, setQ] = useState("")
  const [resultados, setResultados] = useState<ContactoParaVincular[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState("")
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Sólo vale la respuesta de la última búsqueda: una lenta no pisa a una más nueva.
  const ultima = useRef(0)

  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current)
  }, [])

  async function buscar(texto: string) {
    const id = ++ultima.current
    setBuscando(true)
    const res = await fetch(`/api/admin/contactos-alegra?q=${encodeURIComponent(texto)}`, { cache: "no-store" }).catch(
      () => null,
    )
    const body: unknown = res ? await res.json().catch(() => null) : null
    if (id !== ultima.current) return
    setBuscando(false)
    const items = (body as { items?: unknown } | null)?.items
    if (res?.ok && Array.isArray(items)) {
      setResultados(items as ContactoParaVincular[])
      setError("")
    } else {
      setResultados(null)
      setError(mensajeDeError(res?.status ?? null, body, ERROR_BUSQUEDA))
    }
  }

  function cambiar(valor: string) {
    setQ(valor)
    if (debounce.current) clearTimeout(debounce.current)
    const texto = valor.trim()
    if (texto.length < Q_MIN) {
      ultima.current++
      setResultados(null)
      setBuscando(false)
      setError("")
      return
    }
    debounce.current = setTimeout(() => void buscar(texto), DEBOUNCE_MS)
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Cliente de Alegra" hint="Busque por razón social, CUIT o email (al menos 2 caracteres).">
        <SearchInput
          placeholder="Buscar cliente de Alegra"
          aria-label="Buscar cliente de Alegra"
          value={q}
          onValueChange={cambiar}
          onClear={() => cambiar("")}
          maxLength={100}
          autoFocus
        />
      </Field>

      {error && <Alert tone="danger">{error}</Alert>}

      {buscando && (
        <p className="text-sm" style={{ color: "var(--ink-faint)" }} aria-live="polite">
          Buscando…
        </p>
      )}

      {!buscando && resultados !== null && resultados.length === 0 && (
        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
          No hay clientes activos de Alegra que coincidan con su búsqueda.
        </p>
      )}

      {!buscando && resultados !== null && resultados.length > 0 && (
        <ul className="flex flex-col gap-1">
          {resultados.map((c) => (
            <li key={c.alegraId}>
              <Button variant="ghost" onClick={() => onElegir(c)} aria-label={`Elegir ${c.nombre}`}>
                <span className="flex flex-col items-start text-left">
                  <span style={{ color: "var(--ink)" }}>{c.nombre}</span>
                  <span className="text-xs" style={{ color: "var(--ink-faint)" }}>
                    {[c.identificacion, c.tipoCuenta && etiquetaTipoCuenta(c.tipoCuenta)].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
