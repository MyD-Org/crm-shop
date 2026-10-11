"use client"
import { useState } from "react"
import { Button, useToast } from "@myd-org/ui"
import { ErrorUsuario, mensajeDeError, pedirJson } from "./pedir-json"

const ERROR_SUBIDA = "No se pudo subir el archivo. Inténtelo de nuevo"

// Sube un video o una foto desde el celular directo a R2 (URL firmada) y confirma al CRM.
export function SubirMaterial({ piezaId, onSubido }: { piezaId: string; onSubido: () => void }) {
  const { toast } = useToast()
  const [subiendo, setSubiendo] = useState(false)

  async function subir(archivo: File) {
    setSubiendo(true)
    try {
      const url = `/api/admin/marketing/piezas/${piezaId}/material`
      const cuerpo = JSON.stringify({ contentType: archivo.type, bytes: archivo.size })
      const f = await pedirJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: cuerpo }, ERROR_SUBIDA)
      let put: Response | null = null
      try {
        put = await fetch(String(f.url), { method: "PUT", headers: f.headers as Record<string, string>, body: archivo })
      } catch {
        put = null
      }
      if (!put?.ok) throw new ErrorUsuario(ERROR_SUBIDA)
      await pedirJson(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: f.key, contentType: archivo.type, bytes: archivo.size }) }, ERROR_SUBIDA)
      toast({ title: "Material subido. La pieza se generará en unos minutos.", tone: "success" })
      onSubido()
    } catch (e) {
      toast({ title: mensajeDeError(e, ERROR_SUBIDA), tone: "danger" })
    } finally {
      setSubiendo(false)
    }
  }

  return (
    <div className="mt-3">
      <input
        type="file"
        accept="video/mp4,video/quicktime,image/jpeg,image/png,image/webp"
        disabled={subiendo}
        onChange={(e) => {
          const archivo = e.target.files?.[0]
          e.target.value = ""
          if (archivo) void subir(archivo)
        }}
        className="hidden"
        id={`material-${piezaId}`}
      />
      <Button disabled={subiendo} onClick={() => document.getElementById(`material-${piezaId}`)?.click()}>{subiendo ? "Subiendo…" : "Subir material"}</Button>
    </div>
  )
}
