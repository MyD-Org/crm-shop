"use client"

import { useState } from "react"
import { Alert, Button } from "@myd-org/ui"

/** Lista de códigos de respaldo recién generados: se muestran una sola vez. */
export function CodigosRespaldo({ codigos, onContinuar }: { codigos: string[]; onContinuar?: () => void }) {
  const [copiados, setCopiados] = useState(false)
  const [guardados, setGuardados] = useState(false)
  const texto = codigos.join("\n")

  function descargar() {
    const blob = new Blob(
      [`Códigos de respaldo — verificación en dos pasos\nCada código sirve una sola vez.\n\n${texto}\n`],
      { type: "text/plain;charset=utf-8" },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "codigos-de-respaldo.txt"
    a.click()
    URL.revokeObjectURL(url)
    setGuardados(true)
  }

  async function copiar() {
    await navigator.clipboard.writeText(texto)
    setCopiados(true)
    setGuardados(true)
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert tone="warning">
        Guarde estos códigos en un lugar seguro. Si pierde el celular, cada uno le permite ingresar una vez.
        No se vuelven a mostrar.
      </Alert>
      <ul
        className="grid grid-cols-2 gap-2 font-mono text-sm p-3 rounded-lg"
        style={{ background: "var(--surface-2, #f4f6f9)", color: "var(--ink)" }}
      >
        {codigos.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={descargar} className="flex-1 justify-center">
          Descargar
        </Button>
        <Button variant="secondary" onClick={copiar} className="flex-1 justify-center">
          {copiados ? "Copiados" : "Copiar"}
        </Button>
      </div>
      {onContinuar && (
        <Button onClick={onContinuar} disabled={!guardados} className="w-full justify-center">
          Ya los guardé, continuar
        </Button>
      )}
    </div>
  )
}
