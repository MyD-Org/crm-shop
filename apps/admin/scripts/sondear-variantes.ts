/**
 * SOLO LECTURA. Sondea cómo entrega Alegra los productos con variantes (change `variantes-de-producto`,
 * tarea S2 2.1). El resultado ya está verificado (2026-10-11) y registrado: este script queda para repetir
 * la prueba contra otra cuenta o si Alegra cambia la forma.
 *
 * Pide UNA página de /items con `fields=inventory` y con `fields=inventory,variantAttributes`, más UN ítem
 * suelto de cada tipo (variante y padre) si los hay, y responde:
 *  - ¿`type` e `idItemParent` llegan siempre (también con solo `fields=inventory`)?
 *  - ¿`variantAttributes` llega en el listado y en GET /items/{id}? ¿con qué forma?
 *  - ¿`inventory` sigue completo con `variantAttributes`?
 * Imprime SOLO claves, tipos de dato y conteos: NUNCA valores (ni nombres, ni códigos, ni opciones).
 *
 * Credenciales: de variables de entorno que se nombran por flag (nunca se imprimen):
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/sondear-variantes.ts \
 *     --email-env NEW_AVANTEC_ALEGRA_EMAIL --token-env NEW_AVANTEC_ALEGRA_TOKEN
 *
 * (Los nombres de las variables son ejemplos: usar las que tenga cada entorno.)
 */
const args = process.argv.slice(2)
const flag = (n: string) => {
  const i = args.indexOf(n)
  return i >= 0 && args[i + 1] ? args[i + 1] : null
}

const emailEnv = flag("--email-env")
const tokenEnv = flag("--token-env")
if (!emailEnv || !tokenEnv) {
  console.error("Uso: --email-env <VARIABLE> --token-env <VARIABLE> (nombres de las variables de entorno con las credenciales).")
  process.exit(1)
}
const email = process.env[emailEnv] ?? ""
const token = process.env[tokenEnv] ?? ""
if (!email || !token) {
  console.error(`Faltan las variables ${emailEnv} / ${tokenEnv} en el entorno.`)
  process.exit(1)
}

const BASE = process.env.ALEGRA_BASE_URL ?? "https://api.alegra.com/api/v1"
const auth = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`

async function get(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url, { headers: { Authorization: auth, Accept: "application/json" } })
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`)
  return res.json()
}

type Obj = Record<string, unknown>
const esObj = (o: unknown): o is Obj => o !== null && typeof o === "object" && !Array.isArray(o)
const claves = (o: unknown): string[] => (esObj(o) ? Object.keys(o) : [])
/** Forma de un valor sin exponerlo: tipo JS (null/array/object/string/number/boolean). */
const forma = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v)

/** Cuenta cuántos ítems tienen cada valor de `type` (los valores de `type` son un vocabulario cerrado de Alegra, no datos del cliente). */
function porTipo(items: Obj[]): string {
  const c = new Map<string, number>()
  for (const i of items) {
    const k = typeof i.type === "string" ? i.type : forma(i.type)
    c.set(k, (c.get(k) ?? 0) + 1)
  }
  return [...c.entries()].map(([k, n]) => `${k}=${n}`).join(", ") || "(sin ítems)"
}

function describir(titulo: string, items: Obj[]): void {
  console.log(`\n── ${titulo}`)
  console.log(`ítems: ${items.length}`)
  console.log(`valores de type: ${porTipo(items)}`)
  const hijos = items.filter((i) => i.type === "variant")
  const padres = items.filter((i) => i.type === "variantParent")
  console.log(`variantes con idItemParent: ${hijos.filter((i) => i.idItemParent != null).length}/${hijos.length} (forma: ${[...new Set(hijos.map((i) => forma(i.idItemParent)))].join("/") || "-"})`)
  console.log(`variantes con variantAttributes no vacío: ${hijos.filter((i) => Array.isArray(i.variantAttributes) && i.variantAttributes.length > 0).length}/${hijos.length}`)
  console.log(`padres con variantAttributes no vacío: ${padres.filter((i) => Array.isArray(i.variantAttributes) && i.variantAttributes.length > 0).length}/${padres.length}`)
  const attr = hijos.map((i) => (Array.isArray(i.variantAttributes) ? (i.variantAttributes[0] as unknown) : undefined)).find(esObj)
  if (attr) {
    console.log(`  claves de un atributo: ${claves(attr).join(", ")}`)
    const opt = Array.isArray(attr.options) ? attr.options[0] : undefined
    console.log(`  claves de una opción: ${claves(opt).join(", ") || "(sin options)"}`)
    console.log(`  opciones por atributo (variante): ${[...new Set(hijos.map((i) => (Array.isArray(i.variantAttributes) ? i.variantAttributes.map((a) => (esObj(a) && Array.isArray(a.options) ? a.options.length : 0)).join("+") : "-")))].join(" | ")}`)
  }
  const inv = items.map((i) => i.inventory).filter(esObj)
  console.log(`claves de inventory (unión): ${[...new Set(inv.flatMap(claves))].sort().join(", ") || "(ninguna)"}`)
  console.log(`claves de primer nivel (unión): ${[...new Set(items.flatMap(claves))].sort().join(", ")}`)
}

async function main() {
  const base = { order_field: "id", order_direction: "ASC", start: "0", limit: "30" }
  const soloInv = (await get("/items", { ...base, fields: "inventory" })) as Obj[]
  const conAttr = (await get("/items", { ...base, fields: "inventory,variantAttributes" })) as Obj[]
  describir("Lista /items con fields=inventory", soloInv)
  describir("Lista /items con fields=inventory,variantAttributes", conAttr)

  for (const tipo of ["variant", "variantParent"]) {
    const uno = conAttr.find((i) => i.type === tipo)
    if (!uno) {
      console.log(`\n(no hay ningún ${tipo} en la primera página: repetir con otra cuenta o paginando)`)
      continue
    }
    const suelto = (await get(`/items/${encodeURIComponent(String(uno.id))}`, { fields: "inventory,variantAttributes" })) as Obj
    describir(`GET /items/{id} de un ${tipo} con fields=inventory,variantAttributes`, [suelto])
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "error")
  process.exit(1)
})

// Hace de este archivo un módulo (sus nombres no chocan con los de los otros scripts sueltos).
export {}
