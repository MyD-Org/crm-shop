"use client"

import { useState } from "react"
import { Mail } from "lucide-react"
import { Alert, Button, Checkbox, Dialog, Field, Input, Switch, useToast } from "@myd-org/ui"
import { NOMBRE_CASILLA_MAX } from "@/lib/correo-admin-constantes"
import { cambiosPendientes, type CasillaEditable } from "@/lib/correo-casillas-cambios"

interface Usuario {
  id: string
  name: string
  email: string
}

// Dialog "Administrar casillas" (solo admin+; mismo patrón que CanalesNombresEditor del inbox).
// Lista las inboxes de Resend, permite activarlas, nombrarlas y tildar qué operadores acceden a
// cada una. Admin y superadmin ven todas las casillas activas sin necesidad de tildar.
export function CasillasAccesoEditor() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [original, setOriginal] = useState<CasillaEditable[]>([])
  const [draft, setDraft] = useState<CasillaEditable[]>([])
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const { toast } = useToast()

  const cargar = async () => {
    setLoading(true)
    setError(null)
    setAviso(null)
    try {
      // Primero sincroniza con Resend (alta de inboxes nuevas, inactivas). Si Resend no responde,
      // se muestran igual las casillas ya cargadas.
      let res = await fetch("/api/admin/correo/casillas/sincronizar", { method: "POST", cache: "no-store" })
      if (!res.ok) {
        const fallo = await res.json().catch(() => null)
        res = await fetch("/api/admin/correo/casillas", { cache: "no-store" })
        if (res.ok) setAviso(fallo?.error ?? "No se pudo consultar el servicio de correo; se muestran las casillas ya cargadas.")
      }
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? "No se pudieron cargar las casillas.")
      setOriginal(data.casillas)
      setDraft(data.casillas.map((c: CasillaEditable) => ({ ...c, adminUserIds: [...c.adminUserIds] })))
      setUsuarios(data.usuarios)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las casillas.")
    } finally {
      setLoading(false)
    }
  }

  const abrir = () => {
    setOpen(true)
    void cargar()
  }

  const editar = (id: string, cambio: Partial<CasillaEditable>) =>
    setDraft((d) => d.map((c) => (c.id === id ? { ...c, ...cambio } : c)))

  const alternarUsuario = (casilla: CasillaEditable, userId: string, marcado: boolean) =>
    editar(casilla.id, {
      adminUserIds: marcado ? [...new Set([...casilla.adminUserIds, userId])] : casilla.adminUserIds.filter((u) => u !== userId),
    })

  const cambios = cambiosPendientes(original, draft)

  const guardar = async () => {
    setSaving(true)
    try {
      for (const c of cambios) {
        if (c.datos) {
          const r = await fetch(`/api/admin/correo/casillas/${c.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(c.datos),
          })
          if (!r.ok) throw new Error((await r.json().catch(() => null))?.error)
        }
        if (c.accesos) {
          const r = await fetch(`/api/admin/correo/casillas/${c.id}/accesos`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ admin_user_ids: c.accesos }),
          })
          if (!r.ok) throw new Error((await r.json().catch(() => null))?.error)
        }
      }
      setOpen(false)
      toast({ title: "Casillas guardadas", tone: "success" })
    } catch (e) {
      toast({ title: "No se pudieron guardar los cambios", description: e instanceof Error ? e.message : undefined, tone: "danger" })
      // Parte de los cambios pudo haberse aplicado: se recarga para mostrar el estado real.
      void cargar()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={abrir}>
        <Mail className="w-4 h-4" />
        Administrar casillas
      </Button>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Administrar casillas"
        description="Active las casillas de correo que se usarán en el CRM, póngales un nombre y seleccione qué operadores pueden acceder a cada una. Los administradores acceden a todas las casillas activas."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button size="sm" onClick={guardar} disabled={saving || loading || !!error || cambios.length === 0}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          {loading ? (
            <p className="text-sm" style={{ color: "var(--ink-soft)" }}>Cargando casillas…</p>
          ) : error ? (
            <div className="flex flex-col gap-3 items-start">
              <Alert tone="danger">{error}</Alert>
              <Button variant="secondary" size="sm" onClick={cargar}>
                Reintentar
              </Button>
            </div>
          ) : (
            <>
              {aviso && <Alert tone="warning">{aviso}</Alert>}
              {!draft.length ? (
                <p className="text-sm" style={{ color: "var(--ink-soft)" }}>No hay casillas de correo para administrar.</p>
              ) : (
                draft.map((c) => (
                  <section
                    key={c.id}
                    className="flex flex-col gap-3 p-4 rounded-[var(--radius)]"
                    style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                    aria-label={`Casilla ${c.email}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium break-all" style={{ color: "var(--ink)" }}>{c.email}</p>
                      <Switch
                        checked={c.activa}
                        onCheckedChange={(v) => editar(c.id, { activa: v })}
                        label={c.activa ? "Activa" : "Inactiva"}
                        aria-label={`Activar la casilla ${c.email}`}
                      />
                    </div>
                    <Field label="Nombre visible">
                      <Input
                        value={c.nombre}
                        maxLength={NOMBRE_CASILLA_MAX}
                        placeholder="Por ejemplo, Ventas"
                        onChange={(e) => editar(c.id, { nombre: e.target.value })}
                      />
                    </Field>
                    <div className="flex flex-col gap-2">
                      <p className="text-xs font-semibold" style={{ color: "var(--ink-soft)" }}>Operadores con acceso</p>
                      {!usuarios.length ? (
                        <p className="text-sm" style={{ color: "var(--ink-soft)" }}>No hay operadores para asignar.</p>
                      ) : (
                        usuarios.map((u) => {
                          const id = `casilla-${c.id}-${u.id}`
                          return (
                            <label key={u.id} htmlFor={id} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--ink)" }}>
                              <Checkbox
                                id={id}
                                checked={c.adminUserIds.includes(u.id)}
                                onCheckedChange={(v) => alternarUsuario(c, u.id, v)}
                              />
                              <span>{u.name}</span>
                              <span className="text-xs" style={{ color: "var(--ink-soft)" }}>{u.email}</span>
                            </label>
                          )
                        })
                      )}
                    </div>
                  </section>
                ))
              )}
            </>
          )}
        </div>
      </Dialog>
    </>
  )
}
