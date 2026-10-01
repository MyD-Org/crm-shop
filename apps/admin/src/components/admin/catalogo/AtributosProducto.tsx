"use client"

import { useEffect, useState } from "react"
import { FileSearch, Loader2, Save } from "lucide-react"
import { Button, Input, Select } from "@myd-org/ui"
import {
  CLAVES_ATRIBUTO,
  COLORES,
  CURVAS,
  DEFINICION_ATRIBUTOS,
  ETIQUETA_ATRIBUTO,
  MONTAJES,
  TONOS,
  type ClaveAtributo,
} from "@/lib/catalogo-atributos-extraccion"
import { api, ErrorApi } from "./tipos"

/**
 * Datos técnicos estructurados del producto (`catalog_atributos`): lo que salió del nombre, de la
 * ficha PDF o de una corrección manual. La tienda los usa para filtrar (potencia, tono, zócalo…) y
 * para la tabla "Características".
 *
 * - "Leer ficha técnica" manda el PDF cargado a Claude Haiku y guarda lo leído como `pdf` (no pisa
 *   lo cargado a mano).
 * - "Guardar datos técnicos" guarda los campos cambiados como `manual` (le gana a todo); un campo
 *   vaciado se quita.
 */

interface AtributoDto {
  clave: ClaveAtributo
  valorNum: number | null
  valorTexto: string | null
  fuente: "nombre" | "pdf" | "manual"
}

interface Props {
  alegraId: string
  /** Hay un PDF cargado (sin él no se puede leer). */
  tieneFicha: boolean
}

const TEXTO_FUENTE: Record<AtributoDto["fuente"], string> = {
  nombre: "Del nombre",
  pdf: "De la ficha",
  manual: "Manual",
}

/** Valor del `Select` que representa "sin dato" (el componente no admite valores vacíos). */
const SIN_DATO = "__sin_dato__"

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

/** Claves de vocabulario cerrado: se eligen de una lista (el valor guardado es el de la base). */
const ETIQUETA_TONO: Record<(typeof TONOS)[number], string> = {
  calido: "Cálida",
  neutro: "Neutra",
  frio: "Fría",
  rojo: "Roja",
  verde: "Verde",
  azul: "Azul",
  amarillo: "Amarilla",
  naranja: "Naranja",
  violeta: "Violeta",
  rosa: "Rosa",
  rgb: "RGB",
  rgbw: "RGBW",
}

const OPCIONES: Partial<Record<ClaveAtributo, { label: string; value: string }[]>> = {
  tono: TONOS.map((t) => ({ label: ETIQUETA_TONO[t], value: t })),
  color: COLORES.map((c) => ({ label: cap(c), value: c })),
  curva: CURVAS.map((c) => ({ label: c.toUpperCase(), value: c })),
  montaje: MONTAJES.map((m) => ({
    label: { embutir: "De embutir", aplicar: "De aplicar", colgante: "Colgante", riel: "Para riel", din: "Riel DIN" }[m],
    value: m,
  })),
}

/** Valor como lo edita el operador: el rango de tensión se muestra como texto. */
function comoTexto(a: AtributoDto | undefined): string {
  if (!a) return ""
  if (a.clave === "tension_v" && a.valorTexto) return a.valorTexto
  if (a.valorNum != null) return String(a.valorNum)
  return a.valorTexto ?? ""
}

export function AtributosProducto({ alegraId, tieneFicha }: Props) {
  const [atributos, setAtributos] = useState<AtributoDto[] | null>(null)
  const [borrador, setBorrador] = useState<Partial<Record<ClaveAtributo, string>>>({})
  const [lectorConfigurado, setLectorConfigurado] = useState(false)
  const [ocupado, setOcupado] = useState<"leyendo" | "guardando" | null>(null)
  const [error, setError] = useState("")
  const [aviso, setAviso] = useState("")

  const url = `/api/admin/catalogo/productos/${encodeURIComponent(alegraId)}/atributos`

  useEffect(() => {
    let vigente = true
    api<{ atributos: AtributoDto[]; lectorConfigurado: boolean }>(url)
      .then((r) => {
        if (!vigente) return
        setAtributos(r.atributos)
        setLectorConfigurado(r.lectorConfigurado)
      })
      .catch((err) => {
        if (vigente) setError(err instanceof ErrorApi ? err.message : "No pudimos cargar los datos técnicos.")
      })
    return () => {
      vigente = false
    }
  }, [url])

  const porClave = new Map((atributos ?? []).map((a) => [a.clave, a]))
  const valor = (c: ClaveAtributo) => borrador[c] ?? comoTexto(porClave.get(c))
  const cambiados = CLAVES_ATRIBUTO.filter((c) => borrador[c] !== undefined && borrador[c]!.trim() !== comoTexto(porClave.get(c)))

  async function leerFicha() {
    setError("")
    setAviso("")
    setOcupado("leyendo")
    try {
      const r = await api<{ atributos: AtributoDto[]; leidos: number; sinCambios: number }>(`${url}/leer-ficha`, { method: "POST" })
      setAtributos(r.atributos)
      setBorrador({})
      setAviso(
        r.leidos === 0
          ? "La ficha no trae datos técnicos reconocibles."
          : `Se leyeron ${r.leidos} dato(s) de la ficha${r.sinCambios ? `; ${r.sinCambios} no cambiaron (ya estaban o se cargaron a mano)` : ""}.`,
      )
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos leer la ficha técnica.")
    } finally {
      setOcupado(null)
    }
  }

  async function guardar() {
    setError("")
    setAviso("")
    setOcupado("guardando")
    try {
      const valores = Object.fromEntries(cambiados.map((c) => [c, borrador[c]!.trim() || null]))
      const r = await api<{ atributos: AtributoDto[] }>(url, { method: "PUT", body: JSON.stringify({ valores }) })
      setAtributos(r.atributos)
      setBorrador({})
      setAviso("Datos técnicos guardados.")
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : "No pudimos guardar los datos técnicos.")
    } finally {
      setOcupado(null)
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
          Datos técnicos
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={!tieneFicha || !lectorConfigurado || ocupado !== null}
          title={
            !tieneFicha
              ? "Suba la ficha técnica (PDF) para poder leerla."
              : !lectorConfigurado
                ? "La lectura de fichas no está configurada."
                : undefined
          }
          onClick={() => void leerFicha()}
        >
          {ocupado === "leyendo" ? <Loader2 size={13} className="animate-spin" /> : <FileSearch size={13} />}
          {ocupado === "leyendo" ? "Leyendo…" : "Leer ficha técnica"}
        </Button>
      </div>

      {atributos === null && !error ? (
        <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
          Cargando…
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {CLAVES_ATRIBUTO.map((c) => {
            const a = porClave.get(c)
            return (
              <label key={c} className="flex flex-col gap-1 text-xs" style={{ color: "var(--ink-soft)" }}>
                <span className="flex items-center justify-between gap-2">
                  {ETIQUETA_ATRIBUTO[c]}
                  {a && borrador[c] === undefined && (
                    <span style={{ color: "var(--ink-faint)" }}>{TEXTO_FUENTE[a.fuente]}</span>
                  )}
                </span>
                {OPCIONES[c] ? (
                  <Select
                    options={[{ label: "Sin dato", value: SIN_DATO }, ...OPCIONES[c]!]}
                    value={valor(c) || SIN_DATO}
                    onValueChange={(v) => setBorrador((b) => ({ ...b, [c]: v === SIN_DATO ? "" : v }))}
                    aria-label={ETIQUETA_ATRIBUTO[c]}
                  />
                ) : (
                  <Input
                    value={valor(c)}
                    placeholder={DEFINICION_ATRIBUTOS[c].pista}
                    onChange={(e) => setBorrador((b) => ({ ...b, [c]: e.target.value }))}
                    aria-label={ETIQUETA_ATRIBUTO[c]}
                  />
                )}
              </label>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-end">
        <Button variant="ghost" size="sm" disabled={cambiados.length === 0 || ocupado !== null} onClick={() => void guardar()}>
          {ocupado === "guardando" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          Guardar datos técnicos
        </Button>
      </div>

      {aviso && (
        <p className="text-xs" role="status" style={{ color: "var(--ink-soft)" }}>
          {aviso}
        </p>
      )}
      {error && (
        <p className="text-xs" role="alert" style={{ color: "var(--red)" }}>
          {error}
        </p>
      )}
      <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
        Lo cargado a mano tiene prioridad sobre la ficha y el nombre. Un campo vacío se quita.
      </p>
    </section>
  )
}
