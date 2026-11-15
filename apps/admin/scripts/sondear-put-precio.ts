/**
 * Sondeo del PUT de precios de un ítem de Alegra (change `listas-alegra-desde-costo`, R1, tarea R1.3).
 *
 * NO hay cuenta de Alegra de prueba: el sondeo crea en la cuenta indicada UN ítem descartable
 * ("PRUEBA-SONDEO", referencia única, sin stock) y prueba sólo sobre él. Nunca toca un producto real.
 * Al final lo elimina (DELETE /items/{id}); si no puede, lo inactiva e informa su id y su referencia
 * para que se lo borre a mano.
 *
 * Qué responde (cada paso con GET antes y después; se imprimen SÓLO precios, costo y flags):
 *   A. ¿El PUT acepta `price[]` SIN `inventory` y conserva el `unitCost`?
 *   B. ¿Ese PUT conserva `inventory.negativeSale` (venta en negativo)? (el GET no lo devuelve: se
 *      mira la respuesta del PUT)
 *   C. ¿Guarda 2 decimales (160,01 vuelve 160,01)? ¿Qué hace con 3 decimales (160,005)? Por lista,
 *      incluida la lista General.
 *   D. ¿Un `price[]` parcial (una sola lista) borra las demás o hay que mandar el merge completo?
 *   E. El wrapper del repo (`getItemParaPrecios` + `mergearPrecios` + `actualizarPreciosItem`) de
 *      punta a punta, con y sin `inventory`.
 * No cubre (hay que mirarlo aparte): que el webhook de edición converja (diff vacío) y el PUT a una
 * variante (code 1077). Para lo primero, mirar `catalog_precios_cuenta` después de correrlo.
 *
 * Uso (parado en apps/admin; el env se carga como en los demás scripts):
 *   npx tsx --env-file-if-exists=.env.local scripts/sondear-put-precio.ts --cuenta mdp              # ensayo
 *   npx tsx --env-file-if-exists=.env.local scripts/sondear-put-precio.ts --cuenta mdp --ejecutar   # escribe
 *   npx tsx --env-file-if-exists=.env.local scripts/sondear-put-precio.ts --cuenta principal --ejecutar
 *
 * - `--ensayo` (por defecto) NO usa red ni base: sólo muestra qué haría.
 * - `--ejecutar` escribe en la cuenta REAL (crea, modifica y borra el ítem descartable).
 * - Credenciales: `principal` desde `tenants` (id='central-led'); `mdp` desde `alegra_cuentas`
 *   (slug='mdp'). Se leen por la base; nunca se imprimen ni se pasan por argumento.
 */
import {
  actualizarPreciosItem,
  createItem,
  getItemParaPrecios,
  type PrecioItemInput,
} from "../src/lib/alegra"
import { aCentavos, mergearPrecios } from "../src/lib/alegra-precios-motor"

const TENANT = "central-led"
const NOMBRE = "PRUEBA-SONDEO"
const BASE = process.env.ALEGRA_BASE_URL ?? "https://api.alegra.com/api/v1"

const args = process.argv.slice(2)
const flag = (n: string) => {
  const i = args.indexOf(n)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null
}
const cuentaArg = flag("--cuenta")
const ejecutar = args.includes("--ejecutar")
if (args.includes("--ensayo") && ejecutar) {
  console.error("Use --ensayo o --ejecutar, no los dos.")
  process.exit(1)
}
if (cuentaArg !== "principal" && cuentaArg !== "mdp") {
  console.error("Uso: --cuenta principal|mdp [--ensayo | --ejecutar]")
  process.exit(1)
}
const cuenta: "principal" | "mdp" = cuentaArg

const referencia = `PRUEBA-SONDEO-${Date.now().toString(36).toUpperCase()}`

const PLAN = [
  `Cuenta: ${cuenta} (tenant ${TENANT}). Ítem descartable: "${NOMBRE}", referencia ${referencia}, sin stock.`,
  "0. GET /price-lists: se prueban hasta 3 listas de venta activas (incluida la General).",
  "1. POST /items: alta del ítem descartable (precio único inicial).",
  "2. Preparación: PUT con inventory {unit, unitCost: 123.45, negativeSale: true} y un precio distinto por lista.",
  "A/B. PUT SÓLO con price[] (merge completo) SIN inventory: ¿se conserva unitCost? ¿negativeSale en la respuesta?",
  "C. PUT con 160.01 / 33.33 / 0.99 en listas distintas y luego 160.005: ¿2 decimales?",
  "D. PUT con price[] de UNA sola lista: ¿se borran las demás?",
  "E. Wrapper del repo (getItemParaPrecios + mergearPrecios + actualizarPreciosItem), con y sin inventory.",
  "F. DELETE /items/{id}; si falla, se inactiva y se informa.",
]

if (!ejecutar) {
  console.log("ENSAYO: no se usa red ni base y no se escribe nada. Con --ejecutar haría lo siguiente:\n")
  for (const l of PLAN) console.log(`  ${l}`)
  console.log("\nPara ejecutarlo de verdad: repetir el comando agregando --ejecutar.")
  process.exit(0)
}

// ── A partir de acá hay red, base y escrituras ────────────────────────────────────────────────

type Cfg = Parameters<typeof createItem>[0]
type Json = Record<string, unknown>

async function cargarConfig(): Promise<Cfg> {
  if (!process.env.DATABASE_URL) throw new Error("Falta DATABASE_URL (la base de donde salen las credenciales).")
  const { getTenantByIdFromDb } = await import("../src/lib/tenants")
  const base = await getTenantByIdFromDb(TENANT)
  if (!base) throw new Error(`No existe el tenant ${TENANT}.`)
  if (cuenta === "principal") {
    if (!base.alegraEmail || !base.alegraToken) throw new Error("El tenant no tiene credenciales de Alegra cargadas.")
    return { ...base, alegraMock: false }
  }
  const { getDb } = await import("../src/db")
  const { alegraCuentas } = await import("../src/db/schema")
  const { and, eq } = await import("drizzle-orm")
  const { configParaCuenta } = await import("../src/lib/sucursales-cuenta")
  const [c] = await getDb()
    .select()
    .from(alegraCuentas)
    .where(and(eq(alegraCuentas.tenantId, TENANT), eq(alegraCuentas.slug, "mdp")))
  if (!c) throw new Error("No existe la cuenta mdp del tenant.")
  return { ...configParaCuenta(base, c), alegraMock: false }
}

async function cerrarPool() {
  try {
    const { getDb } = await import("../src/db")
    const client = (getDb() as unknown as { $client?: { end: (o?: { timeout?: number }) => Promise<void> } }).$client
    await client?.end({ timeout: 5 })
  } catch {
    /* nada que hacer al cerrar */
  }
}

// HTTP mínimo y propio: el sondeo mide la API cruda, sin pasar por el wrapper que prueba.
let auth = ""
async function api(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: auth, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  })
  const texto = await res.text()
  let json: unknown = null
  try {
    json = texto ? JSON.parse(texto) : null
  } catch {
    json = null
  }
  await new Promise((r) => setTimeout(r, 700)) // ritmo bajo: ~85 req/min, muy por debajo del tope (150)
  return { status: res.status, json }
}

const precios = (it: unknown): { id: string; price: number | null }[] =>
  Array.isArray((it as Json | null)?.price)
    ? ((it as Json).price as Json[]).map((p) => ({ id: String(p.idPriceList ?? p.id), price: typeof p.price === "number" ? p.price : p.price == null ? null : Number(p.price) }))
    : []
const inv = (it: unknown) => ((it as Json | null)?.inventory ?? {}) as Json
const resumen = (it: unknown) => ({
  precios: Object.fromEntries(precios(it).map((p) => [p.id, p.price])),
  unitCost: inv(it).unitCost ?? null,
  unit: inv(it).unit ?? null,
  negativeSale: inv(it).negativeSale ?? "no informado",
  status: (it as Json | null)?.status ?? null,
})
const mostrar = (titulo: string, v: unknown) => console.log(`${titulo}: ${JSON.stringify(v)}`)

const resultados: Record<string, unknown> = {}

async function main(): Promise<number> {
  const cfg = await cargarConfig()
  auth = `Basic ${Buffer.from(`${cfg.alegraEmail}:${cfg.alegraToken}`).toString("base64")}`
  console.log(`Cuenta ${cuenta}: credenciales leídas (no se imprimen). Ítem "${NOMBRE}" ref ${referencia}.`)

  // 0. Listas de venta activas
  const pl = await api("GET", "/price-lists")
  if (pl.status !== 200 || !Array.isArray(pl.json)) throw new Error(`GET /price-lists -> ${pl.status}`)
  const listas = (pl.json as Json[])
    .filter((l) => String(l.status ?? "active") === "active" && String(l.type ?? "amount") !== "purchase")
    .map((l) => ({ id: String(l.id), name: String(l.name ?? "") }))
  const general = listas.find((l) => /^general$/i.test(l.name)) ?? listas[0]
  const elegidas = [general, ...listas.filter((l) => l.id !== general?.id)].filter(Boolean).slice(0, 3)
  if (elegidas.length === 0) throw new Error("La cuenta no tiene listas de precio activas.")
  mostrar("Listas de prueba", elegidas)
  resultados.listas = elegidas.map((l) => l.name)

  // 1. Alta del ítem descartable (reusa createItem: maneja el campo MARCA obligatorio de la cuenta)
  const creado = await createItem(cfg, { name: NOMBRE, code: referencia, price: 100, taxId: null, brand: "PRUEBA" })
  const id = creado.alegraId
  console.log(`Ítem descartable creado: id ${id}`)

  let falloPrueba: unknown = null
  try {
    const numId = (s: string): string | number => (/^\d+$/.test(s) ? Number(s) : s)
    const pedir = async () => {
      const r = await api("GET", `/items/${id}?fields=inventory`)
      if (r.status !== 200) throw new Error(`GET /items/${id} -> ${r.status}`)
      return r.json
    }
    const completo = (valores: number[]): PrecioItemInput[] => elegidas.map((l, i) => ({ idPriceList: numId(l.id), price: valores[i] ?? valores[0] }))

    // 2. Preparación
    const prep = await api("PUT", `/items/${id}`, {
      price: completo([111.11, 222.22, 333.33]),
      inventory: { unit: "unit", unitCost: 123.45, negativeSale: true },
    })
    mostrar("2. preparación: HTTP", prep.status)
    mostrar("   respuesta del PUT", resumen(prep.json))
    const g0 = await pedir()
    mostrar("   GET después", resumen(g0))
    resultados.preparacion = { http: prep.status, respuesta: resumen(prep.json), get: resumen(g0) }

    // A / B. PUT sólo con price[] (merge completo), sin inventory
    const antes = await pedir()
    const actuales = ((antes as Json).price as Json[]).map((p) => ({ idPriceList: p.idPriceList as string | number, price: Number(p.price) }))
    const mergeA = mergearPrecios(actuales, [{ id: general.id, price: 160.01 }])
    const a = await api("PUT", `/items/${id}`, { price: mergeA })
    const despuesA = await pedir()
    const costoConservado = Number(inv(despuesA).unitCost) === 123.45
    mostrar("A. PUT sólo price[]: HTTP", a.status)
    mostrar("   respuesta del PUT", resumen(a.json))
    mostrar("   GET después", resumen(despuesA))
    console.log(`   => unitCost conservado: ${costoConservado ? "SÍ" : "NO"} (antes 123.45, después ${String(inv(despuesA).unitCost)})`)
    console.log(`   => negativeSale en la respuesta del PUT: ${String(inv(a.json).negativeSale ?? "no informado")} (se había puesto true)`)
    resultados.A_soloPrice = { http: a.status, unitCostConservado: costoConservado }
    resultados.B_negativeSale = inv(a.json).negativeSale ?? "no informado"

    // C. Decimales (una lista distinta por valor, merge completo)
    const valores = [160.01, 33.33, 0.99]
    const c1 = await api("PUT", `/items/${id}`, { price: completo(valores) })
    const gc1 = precios(await pedir())
    const dec2 = elegidas.map((l, i) => ({ lista: l.name, enviado: valores[i] ?? valores[0], guardado: gc1.find((p) => p.id === l.id)?.price ?? null }))
    mostrar("C. 2 decimales: HTTP", c1.status)
    mostrar("   por lista", dec2)
    const c2 = await api("PUT", `/items/${id}`, { price: completo([160.005, 160.005, 160.005]) })
    const gc2 = precios(await pedir())
    const dec3 = elegidas.map((l) => ({ lista: l.name, enviado: 160.005, guardado: gc2.find((p) => p.id === l.id)?.price ?? null }))
    mostrar("   3 decimales (160.005): HTTP", c2.status)
    mostrar("   por lista", dec3)
    resultados.C_decimales = { dos: dec2, tres: dec3 }

    // D. price[] parcial
    await api("PUT", `/items/${id}`, { price: completo([111.11, 222.22, 333.33]) })
    const d = await api("PUT", `/items/${id}`, { price: [{ idPriceList: numId(general.id), price: 170 }] })
    const gd = precios(await pedir())
    mostrar("D. price[] de UNA lista: HTTP", d.status)
    mostrar("   listas que quedan en el ítem", gd)
    const otrasConservadas = elegidas.slice(1).every((l) => gd.some((p) => p.id === l.id))
    console.log(`   => las otras listas ${otrasConservadas ? "SE CONSERVAN (un parcial alcanzaría)" : "SE BORRAN O CAMBIAN (hay que mandar el merge completo)"}`)
    resultados.D_parcial = { http: d.status, otrasListasConservadas: otrasConservadas, quedan: gd }

    // E. Wrapper del repo
    await api("PUT", `/items/${id}`, { price: completo([111.11, 222.22, 333.33]) })
    const vivo = await getItemParaPrecios(cfg, id)
    if (!vivo) throw new Error("getItemParaPrecios no encontró el ítem descartable.")
    const merge = mergearPrecios(vivo.price, [{ id: general.id, price: 177.77 }])
    const conInv = await actualizarPreciosItem(
      cfg,
      id,
      { price: merge, inventory: vivo.unit ? { unit: vivo.unit, unitCost: vivo.unitCost ?? 0 } : undefined, verificarListas: [general.id] },
      { reintentos429: 1 },
    )
    const tras1 = await getItemParaPrecios(cfg, id)
    mostrar("E1. wrapper CON inventory: precio General devuelto", conInv.prices.find((p) => p.idPriceList === general.id)?.price ?? null)
    mostrar("    GET después: unitCost", tras1?.unitCost ?? null)
    const merge2 = mergearPrecios(tras1?.price ?? [], [{ id: general.id, price: 188.88 }])
    const sinInv = await actualizarPreciosItem(cfg, id, { price: merge2, verificarListas: [general.id] }, { reintentos429: 1 })
    const tras2 = await getItemParaPrecios(cfg, id)
    mostrar("E2. wrapper SIN inventory: precio General devuelto", sinInv.prices.find((p) => p.idPriceList === general.id)?.price ?? null)
    mostrar("    GET después: unitCost", tras2?.unitCost ?? null)
    resultados.E_wrapper = {
      conInventory_precioOk: aCentavos(conInv.prices.find((p) => p.idPriceList === general.id)?.price) === 17777,
      sinInventory_precioOk: aCentavos(sinInv.prices.find((p) => p.idPriceList === general.id)?.price) === 18888,
      unitCostTrasSinInventory: tras2?.unitCost ?? null,
    }
  } catch (err) {
    falloPrueba = err
    console.error(`::error::El sondeo falló a mitad: ${err instanceof Error ? `${err.name}: ${err.message}` : "error"}`)
  }

  // F. Limpieza: borrar; si no se puede, inactivar e informar
  let limpio = false
  const del = await api("DELETE", `/items/${id}`)
  if (del.status >= 200 && del.status < 300) limpio = true
  mostrar("F. DELETE: HTTP", del.status)
  if (!limpio) {
    const off = await api("PUT", `/items/${id}`, { status: "inactive" })
    mostrar("   DELETE falló; se intentó inactivar: HTTP", off.status)
    console.error(`::warning::BORRAR A MANO el ítem "${NOMBRE}" (id ${id}, referencia ${referencia}) de la cuenta ${cuenta}.`)
  }
  resultados.limpieza = limpio ? "eliminado" : "quedó en la cuenta: borrar a mano"

  console.log("\nRESUMEN JSON (sin credenciales):")
  console.log(JSON.stringify(resultados, null, 2))
  return falloPrueba || !limpio ? 1 : 0
}

main()
  .catch((err) => {
    console.error(`::error::${err instanceof Error ? err.message : "error"}`)
    return 1
  })
  .then(async (code) => {
    await cerrarPool()
    process.exit(code)
  })
