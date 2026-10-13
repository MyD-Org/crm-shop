"use client"

import { useState } from "react"
import { Button, Card, Field, FileDropZone, Input, Select, Textarea, useToast } from "@myd-org/ui"
import { useUnsavedGuard } from "@/lib/unsaved-guard"
import {
  DESCRIPCION_MAX,
  EMAIL_MAX,
  NOMBRE_MAX,
  OG_BAJADA_MAX,
  OG_EYEBROW_MAX,
  OG_LUGAR_MAX,
  TITULO_MAX,
} from "@/lib/tienda-online"
import {
  construirPayload,
  extensionDeArchivo,
  formDesdeDatos,
  mensajeSubida,
  type CampoImagen,
  type DatosTiendaOnline,
  type FormTiendaOnline,
} from "@/lib/tienda-online-form"

interface Props {
  initial: DatosTiendaOnline
  /** ¿Está configurado el almacenamiento de imágenes (bucket público)? Sin él no se puede subir. */
  imagenesDisponibles: boolean
}

const BASES = [
  { value: "central", label: "Los textos actuales de la tienda" },
  { value: "generica", label: "Textos neutros (recomendado para una tienda nueva)" },
]

const ACCEPT_IMAGEN = ".svg,.png,.webp,.jpg,.jpeg,image/svg+xml,image/png,image/webp,image/jpeg"
const MAX_IMAGEN = 2 * 1024 * 1024

const IMAGENES: { campo: CampoImagen; label: string; hint: string }[] = [
  { campo: "logoUrl", label: "Logo", hint: "Se muestra en el encabezado. SVG, PNG, WebP o JPG, hasta 2 MB." },
  { campo: "logoMailUrl", label: "Logo para los mails", hint: "Solo PNG o JPG: los mails no muestran SVG ni WebP de forma confiable." },
  { campo: "faviconUrl", label: "Ícono del sitio", hint: "Se ve en la pestaña del navegador. Cuadrado, SVG o PNG." },
  { campo: "ogImagenUrl", label: "Imagen para compartir", hint: "Se ve al compartir el enlace de la tienda. Apaisada, PNG, WebP o JPG." },
]

// Datos → Tienda online: marca que muestra la tienda (`tenants.shop_marca`) y direcciones del Shop
// (`shop_url`, `shop_internal_url`). GET/PUT /api/admin/settings/tienda-online; las imágenes se
// suben directo al almacenamiento con una firma de /api/admin/settings/tienda-online/logo.
export function TiendaOnlineForm({ initial, imagenesDisponibles }: Props) {
  const [form, setForm] = useState<FormTiendaOnline>(() => formDesdeDatos(initial))
  const [guardado, setGuardado] = useState(() => JSON.stringify(formDesdeDatos(initial)))
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [subiendo, setSubiendo] = useState<CampoImagen | null>(null)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  useUnsavedGuard(JSON.stringify(form) !== guardado)

  const cambiar = <K extends keyof FormTiendaOnline>(k: K, v: FormTiendaOnline[K]) => {
    setForm((p) => ({ ...p, [k]: v }))
    setErrores((p) => (p[k] ? { ...p, [k]: "" } : p))
  }
  const ponerError = (campo: string, msg: string) => setErrores((p) => ({ ...p, [campo]: msg }))

  async function subirImagen(campo: CampoImagen, file: File | null) {
    if (!file) return
    setErrores((p) => ({ ...p, [campo]: "" }))
    const ext = extensionDeArchivo(file.name, file.type)
    if (!ext) return ponerError(campo, "El formato de la imagen no es válido. Use SVG, PNG, WebP o JPG.")
    if (file.size > MAX_IMAGEN) return ponerError(campo, "La imagen supera el tamaño permitido (2 MB).")
    setSubiendo(campo)
    try {
      const res = await fetch("/api/admin/settings/tienda-online/logo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ext, bytes: file.size }),
      })
      const firma = await res.json().catch(() => null)
      if (!res.ok) return ponerError(campo, mensajeSubida(firma))
      const put = await fetch(firma.url, { method: "PUT", headers: firma.headers, body: file })
      if (!put.ok) return ponerError(campo, mensajeSubida(null))
      cambiar(campo, firma.publicUrl)
    } catch {
      ponerError(campo, "Error de conexión. Inténtelo nuevamente.")
    } finally {
      setSubiendo(null)
    }
  }

  async function handleSave() {
    setSaving(true)
    setErrores({})
    try {
      const res = await fetch("/api/admin/settings/tienda-online", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(construirPayload(form)),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        ponerError(
          typeof body?.campo === "string" ? body.campo : "general",
          body?.error ?? "No se pudo guardar la tienda online. Inténtelo nuevamente.",
        )
        return
      }
      const nuevo = formDesdeDatos(body)
      setForm(nuevo)
      setGuardado(JSON.stringify(nuevo))
      toast(
        body.propagado
          ? { title: "Tienda online guardada", tone: "success" }
          : {
              title: "Tienda online guardada",
              description: "La tienda aún no recibió el aviso; los cambios pueden demorar unos minutos en verse.",
              tone: "success",
            },
      )
    } catch {
      ponerError("general", "Error de conexión. Inténtelo nuevamente.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <Card title="Marca" description="Cómo se presenta la tienda. Los campos vacíos usan el valor de partida.">
        <div className="flex flex-col gap-4">
          <Field label="Textos de partida" hint="Qué textos y secciones se muestran mientras no los edite." error={errores.base}>
            <Select value={form.base} onValueChange={(v) => cambiar("base", v === "generica" ? "generica" : "central")} options={BASES} />
          </Field>
          <Field label="Nombre de la tienda" hint={`Hasta ${NOMBRE_MAX} caracteres.`} error={errores.nombre}>
            <Input value={form.nombre} maxLength={NOMBRE_MAX} onChange={(e) => cambiar("nombre", e.target.value)} />
          </Field>
          <Field label="Título del sitio" hint={`Lo que ve en la pestaña del navegador. Hasta ${TITULO_MAX} caracteres.`} error={errores.titulo}>
            <Input value={form.titulo} maxLength={TITULO_MAX} onChange={(e) => cambiar("titulo", e.target.value)} />
          </Field>
          <Field label="Descripción" hint={`Para buscadores y al compartir el enlace. Hasta ${DESCRIPCION_MAX} caracteres.`} error={errores.descripcion}>
            <Textarea value={form.descripcion} maxLength={DESCRIPCION_MAX} rows={3} onChange={(e) => cambiar("descripcion", e.target.value)} />
          </Field>
          <Field label="Email de contacto" hint={`Hasta ${EMAIL_MAX} caracteres.`} error={errores.emailContacto}>
            <Input type="email" value={form.emailContacto} maxLength={EMAIL_MAX} onChange={(e) => cambiar("emailContacto", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title="Imágenes" description="Los archivos se guardan en el almacenamiento de imágenes de la tienda.">
        <div className="flex flex-col gap-5">
          {!imagenesDisponibles && (
            <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
              El almacenamiento de imágenes no está configurado: por ahora no es posible subir archivos. Avise al administrador.
            </p>
          )}
          {IMAGENES.map(({ campo, label, hint }) => (
            <Field key={campo} label={label} hint={hint} error={errores[campo]}>
              <div className="flex flex-col gap-2">
                {form[campo] && (
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element -- el host es el bucket público de medios, fuera de los dominios de next/image */}
                    <img src={form[campo]} alt={`Vista previa: ${label}`} className="h-12 max-w-40 object-contain" />
                    <Button variant="link" onClick={() => cambiar(campo, "")}>
                      Quitar
                    </Button>
                  </div>
                )}
                <FileDropZone
                  file={null}
                  onChange={(f) => void subirImagen(campo, f)}
                  accept={ACCEPT_IMAGEN}
                  disabled={!imagenesDisponibles || subiendo !== null}
                  size="sm"
                  title={subiendo === campo ? "Subiendo…" : form[campo] ? "Reemplazar la imagen" : "Arrastre la imagen aquí"}
                />
              </div>
            </Field>
          ))}
        </div>
      </Card>

      <Card title="Imagen para compartir" description="Textos que acompañan la imagen que se ve al compartir el enlace de la tienda.">
        <div className="flex flex-col gap-4">
          <Field label="Texto superior" hint={`Hasta ${OG_EYEBROW_MAX} caracteres.`} error={errores.ogTextos}>
            <Input value={form.ogEyebrow} maxLength={OG_EYEBROW_MAX} onChange={(e) => cambiar("ogEyebrow", e.target.value)} />
          </Field>
          <Field label="Bajada" hint={`Hasta ${OG_BAJADA_MAX} caracteres.`}>
            <Input value={form.ogBajada} maxLength={OG_BAJADA_MAX} onChange={(e) => cambiar("ogBajada", e.target.value)} />
          </Field>
          <Field label="Lugar" hint={`Hasta ${OG_LUGAR_MAX} caracteres.`}>
            <Input value={form.ogLugar} maxLength={OG_LUGAR_MAX} onChange={(e) => cambiar("ogLugar", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title="Sitio" description="Direcciones de la tienda de esta empresa. Vacías = rige la configuración general.">
        <div className="flex flex-col gap-4">
          <Field
            label="Dirección pública"
            hint="Es la que se enlaza en mails y en el portal. Debe comenzar con https:// y no incluir ruta."
            error={errores.shopUrl}
          >
            <Input type="url" value={form.shopUrl} placeholder="https://tienda.example" onChange={(e) => cambiar("shopUrl", e.target.value)} />
          </Field>
          <Field
            label="Dirección interna"
            hint="A la que el CRM avisa cuando cambian los datos de la tienda. Si la deja vacía, se usa la pública."
            error={errores.shopInternalUrl}
          >
            <Input
              type="url"
              value={form.shopInternalUrl}
              placeholder="https://tienda.example"
              onChange={(e) => cambiar("shopInternalUrl", e.target.value)}
            />
          </Field>
        </div>
      </Card>

      {errores.general && <p className="text-sm" style={{ color: "var(--red)" }}>{errores.general}</p>}
      <div>
        <Button onClick={handleSave} loading={saving} disabled={saving || subiendo !== null}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  )
}
