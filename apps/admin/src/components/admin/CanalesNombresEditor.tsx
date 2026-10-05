"use client"

import { useState } from "react"
import { Pencil } from "lucide-react"
import { Button, Dialog, Field, Input, Tooltip, useToast } from "@myd-org/ui"
import {
  NOMBRE_MAX,
  canalesEditables,
  parseWhatsappNumbers,
  type CanalContacto,
  type CanalEditable,
} from "@/lib/inbox-canales"

interface Props {
  contacts: CanalContacto[]
  nombres: Record<string, string>
  onSaved: (nombres: Record<string, string>) => void
}

// Editor de los nombres de los canales del inbox (solo admin). Lista los números de WhatsApp
// de ai-api más los canales que aparecen en los contactos, con un campo por canal.
export function CanalesNombresEditor({ contacts, nombres, onSaved }: Props) {
  const [open, setOpen] = useState(false)
  const [canales, setCanales] = useState<CanalEditable[]>([])
  const [form, setForm] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  const abrir = async () => {
    setOpen(true)
    setForm({ ...nombres })
    setLoading(true)
    let numeros: ReturnType<typeof parseWhatsappNumbers> = []
    try {
      const res = await fetch("/api/admin/whatsapp-numbers", { cache: "no-store" })
      if (res.ok) numeros = parseWhatsappNumbers(await res.json())
    } catch {
      // Sin la lista de ai-api se editan igual los canales que ya aparecen en los contactos.
    }
    setCanales(canalesEditables(contacts, numeros))
    setLoading(false)
  }

  const guardar = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/admin/inbox/canales", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nombres: Object.fromEntries(canales.map((c) => [c.key, form[c.key] ?? ""])) }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error)
      onSaved(data.nombres)
      setOpen(false)
      toast({ title: "Nombres guardados", tone: "success" })
    } catch (e) {
      toast({ title: "No se pudieron guardar los nombres", description: e instanceof Error ? e.message : undefined, tone: "danger" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Tooltip content="Nombres de los canales">
        <Button variant="ghost" size="icon" aria-label="Nombres de los canales" onClick={abrir}>
          <Pencil className="w-4 h-4" />
        </Button>
      </Tooltip>

      <Dialog
        dismissible={false}
        open={open}
        onOpenChange={setOpen}
        title="Nombres de los canales"
        description="Indique un nombre para cada canal (por ejemplo, la sucursal). Si lo deja vacío, se muestra el teléfono o el nombre del canal."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button size="sm" onClick={guardar} disabled={saving || loading}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {loading ? (
            <p className="text-sm" style={{ color: "var(--ink-soft)" }}>Cargando canales…</p>
          ) : !canales.length ? (
            <p className="text-sm" style={{ color: "var(--ink-soft)" }}>No hay canales para nombrar.</p>
          ) : (
            canales.map((c) => (
              <Field key={c.key} label={c.referencia}>
                <Input
                  value={form[c.key] ?? ""}
                  maxLength={NOMBRE_MAX}
                  placeholder="Nombre del canal"
                  onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))}
                />
              </Field>
            ))
          )}
        </div>
      </Dialog>
    </>
  )
}
