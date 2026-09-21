import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { generateDrizzleJson } from "drizzle-kit/api"
import * as schema from "./schema"

// Guarda: el snapshot más nuevo de `drizzle/meta/` tiene que describir el mismo schema que
// `schema.ts`. Si se desfasan (típico: migración escrita a mano sin snapshot), el próximo
// `drizzle-kit generate` abre un prompt interactivo de rename y falla sin TTY, o peor, emite
// SQL que re-crea lo que ya existe. No usa base: compara JSON contra JSON.
//
// Si falla: `npx tsx scripts/drizzle-snapshot.ts` (parado en apps/admin) y commitear el snapshot.

const meta = fileURLToPath(new URL("../../drizzle/meta", import.meta.url))

describe("snapshot de drizzle-kit al día", () => {
  it("el último snapshot coincide con src/db/schema.ts", () => {
    const snapshots = readdirSync(meta)
      .filter((f) => /^\d{4}_snapshot\.json$/.test(f))
      .sort()
    const ultimo = JSON.parse(readFileSync(path.join(meta, snapshots[snapshots.length - 1]), "utf8"))

    // `id` y `prevId` son el encadenado entre snapshots, no el schema: se comparan aparte.
    // Ida y vuelta por JSON para descartar los `undefined` que el generador deja en memoria.
    const sinCadena = (snapshot: object) => {
      const copia = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>
      delete copia.id
      delete copia.prevId
      return copia
    }
    expect(sinCadena(generateDrizzleJson(schema))).toEqual(sinCadena(ultimo))
  })

  it("el último snapshot corresponde a la última migración del journal", () => {
    const journal = JSON.parse(readFileSync(path.join(meta, "_journal.json"), "utf8")) as {
      entries: { tag: string }[]
    }
    const ultimaTag = journal.entries[journal.entries.length - 1].tag
    const snapshots = readdirSync(meta)
      .filter((f) => /^\d{4}_snapshot\.json$/.test(f))
      .sort()
    expect(snapshots[snapshots.length - 1]).toBe(`${ultimaTag.slice(0, 4)}_snapshot.json`)
  })
})
