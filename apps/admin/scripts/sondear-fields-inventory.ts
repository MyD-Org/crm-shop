/**
 * SOLO LECTURA. Verifica que `fields=inventory` es ADITIVO en GET /items de Alegra (change
 * `listas-precio-online`, tarea A.1): trae inventory.unitCost SIN sacar los campos de siempre.
 *
 * Pide UNA página de /items sin y con `fields=inventory` (y un ítem suelto, para el webhook),
 * y compara las CLAVES de primer nivel (y las de `inventory`) de cada ítem. Criterio: el set
 * "con" es superconjunto del set "sin"; siguen presentes price, tax, customFields, inventory
 * e inventory.availableQuantity. Imprime SOLO conteos y nombres de claves, nunca valores.
 *
 * Credenciales: de variables de entorno que se nombran por flag (nunca se imprimen):
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/sondear-fields-inventory.ts \
 *     --email-env NEW_AVANTEC_ALEGRA_EMAIL --token-env NEW_AVANTEC_ALEGRA_TOKEN      # principal (IGZ)
 *   npx tsx --env-file-if-exists=.env.local scripts/sondear-fields-inventory.ts \
 *     --email-env NEW_AVANTEC_ALEGRA_EMAIL_MDP --token-env NEW_AVANTEC_ALEGRA_TOKEN_MDP   # secundaria (MDP)
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

const claves = (o: unknown): string[] => (o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o as object) : [])
const union = (xs: unknown[]) => new Set(xs.flatMap((x) => claves(x)))
const faltantes = (base: Set<string>, otro: Set<string>) => [...base].filter((k) => !otro.has(k)).sort()

function comparar(titulo: string, sin: unknown[], con: unknown[]): boolean {
  const kSin = union(sin)
  const kCon = union(con)
  const iSin = union(sin.map((i) => (i as { inventory?: unknown }).inventory))
  const iCon = union(con.map((i) => (i as { inventory?: unknown }).inventory))
  const pierde = faltantes(kSin, kCon)
  const suma = faltantes(kCon, kSin)
  const iPierde = faltantes(iSin, iCon)
  const iSuma = faltantes(iCon, iSin)
  const aditivo = pierde.length === 0 && iPierde.length === 0
  const conCosto = con.filter((i) => {
    const c = (i as { inventory?: { unitCost?: unknown } }).inventory?.unitCost
    return c != null && Number(c) > 0
  }).length
  console.log(`\n── ${titulo}`)
  console.log(`ítems: sin=${sin.length} con=${con.length}`)
  console.log(`claves de primer nivel: sin=${kSin.size} con=${kCon.size}`)
  console.log(`  pierde con fields=inventory: ${pierde.length ? pierde.join(", ") : "(ninguna)"}`)
  console.log(`  suma con fields=inventory:   ${suma.length ? suma.join(", ") : "(ninguna)"}`)
  console.log(`claves de inventory: pierde=${iPierde.join(", ") || "(ninguna)"} suma=${iSuma.join(", ") || "(ninguna)"}`)
  for (const k of ["price", "tax", "customFields", "inventory"]) {
    console.log(`  presente '${k}' con fields=inventory: ${kCon.has(k) ? "sí" : "NO"}`)
  }
  console.log(`  presente 'inventory.availableQuantity': ${iCon.has("availableQuantity") ? "sí" : "NO"}`)
  console.log(`  presente 'inventory.unitCost': ${iCon.has("unitCost") ? "sí" : "NO"} (con unitCost > 0: ${conCosto}/${con.length})`)
  console.log(`  ADITIVO: ${aditivo ? "SÍ" : "NO → ajustar D2 (fields=inventory,price,tax,...) antes de seguir"}`)
  return aditivo
}

async function main() {
  const base = { order_field: "id", order_direction: "ASC", start: "0", limit: "30" }
  const sin = (await get("/items", base)) as unknown[]
  const con = (await get("/items", { ...base, fields: "inventory" })) as unknown[]
  let ok = comparar("Lista /items (primera página)", sin, con)

  const id = (sin[0] as { id?: unknown } | undefined)?.id
  if (id != null) {
    const s1 = (await get(`/items/${encodeURIComponent(String(id))}`, {})) as unknown
    const c1 = (await get(`/items/${encodeURIComponent(String(id))}`, { fields: "inventory" })) as unknown
    ok = comparar("Ítem suelto /items/{id} (el que usa el webhook)", [s1], [c1]) && ok
  }
  process.exit(ok ? 0 : 2)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "error")
  process.exit(1)
})
