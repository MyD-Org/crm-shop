// Regenera el snapshot de drizzle-kit para la ÚLTIMA migración del journal a partir de
// `src/db/schema.ts`, sin emitir SQL y sin conectarse a ninguna base.
//
// Para qué: las migraciones escritas a mano (la mayoría desde la 0014) no dejan snapshot en
// `drizzle/meta/`. Sin él, `drizzle-kit generate` compara schema.ts contra un estado viejo, ve
// columnas "nuevas" y "borradas" a la vez y abre un prompt interactivo (rename vs. create) que
// en CI o sin TTY falla con "Interactive prompts require a TTY terminal".
//
// Uso, después de escribir a mano `drizzle/NNNN_*.sql`, su entrada en `_journal.json` y el
// cambio equivalente en schema.ts:
//
//   npx tsx scripts/drizzle-snapshot.ts
//   npx drizzle-kit generate   # debe responder "No schema changes, nothing to migrate"
//
// La guarda `src/db/snapshot-al-dia.test.ts` falla si alguien se olvida.
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { generateDrizzleJson } from "drizzle-kit/api"
import * as schema from "../src/db/schema"

const META = path.join(process.cwd(), "drizzle/meta")

const journal = JSON.parse(readFileSync(path.join(META, "_journal.json"), "utf8")) as {
  entries: { idx: number; tag: string }[]
}
const ultima = journal.entries[journal.entries.length - 1]
if (!ultima) throw new Error("El journal no tiene migraciones.")
const prefijo = ultima.tag.slice(0, 4)
const destino = `${prefijo}_snapshot.json`

const snapshots = readdirSync(META)
  .filter((f) => /^\d{4}_snapshot\.json$/.test(f))
  .sort()
// El eslabón anterior de la cadena: el snapshot más nuevo que NO sea el que vamos a (re)escribir.
const anteriorArchivo = snapshots.filter((f) => f !== destino).pop()
if (!anteriorArchivo) throw new Error("No hay un snapshot anterior del que colgar la cadena.")
const anterior = JSON.parse(readFileSync(path.join(META, anteriorArchivo), "utf8")) as { id: string }

const { id, prevId, ...resto } = generateDrizzleJson(schema, anterior.id)
writeFileSync(path.join(META, destino), JSON.stringify({ id, prevId, ...resto }, null, 2))
console.log(`drizzle/meta/${destino} regenerado (prevId → ${anteriorArchivo}).`)
