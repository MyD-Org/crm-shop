"use client"

import { useState } from "react"
import { Button, Card, Field, FileDropZone, Input, Select, Switch, Textarea, useToast } from "@myd-org/ui"
import { useUnsavedGuard } from "@/lib/unsaved-guard"
import { marcaSobreOscuro } from "@/lib/tema-contraste"
import {
  COLORES_TEMA,
  DESCRIPCION_MAX,
  ETIQUETAS_COLOR_TEMA,
  EMAIL_MAX,
  NOMBRE_MAX,
  OG_BAJADA_MAX,
  OG_EYEBROW_MAX,
  OG_LUGAR_MAX,
  TITULO_MAX,
  type ColorTema,
} from "@/lib/tienda-online"
import {
  PALETAS_TEMA,
  avisoContrasteForm,
  construirPayload,
  construirPayloadDestinos,
  extensionDeArchivo,
  formDesdeDatos,
  formsDestinosDesdeDatos,
  mensajeSubida,
  placeholdersMarca,
  razonesContrasteForm,
  type CampoImagen,
  type DatosTiendaOnline,
  type FormDestino,
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

const BASES_TEMA = [
  { value: "calido-azul", label: "Azul (el tema actual de la tienda)" },
  { value: "calido", label: "Terracota" },
]

const HEX_COMPLETO = /^#[0-9a-f]{6}$/i
const PRINCIPAL = "principal"

const ACCEPT_IMAGEN = ".svg,.png,.webp,.jpg,.jpeg,image/svg+xml,image/png,image/webp,image/jpeg"
const MAX_IMAGEN = 2 * 1024 * 1024

const IMAGENES: { campo: CampoImagen; label: string; hint: string }[] = [
  { campo: "logoUrl", label: "Logo", hint: "Se muestra en el encabezado. SVG, PNG, WebP o JPG, hasta 2 MB." },
  { campo: "logoMailUrl", label: "Logo para los mails", hint: "Solo PNG o JPG: los mails no muestran SVG ni WebP de forma confiable." },
  { campo: "faviconUrl", label: "Ícono del sitio", hint: "Se ve en la pestaña del navegador. Cuadrado, SVG o PNG." },
  { campo: "ogImagenUrl", label: "Imagen para compartir", hint: "Se ve al compartir el enlace de la tienda. Apaisada, PNG, WebP o JPG." },
]

// Datos → Tienda online: marca que muestra la tienda (`tenants.shop_marca`), su paleta de colores
// (`tenants.shop_tema`) y direcciones del Shop (`shop_url`, `shop_internal_url`). GET/PUT /api/admin/settings/tienda-online; las imágenes se
// suben directo al almacenamiento con una firma de /api/admin/settings/tienda-online/logo.
export function TiendaOnlineForm({ initial, imagenesDisponibles }: Props) {
  const [principal, setPrincipal] = useState<FormTiendaOnline>(() => formDesdeDatos(initial))
  const [destinos, setDestinos] = useState<FormDestino[]>(() => formsDestinosDesdeDatos(initial))
  const [sitio, setSitio] = useState(PRINCIPAL)
  const [guardado, setGuardado] = useState(() => instantanea(formDesdeDatos(initial), formsDestinosDesdeDatos(initial)))
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [subiendo, setSubiendo] = useState<CampoImagen | null>(null)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  useUnsavedGuard(instantanea(principal, destinos) !== guardado)

  // Marca por dominio: el principal guarda en shop_marca/shop_tema; cada dominio extra, en su
  // entrada de shop_destinos_extra. Los errores de un extra llegan como `<etiqueta>.<campo>`.
  const destino = sitio === PRINCIPAL ? null : (destinos.find((d) => d.etiqueta === sitio) ?? null)
  const form = destino ? destino.form : principal
  const clave = (s: string, campo: string) => (s === PRINCIPAL ? campo : `${s}.${campo}`)
  const err = (campo: string) => errores[clave(sitio, campo)]

  const editar = (s: string, fn: (f: FormTiendaOnline) => FormTiendaOnline) => {
    if (s === PRINCIPAL) setPrincipal(fn)
    else setDestinos((ds) => ds.map((d) => (d.etiqueta === s ? { ...d, form: fn(d.form) } : d)))
  }
  const editarDestino = (s: string, cambios: Partial<Omit<FormDestino, "form">>) =>
    setDestinos((ds) => ds.map((d) => (d.etiqueta === s ? { ...d, ...cambios } : d)))
  const limpiarError = (s: string, campo: string) => setErrores((p) => (p[clave(s, campo)] ? { ...p, [clave(s, campo)]: "" } : p))

  const cambiarEn = <K extends keyof FormTiendaOnline>(s: string, k: K, v: FormTiendaOnline[K]) => {
    editar(s, (p) => ({ ...p, [k]: v }))
    limpiarError(s, k)
  }
  const cambiar = <K extends keyof FormTiendaOnline>(k: K, v: FormTiendaOnline[K]) => cambiarEn(sitio, k, v)
  const ponerError = (campo: string, msg: string) => setErrores((p) => ({ ...p, [campo]: msg }))
  const cambiarColor = (c: ColorTema, v: string) => {
    editar(sitio, (p) => ({ ...p, colores: { ...p.colores, [c]: v } }))
    limpiarError(sitio, c)
  }
  const cambiarBaseTema = (base: "calido-azul" | "calido") =>
    // Si todavía no personalizó, los selectores acompañan al tema de partida elegido.
    editar(sitio, (p) => ({ ...p, temaBase: base, colores: p.temaPropio ? p.colores : { ...PALETAS_TEMA[base] } }))

  const enUso = placeholdersMarca(form.base, form.nombre)
  const avisoContraste = avisoContrasteForm(form)
  const razones = form.temaPropio ? razonesContrasteForm(form) : null

  async function subirImagen(campo: CampoImagen, file: File | null) {
    if (!file) return
    // El sitio se fija al empezar: si cambia de sitio durante la subida, la imagen queda en el original.
    const enSitio = sitio
    const errorImagen = (msg: string) => ponerError(clave(enSitio, campo), msg)
    limpiarError(enSitio, campo)
    const ext = extensionDeArchivo(file.name, file.type)
    if (!ext) return errorImagen("El formato de la imagen no es válido. Use SVG, PNG, WebP o JPG.")
    if (file.size > MAX_IMAGEN) return errorImagen("La imagen supera el tamaño permitido (2 MB).")
    setSubiendo(campo)
    try {
      const res = await fetch("/api/admin/settings/tienda-online/logo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ext, bytes: file.size }),
      })
      const firma = await res.json().catch(() => null)
      if (!res.ok) return errorImagen(mensajeSubida(firma))
      const put = await fetch(firma.url, { method: "PUT", headers: firma.headers, body: file })
      if (!put.ok) return errorImagen(mensajeSubida(null))
      cambiarEn(enSitio, campo, firma.publicUrl)
    } catch {
      errorImagen("Error de conexión. Inténtelo nuevamente.")
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
        body: JSON.stringify({
          ...construirPayload(principal),
          ...(destinos.length > 0 ? { destinos: construirPayloadDestinos(destinos) } : {}),
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const campo = typeof body?.campo === "string" ? body.campo : "general"
        // Error de un dominio extra: se muestra ese sitio para que el error quede a la vista.
        const delSitio = destinos.find((d) => campo.startsWith(`${d.etiqueta}.`))
        if (delSitio) setSitio(delSitio.etiqueta)
        else if (!campo.includes(".") && campo !== "general" && campo !== "destinos") setSitio(PRINCIPAL)
        ponerError(campo === "destinos" ? "general" : campo, body?.error ?? "No se pudo guardar la tienda online. Inténtelo nuevamente.")
        return
      }
      const nuevo = formDesdeDatos(body)
      const nuevosDestinos = Array.isArray(body?.destinos) ? formsDestinosDesdeDatos(body) : destinos
      setPrincipal(nuevo)
      setDestinos(nuevosDestinos)
      setGuardado(instantanea(nuevo, nuevosDestinos))
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
      {destinos.length > 0 && (
        <Card title="Sitio" description="Esta tienda se ve en más de un dominio. Elija cuál editar: cada uno puede tener su propia marca.">
          <div className="flex flex-col gap-4">
            <Field label="Sitio que está editando">
              <Select
                value={sitio}
                onValueChange={setSitio}
                options={[
                  { value: PRINCIPAL, label: `Sitio principal${principal.shopUrl ? ` (${principal.shopUrl})` : ""}` },
                  ...destinos.map((d) => ({ value: d.etiqueta, label: `${d.etiqueta} (${d.url})` })),
                ]}
              />
            </Field>
            {destino && (
              <>
                <Switch
                  checked={destino.marcaPropia}
                  onCheckedChange={(v) => editarDestino(destino.etiqueta, { marcaPropia: v })}
                  label="Usar una marca propia en este sitio"
                />
                {!destino.marcaPropia && (
                  <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
                    Este sitio usa la marca y los colores del sitio principal.
                  </p>
                )}
                <Field
                  label="Remitente de los mails"
                  hint="Dirección desde la que salen los mails de los pedidos hechos en este sitio. Si la deja vacía, se usa la de la empresa."
                  error={err("remitente")}
                >
                  <Input
                    type="email"
                    value={destino.remitente}
                    maxLength={EMAIL_MAX}
                    placeholder="pedidos@tienda.example"
                    onChange={(e) => {
                      editarDestino(destino.etiqueta, { remitente: e.target.value })
                      limpiarError(destino.etiqueta, "remitente")
                    }}
                  />
                </Field>
              </>
            )}
          </div>
        </Card>
      )}

      {(!destino || destino.marcaPropia) && (
        <>
          <Card title="Marca" description="Cómo se presenta la tienda. Los campos vacíos usan el valor de partida y muestran en gris el valor en uso.">
            <div className="flex flex-col gap-4">
              <Field label="Textos de partida" hint="Qué textos y secciones se muestran mientras no los edite." error={err("base")}>
                <Select value={form.base} onValueChange={(v) => cambiar("base", v === "generica" ? "generica" : "central")} options={BASES} />
              </Field>
              <Field label="Nombre de la tienda" hint={`Hasta ${NOMBRE_MAX} caracteres.${hintEntorno(enUso.dependeDelEntorno, form.nombre)}`} error={err("nombre")}>
                <Input value={form.nombre} placeholder={enUso.nombre} maxLength={NOMBRE_MAX} onChange={(e) => cambiar("nombre", e.target.value)} />
              </Field>
              <Field label="Título del sitio" hint={`Lo que ve en la pestaña del navegador. Hasta ${TITULO_MAX} caracteres.`} error={err("titulo")}>
                <Input value={form.titulo} placeholder={enUso.titulo} maxLength={TITULO_MAX} onChange={(e) => cambiar("titulo", e.target.value)} />
              </Field>
              <Field label="Descripción" hint={`Para buscadores y al compartir el enlace. Hasta ${DESCRIPCION_MAX} caracteres.`} error={err("descripcion")}>
                <Textarea value={form.descripcion} placeholder={enUso.descripcion} maxLength={DESCRIPCION_MAX} rows={3} onChange={(e) => cambiar("descripcion", e.target.value)} />
              </Field>
              <Field label="Email de contacto" hint={`Hasta ${EMAIL_MAX} caracteres.`} error={err("emailContacto")}>
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
                <Field key={campo} label={label} hint={hint} error={err(campo)}>
                  <div className="flex flex-col gap-2">
                    {!form[campo] && (
                      <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
                        En uso: el de la tienda
                      </p>
                    )}
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
              <Field label="Texto superior" hint={`Hasta ${OG_EYEBROW_MAX} caracteres.`} error={err("ogTextos")}>
                <Input value={form.ogEyebrow} placeholder={enUso.ogEyebrow} maxLength={OG_EYEBROW_MAX} onChange={(e) => cambiar("ogEyebrow", e.target.value)} />
              </Field>
              <Field label="Bajada" hint={`Hasta ${OG_BAJADA_MAX} caracteres.`}>
                <Input value={form.ogBajada} placeholder={enUso.ogBajada} maxLength={OG_BAJADA_MAX} onChange={(e) => cambiar("ogBajada", e.target.value)} />
              </Field>
              <Field label="Lugar" hint={`Hasta ${OG_LUGAR_MAX} caracteres.`}>
                <Input value={form.ogLugar} placeholder={enUso.ogLugar} maxLength={OG_LUGAR_MAX} onChange={(e) => cambiar("ogLugar", e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card
            title="Tema"
            description="Los colores de la tienda. Si no los personaliza, se usa el tema de partida, cuyos colores se muestran abajo."
          >
            <div className="flex flex-col gap-4">
              <Field label="Tema de partida" error={err("temaBase")}>
                <Select value={form.temaBase} onValueChange={(v) => cambiarBaseTema(v === "calido" ? "calido" : "calido-azul")} options={BASES_TEMA} />
              </Field>
              <Switch
                checked={form.temaPropio}
                onCheckedChange={(v) => {
                  editar(sitio, (p) => ({ ...p, temaPropio: v, colores: v ? p.colores : { ...PALETAS_TEMA[p.temaBase] } }))
                  limpiarError(sitio, "colores")
                }}
                label="Personalizar los colores"
              />
              {!form.temaPropio && <PaletaEnUso colores={PALETAS_TEMA[form.temaBase]} />}
              {form.temaPropio && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {COLORES_TEMA.map((c) => {
                      const valor = form.colores[c]
                      return (
                        <Field key={c} label={ETIQUETAS_COLOR_TEMA[c]} error={err(c)}>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              aria-label={`Elegir color: ${ETIQUETAS_COLOR_TEMA[c]}`}
                              value={HEX_COMPLETO.test(valor.trim()) ? valor.trim().toLowerCase() : "#000000"}
                              onChange={(e) => cambiarColor(c, e.target.value)}
                              className="h-9 w-12 shrink-0 cursor-pointer rounded border p-0.5"
                            />
                            <Input
                              value={valor}
                              maxLength={7}
                              placeholder="#rrggbb"
                              aria-label={`Código del color: ${ETIQUETAS_COLOR_TEMA[c]}`}
                              onChange={(e) => cambiarColor(c, e.target.value)}
                            />
                          </div>
                        </Field>
                      )
                    })}
                  </div>
                  {err("colores") && <p className="text-sm" style={{ color: "var(--red)" }}>{err("colores")}</p>}
                  {avisoContraste && <p className="text-sm" style={{ color: "var(--red)" }}>{avisoContraste.error}</p>}
                  {razones && (
                    <ul className="text-xs flex flex-col gap-0.5" style={{ color: "var(--ink-soft)" }}>
                      {razones.map((r) => (
                        <li key={r.campo}>
                          {r.descripcion}: contraste {r.razon.toFixed(1).replace(".", ",")}:1 {r.ok ? "(correcto)" : "(insuficiente)"}
                        </li>
                      ))}
                    </ul>
                  )}
                  <VistaPreviaTema colores={form.colores} />
                </>
              )}
            </div>
          </Card>

        </>
      )}

      {!destino && (
        <Card title="Direcciones" description="Direcciones de la tienda de esta empresa. Vacías = rige la configuración general.">
          <div className="flex flex-col gap-4">
            <Field
              label="Dirección pública"
              hint="Es la que se enlaza en mails y en el portal. Debe comenzar con https:// y no incluir ruta."
              error={err("shopUrl")}
            >
              <Input type="url" value={form.shopUrl} placeholder="https://tienda.example" onChange={(e) => cambiar("shopUrl", e.target.value)} />
            </Field>
            <Field
              label="Dirección interna"
              hint="A la que el CRM avisa cuando cambian los datos de la tienda. Si la deja vacía, se usa la pública."
              error={err("shopInternalUrl")}
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
      )}

      {errores.general && <p className="text-sm" style={{ color: "var(--red)" }}>{errores.general}</p>}
      <div>
        <Button onClick={handleSave} loading={saving} disabled={saving || subiendo !== null}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  )
}

/** Para detectar cambios sin guardar en cualquiera de los sitios. */
function instantanea(principal: FormTiendaOnline, destinos: FormDestino[]): string {
  return JSON.stringify({ principal, destinos })
}

/** Aviso cuando el valor en uso depende de una variable del Shop: el admin no lo conoce y no lo inventa. */
function hintEntorno(depende: boolean, nombre: string): string {
  return depende && !nombre.trim() ? " Con los textos neutros, el valor en uso depende de la configuración de la tienda." : ""
}

/** Colores en uso del tema de partida (solo lectura). Los colores van en línea: son datos, no estilos del sistema. */
function PaletaEnUso({ colores }: { colores: Record<ColorTema, string> }) {
  return (
    <ul aria-label="Colores en uso" className="grid gap-3 sm:grid-cols-2">
      {COLORES_TEMA.map((c) => (
        <li key={c} className="flex items-center gap-2">
          <span aria-hidden className="h-9 w-12 shrink-0 rounded border" style={{ background: colores[c] }} />
          <span className="text-sm">
            {ETIQUETAS_COLOR_TEMA[c]}
            <span className="block text-xs" style={{ color: "var(--ink-soft)" }}>{colores[c]}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Maqueta mínima de la tienda con la paleta elegida (los colores del usuario van en línea: son datos, no estilos del sistema). */
function VistaPreviaTema({ colores }: { colores: Record<ColorTema, string> }) {
  const ok = COLORES_TEMA.every((c) => HEX_COMPLETO.test(colores[c].trim()))
  if (!ok) return null
  const c = Object.fromEntries(COLORES_TEMA.map((k) => [k, colores[k].trim().toLowerCase()])) as Record<ColorTema, string>
  return (
    <div aria-label="Vista previa del tema" className="overflow-hidden rounded-lg border" style={{ background: c.bg, color: c.text }}>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm font-semibold">Así se verán los textos sobre el fondo</p>
        <p className="text-xs" style={{ color: c.muted }}>Texto secundario, como descripciones y ayudas.</p>
        <div className="rounded-md p-3 flex flex-col gap-2" style={{ background: c.surface }}>
          <p className="text-sm">
            Una tarjeta con un <span style={{ color: c.accent, fontWeight: 600 }}>enlace de acento</span>
          </p>
          <span className="inline-block self-start rounded-md px-3 py-1.5 text-sm" style={{ background: c.primary, color: c.onPrimary }}>
            Botón principal
          </span>
        </div>
      </div>
      <div className="p-3 text-sm" style={{ background: c.surfaceDark, color: marcaSobreOscuro(c.accent) }}>
        Pie de página
      </div>
    </div>
  )
}
