"use client"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Alert, Badge, Button, Card, Field, Input, Textarea, useToast } from "@myd-org/ui"
import type { MaterialDto } from "@/lib/marketing/otros-repo"
import type { PiezaDto } from "@/lib/marketing/tipos"
import { ETIQUETA_ESTADO, ETIQUETA_FORMATO, ETIQUETA_PUBLICO, TONO_ESTADO } from "./etiquetas"
import { SubirMaterial } from "./SubirMaterial"

type Evento = { de: string | null; a: string; actor: string; nota: string; createdAt: string }

export function PiezaDetalle({ pieza, eventos, material }: { pieza: PiezaDto; eventos: Evento[]; material: MaterialDto[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const [caption, setCaption] = useState(pieza.caption)
  const [contenido, setContenido] = useState(JSON.stringify(pieza.contenido, null, 2))
  const [nota, setNota] = useState("")
  const [permalink, setPermalink] = useState("")
  const [ocupado, setOcupado] = useState(false)

  async function accion(body: Record<string, unknown>, ok: string) {
    setOcupado(true)
    try {
      const res = await fetch(`/api/admin/marketing/piezas/${pieza.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      const datos = await res.json()
      if (!res.ok) throw new Error(datos.error ?? "No se pudo completar la acción")
      toast({ title: ok, tone: "success" })
      router.refresh()
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "No se pudo completar la acción", tone: "danger" })
    } finally {
      setOcupado(false)
    }
  }

  function guardarEdicion() {
    let parsed: unknown
    try {
      parsed = JSON.parse(contenido)
    } catch {
      toast({ title: "El contenido no es un JSON válido", tone: "danger" })
      return
    }
    void accion({ accion: "editar", caption, contenido: parsed }, "Cambios guardados. La pieza se volverá a generar.")
  }

  const enRevision = pieza.estado === "para_revisar"
  const esVideo = pieza.renderKey?.endsWith(".mp4")

  return (
    <div className="space-y-4">
      <Link href="/admin/marketing" className="text-sm" style={{ color: "var(--ink-soft)" }}>← Volver al calendario</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold" style={{ color: "var(--ink)" }}>{ETIQUETA_FORMATO[pieza.formato]} · {pieza.plantilla}</h1>
        <Badge tone={TONO_ESTADO[pieza.estado]}>{ETIQUETA_ESTADO[pieza.estado]}</Badge>
        <Badge tone="neutral">{ETIQUETA_PUBLICO[pieza.publico]}</Badge>
        <Badge tone="neutral">Versión {pieza.version}</Badge>
      </div>

      {pieza.alertas.map((a) => (
        <Alert key={`${a.fuente}-${a.regla}`} tone={a.severidad === "alta" ? "danger" : "warning"}>{a.mensaje}</Alert>
      ))}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          {pieza.renderUrl ? (
            esVideo ? <video src={pieza.renderUrl} controls className="w-full rounded" /> : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pieza.renderUrl} alt="" className="w-full rounded" />
            )
          ) : (
            <p className="text-sm" style={{ color: "var(--ink-soft)" }}>Todavía no hay vista previa.</p>
          )}
          {pieza.renderUrl && <a href={pieza.renderUrl} download className="mt-2 inline-block text-sm underline">Descargar</a>}
        </Card>

        <div className="space-y-3">
          {pieza.estado === "esperando_material" && pieza.briefGrabacion && (
            <Card>
              <h2 className="mb-1 font-semibold">Qué grabar</h2>
              <p className="text-sm">{pieza.briefGrabacion.guion}</p>
              <ul className="mt-2 list-disc pl-5 text-sm">{pieza.briefGrabacion.tomas.map((t) => <li key={t}>{t}</li>)}</ul>
              <p className="mt-2 text-xs" style={{ color: "var(--ink-soft)" }}>Duración sugerida: {pieza.briefGrabacion.duracionSeg} s</p>
              <SubirMaterial piezaId={pieza.id} onSubido={() => router.refresh()} />
            </Card>
          )}
          {material.length > 0 && <p className="text-xs" style={{ color: "var(--ink-soft)" }}>Material subido: {material.length} archivo(s)</p>}

          <Field label="Texto de la publicación">
            <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={5} />
          </Field>
          <Field label="Contenido (JSON)">
            <Textarea value={contenido} onChange={(e) => setContenido(e.target.value)} rows={8} className="font-mono text-xs" />
          </Field>
          <Button variant="secondary" disabled={ocupado} onClick={guardarEdicion}>Guardar cambios</Button>

          {enRevision && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={ocupado} onClick={() => accion({ accion: "aprobar" }, "Pieza aprobada")}>Aprobar</Button>
              <Button variant="secondary" disabled={ocupado} onClick={() => accion({ accion: "descartar" }, "Pieza descartada")}>Descartar</Button>
            </div>
          )}
          {enRevision && (
            <div className="space-y-2">
              <Field label="Pedir cambios">
                <Textarea value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Indique qué quiere cambiar" rows={2} />
              </Field>
              <Button variant="secondary" disabled={ocupado || !nota.trim()} onClick={() => accion({ accion: "pedir_cambios", nota }, "Se pidieron los cambios")}>Pedir cambios</Button>
            </div>
          )}
          {pieza.estado === "aprobada" && (
            <div className="space-y-2">
              <Field label="Si la publicó a mano, pegue el enlace">
                <Input value={permalink} onChange={(e) => setPermalink(e.target.value)} placeholder="https://www.instagram.com/p/…" />
              </Field>
              <Button variant="secondary" disabled={ocupado} onClick={() => accion({ accion: "marcar_publicada", permalink }, "Marcada como publicada")}>Marcar como publicada</Button>
            </div>
          )}
        </div>
      </div>

      <Card>
        <h2 className="mb-2 font-semibold">Historial</h2>
        <ul className="space-y-1 text-xs">
          {eventos.map((e, i) => (
            <li key={i}>{new Date(e.createdAt).toLocaleString("es-AR")} · {ETIQUETA_ESTADO[e.a] ?? e.a} · {e.actor}{e.nota ? ` · ${e.nota}` : ""}</li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
