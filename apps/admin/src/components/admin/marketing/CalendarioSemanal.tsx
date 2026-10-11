"use client"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Badge, Button, useToast, type RenderLink } from "@myd-org/ui"
import type { PiezaDto } from "@/lib/marketing/tipos"
import { ETIQUETA_ESTADO, ETIQUETA_FORMATO, TONO_ESTADO } from "./etiquetas"
import { mensajeDeError, pedirJson } from "./pedir-json"

const NOMBRE_DIA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]

// El botón del design system se renderiza como <Link> de Next (evita un <button> dentro de un <a>).
const renderLink: RenderLink = ({ href, className, children, ...resto }) => (
  <Link href={href} className={className} aria-label={resto["aria-label"]}>{children}</Link>
)

function corrida(dia: string, dias: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function CalendarioSemanal({ dias, grupos }: { dias: string[]; grupos: Record<string, PiezaDto[]> }) {
  const router = useRouter()
  const { toast } = useToast()
  const [ocupado, setOcupado] = useState(false)
  const storiesEnRevision = dias.flatMap((d) => grupos[d] ?? []).filter((p) => p.formato === "story" && p.estado === "para_revisar").length

  async function llamar(url: string, body: unknown, ok: string) {
    setOcupado(true)
    try {
      await pedirJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      toast({ title: ok, tone: "success" })
      router.refresh()
    } catch (e) {
      toast({ title: mensajeDeError(e), tone: "danger" })
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" href={`/admin/marketing?semana=${corrida(dias[0], -7)}`} renderLink={renderLink}>← Semana anterior</Button>
        <Button variant="secondary" href={`/admin/marketing?semana=${corrida(dias[0], 7)}`} renderLink={renderLink}>Semana siguiente →</Button>
        <div className="flex-1" />
        <Button variant="secondary" disabled={ocupado} onClick={() => llamar("/api/admin/marketing/solicitudes", { tipo: "plan_semana" }, "Se pidió un nuevo plan. Aparecerá en la próxima corrida del planificador.")}>
          Planificar semana
        </Button>
        <Button disabled={ocupado || storiesEnRevision === 0} onClick={() => llamar("/api/admin/marketing/piezas/aprobar-stories", { desde: dias[0], hasta: corrida(dias[6], 1) }, "Stories aprobadas")}>
          {storiesEnRevision === 1 ? "Aprobar 1 story" : `Aprobar ${storiesEnRevision} stories`}
        </Button>
      </div>

      {(grupos.sin_fecha?.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--ink)" }}>Esperando material</h2>
          <div className="flex flex-wrap gap-2">{grupos.sin_fecha.map((p) => <div key={p.id} className="w-44"><TarjetaPieza pieza={p} /></div>)}</div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4 lg:grid-cols-7">
        {dias.map((dia, i) => (
          <section key={dia} className="rounded-lg border p-2" style={{ borderColor: "var(--line)" }}>
            <h2 className="mb-2 text-xs font-semibold" style={{ color: "var(--ink-soft)" }}>{NOMBRE_DIA[i]} {dia.slice(8)}/{dia.slice(5, 7)}</h2>
            <div className="space-y-2">
              {(grupos[dia] ?? []).map((p) => <TarjetaPieza key={p.id} pieza={p} />)}
              {(grupos[dia] ?? []).length === 0 && <p className="text-xs" style={{ color: "var(--ink-soft)" }}>Sin piezas</p>}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function TarjetaPieza({ pieza }: { pieza: PiezaDto }) {
  return (
    <Link href={`/admin/marketing/${pieza.id}`} className="block rounded-md border p-2 hover:opacity-90" style={{ borderColor: "var(--line)" }}>
      {pieza.portadaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={pieza.portadaUrl} alt="Vista previa de la pieza" className="mb-2 aspect-[4/5] w-full rounded object-cover" />
      ) : (
        <div className="mb-2 flex aspect-[4/5] w-full items-center justify-center rounded text-xs" style={{ background: "var(--surface-2)", color: "var(--ink-soft)" }}>
          Sin vista previa
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        <Badge tone={TONO_ESTADO[pieza.estado] ?? "neutral"}>{ETIQUETA_ESTADO[pieza.estado] ?? pieza.estado}</Badge>
        <Badge tone="neutral">{ETIQUETA_FORMATO[pieza.formato] ?? pieza.formato}</Badge>
        {pieza.alertas.length > 0 && <Badge tone="danger">{pieza.alertas.length} alerta(s)</Badge>}
      </div>
      <p className="mt-1 line-clamp-2 text-xs" style={{ color: "var(--ink)" }}>{pieza.caption || pieza.plantilla}</p>
    </Link>
  )
}
