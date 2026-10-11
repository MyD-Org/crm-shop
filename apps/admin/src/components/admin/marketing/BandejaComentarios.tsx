"use client"
import { useState } from "react"
import { Badge, Button, Card, EmptyState, Textarea, useToast } from "@myd-org/ui"
import type { InteraccionDto } from "@/lib/marketing/otros-repo"
import { ErrorUsuario, mensajeDeError, pedirJson } from "./pedir-json"

type Accion = "aprobar" | "ocultar" | "ignorar"

const CATEGORIA: Record<string, string> = { consulta: "Consulta", asesoramiento: "Asesoramiento", elogio: "Elogio", queja: "Queja", spam: "Spam", otro: "Otro" }
const MENSAJE_OK: Record<Accion, string> = {
  aprobar: "Respuesta aprobada. Se publicará en unos minutos.",
  ignorar: "Comentario ignorado",
  ocultar: "Comentario ocultado",
}

export function BandejaComentarios({ inicial }: { inicial: InteraccionDto[] }) {
  const { toast } = useToast()
  const [items, setItems] = useState(inicial)
  const [textos, setTextos] = useState<Record<string, string>>(Object.fromEntries(inicial.map((i) => [i.id, i.respuestaSugerida])))
  const [ocupados, setOcupados] = useState<Set<string>>(new Set())

  function marcarOcupado(id: string, ocupado: boolean) {
    setOcupados((s) => {
      const n = new Set(s)
      if (ocupado) n.add(id)
      else n.delete(id)
      return n
    })
  }

  async function actuar(id: string, accion: Accion) {
    marcarOcupado(id, true)
    try {
      await pedirJson(
        `/api/admin/marketing/interacciones/${id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accion, respuesta: accion === "aprobar" ? textos[id] : undefined }),
        },
        "No se pudo completar la acción. Inténtelo de nuevo",
      )
      setItems((xs) => xs.filter((x) => x.id !== id))
      toast({ title: MENSAJE_OK[accion], tone: "success" })
    } catch (e) {
      // 409: otra persona ya trató el comentario; deja de estar pendiente, así que sale de la lista.
      if (e instanceof ErrorUsuario && e.code === "invalid_state") setItems((xs) => xs.filter((x) => x.id !== id))
      toast({ title: mensajeDeError(e), tone: "danger" })
    } finally {
      marcarOcupado(id, false)
    }
  }

  if (items.length === 0) return <EmptyState title="No hay comentarios pendientes" />

  return (
    <div className="space-y-3">
      {items.map((i) => {
        const ocupado = ocupados.has(i.id)
        const esQueja = i.categoria === "queja"
        return (
          <Card key={i.id}>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{i.autor}</span>
              <Badge tone={esQueja ? "danger" : "neutral"}>{CATEGORIA[i.categoria] ?? i.categoria}</Badge>
            </div>
            <p className="mb-2 text-sm">{i.texto}</p>
            {esQueja ? (
              <p className="text-xs" style={{ color: "var(--ink-soft)" }}>Las quejas no se responden automáticamente: contacte a la persona desde el inbox.</p>
            ) : (
              <Textarea
                value={textos[i.id] ?? ""}
                onChange={(e) => setTextos((t) => ({ ...t, [i.id]: e.target.value }))}
                rows={2}
                aria-label={`Respuesta para ${i.autor}`}
              />
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {!esQueja && <Button onClick={() => actuar(i.id, "aprobar")} disabled={ocupado || !textos[i.id]?.trim()}>Aprobar respuesta</Button>}
              <Button variant="secondary" disabled={ocupado} onClick={() => actuar(i.id, "ignorar")}>Ignorar</Button>
              <Button variant="secondary" disabled={ocupado} onClick={() => actuar(i.id, "ocultar")}>Ocultar comentario</Button>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
