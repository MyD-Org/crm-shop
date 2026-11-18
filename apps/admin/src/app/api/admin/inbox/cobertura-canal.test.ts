import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

// Anti-regresión del acceso por canal: toda ruta del inbox aplica la política (importa
// lib/canal-acceso o lib/canal-acceso-conversacion) o figura acá como exenta, con su motivo. Una
// ruta nueva sin decidir hace fallar este test.
const EXENTAS: Record<string, string> = {
  "bot-status/route.ts": "kill switch global del bot: no expone conversaciones",
  "limits/route.ts": "topes de uso del tenant: configuración, sin conversaciones",
  "usage/route.ts": "gasto agregado del bot: sin conversaciones ni PII",
  "wa-costos/route.ts": "consumo agregado por número: sin conversaciones ni PII",
  "copilot-draft-events/route.ts": "métrica: solo INSERT (conversation_id, outcome), no lee ni devuelve contenido",
}

const RAIZ = join(__dirname)

function rutas(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const p = join(dir, nombre)
    if (statSync(p).isDirectory()) return rutas(p)
    return nombre === "route.ts" ? [p] : []
  })
}

describe("cobertura del acceso por canal en api/admin/inbox", () => {
  const todas = rutas(RAIZ).map((p) => relative(RAIZ, p).split("\\").join("/"))

  it("encuentra las rutas", () => {
    expect(todas.length).toBeGreaterThan(10)
  })

  it.each(todas)("%s aplica la política de canal o está exenta", (ruta) => {
    if (EXENTAS[ruta]) return
    const fuente = readFileSync(join(RAIZ, ruta), "utf8")
    expect(fuente, `${ruta}: importe lib/canal-acceso o agréguela a EXENTAS con su motivo`).toMatch(
      /from "@\/lib\/canal-acceso(-conversacion)?"/,
    )
  })

  it("las exentas existen (no quedan entradas viejas)", () => {
    for (const ruta of Object.keys(EXENTAS)) expect(todas).toContain(ruta)
  })
})
