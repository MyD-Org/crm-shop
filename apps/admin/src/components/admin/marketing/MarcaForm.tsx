"use client"
import { useState } from "react"
import { Button, Field, Input, Select, Textarea, useToast } from "@myd-org/ui"
import type { MarcaDto } from "@/lib/marketing/marca-repo"
import type { ReglaMarca } from "@/db/schema"
import { mensajeDeError, pedirJson } from "./pedir-json"

const SEVERIDADES = [
  { value: "alta", label: "Alta" },
  { value: "media", label: "Media" },
]

export function MarcaForm({ inicial }: { inicial: MarcaDto }) {
  const { toast } = useToast()
  const [voz, setVoz] = useState(inicial.voz)
  const [hashtags, setHashtags] = useState(inicial.hashtagsBase.join(" "))
  const [reglas, setReglas] = useState<ReglaMarca[]>(inicial.reglas)
  const [guardando, setGuardando] = useState(false)

  function cambiarRegla(i: number, cambios: Partial<ReglaMarca>) {
    setReglas((rs) => rs.map((r, j) => (j === i ? { ...r, ...cambios } : r)))
  }

  async function guardar() {
    setGuardando(true)
    try {
      await pedirJson(
        "/api/admin/marketing/marca",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            voz,
            hashtagsBase: hashtags.split(/\s+/).filter(Boolean),
            reglas: reglas.filter((r) => r.texto.trim()).map((r) => ({ ...r, patron: r.patron?.trim() || undefined })),
          }),
        },
        "No se pudo guardar. Inténtelo de nuevo",
      )
      toast({ title: "Marca guardada", tone: "success" })
    } catch (e) {
      toast({ title: mensajeDeError(e, "No se pudo guardar. Inténtelo de nuevo"), tone: "danger" })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Field label="Voz de la marca">
        <Textarea value={voz} onChange={(e) => setVoz(e.target.value)} rows={4} placeholder="Ej.: cercana y técnica, sin abusar de los emojis" />
      </Field>
      <Field label="Hashtags base (separados por espacio)">
        <Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} />
      </Field>
      <div className="space-y-2">
        <h2 className="font-semibold">Reglas</h2>
        {reglas.map((r, i) => (
          <div key={r.id} className="grid gap-2 md:grid-cols-[2fr_2fr_1fr_auto]">
            <Input value={r.texto} onChange={(e) => cambiarRegla(i, { texto: e.target.value })} placeholder="Qué no se puede decir" aria-label="Descripción de la regla" />
            <Input
              value={r.patron ?? ""}
              onChange={(e) => cambiarRegla(i, { patron: e.target.value })}
              placeholder="Frases que no se pueden usar (opcional, separadas por |)"
              aria-label="Frases que no se pueden usar"
            />
            <Select
              value={r.severidad}
              onValueChange={(v) => cambiarRegla(i, { severidad: v as ReglaMarca["severidad"] })}
              options={SEVERIDADES}
              aria-label="Severidad de la regla"
            />
            <Button variant="secondary" onClick={() => setReglas((rs) => rs.filter((_, j) => j !== i))}>Quitar</Button>
          </div>
        ))}
        <p className="text-xs" style={{ color: "var(--ink-soft)" }}>Se comparan sin distinguir mayúsculas ni tildes.</p>
        <Button variant="secondary" onClick={() => setReglas((rs) => [...rs, { id: crypto.randomUUID(), texto: "", severidad: "alta" }])}>Agregar regla</Button>
      </div>
      <Button onClick={guardar} disabled={guardando}>Guardar</Button>
    </div>
  )
}
