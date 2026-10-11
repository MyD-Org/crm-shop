"use client"
import { useState } from "react"
import { Button, useToast } from "@myd-org/ui"

// Sube un video o una foto desde el celular directo a R2 (URL firmada) y confirma al CRM.
export function SubirMaterial({ piezaId, onSubido }: { piezaId: string; onSubido: () => void }) {
  const { toast } = useToast()
  const [subiendo, setSubiendo] = useState(false)

  async function subir(archivo: File) {
    setSubiendo(true)
    try {
      const url = `/api/admin/marketing/piezas/${piezaId}/material`
      const firma = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contentType: archivo.type, bytes: archivo.size }) })
      const f = await firma.json()
      if (!firma.ok) throw new Error(f.error ?? "No se pudo preparar la subida")
      const put = await fetch(f.url, { method: "PUT", headers: f.headers, body: archivo })
      if (!put.ok) throw new Error("No se pudo subir el archivo. Inténtelo de nuevo")
      const confirmar = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: f.key, contentType: archivo.type, bytes: archivo.size }) })
      if (!confirmar.ok) throw new Error((await confirmar.json()).error ?? "No se pudo confirmar la subida")
      toast({ title: "Material subido. La pieza se generará en unos minutos.", tone: "success" })
      onSubido()
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "No se pudo subir el archivo", tone: "danger" })
    } finally {
      setSubiendo(false)
    }
  }

  return (
    <div className="mt-3">
      <input
        type="file"
        accept="video/mp4,video/quicktime,image/jpeg,image/png,image/webp"
        capture="environment"
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
