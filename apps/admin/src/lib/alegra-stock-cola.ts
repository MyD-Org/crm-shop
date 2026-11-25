import { and, count, eq, isNull, lt, lte, or, sql } from "drizzle-orm"
import { getDb, type Db } from "@/db"
import { alegraDocumentoItems, alegraItemRefresh, alegraStockDrenaje } from "@/db/schema"
import type { TenantConfig } from "./tenants"
import { AlegraRateLimitError, getItemParaEspejo } from "./alegra"
import { motivoError } from "./alegra-webhook-comun"
import type { EventoStock } from "./alegra-stock-webhook"
import { marcarItemInactivo, upsertProductos } from "./catalog-products-repo"
import { avisarShop } from "./aviso-shop"
import { sincronizarAtributosDeNombre } from "./catalogo-atributos-repo"
import { partirIdDeCola, refrescarItemDeCuenta } from "./alegra-stock-cuenta"
import { escribirStockPrincipal } from "./catalogo-union-repo"

// Cola de ítems a re-leer de Alegra (tabla alegra_item_refresh) y su drenador.
//
// - `encolar`: lo llama la ruta de avisos DENTRO de su transacción, antes de responder. La PK
//   (tenant, ítem) deduplica: cinco facturas del ítem 5 en tres segundos son UNA fila.
// - `drenarTenant`: UN solo drenador por tenant a la vez (lease en alegra_stock_drenaje, sin
//   locks de sesión: el pooler de Neon va en modo transacción). Re-lee cada ítem con
//   GET /items/{id} a ritmo fijo (1 por segundo, inicio a inicio: ≤ 60/min de los 150/min que la
//   cuenta comparte con la sync, el portal y el bot) y escribe el valor ABSOLUTO con el upsert
//   por frescura. Ante un 429 corta y deja todo en la cola: no insiste contra un cupo saturado.
// - Lo que quede lo barre el cron cada 15 min (/api/cron/alegra-stock-drenar); lo que falle 5
//   veces se descarta y lo corrige la sync diaria. El cron también encola los ítems de los ajustes
//   de inventario recientes, que Alegra no avisa por webhook (alegra-ajustes-inventario.ts).
// - Al terminar, si hubo cambios (ítems leídos o dados de baja), avisa al Shop UNA vez por
//   drenaje para que descarte su caché del catálogo (lib/aviso-shop.ts). Best-effort: un fallo
//   del aviso no cambia el resultado del drenaje.
// - Cuentas secundarias (change `sucursales-igz-mdp`, D2): sus ítems entran a la MISMA cola con el
//   id `<slug>:<id_en_cuenta>` (el formato del `alegra_id` sintético) y el drenador los lee de su
//   cuenta con sus credenciales. Un id numérico sin ":" es siempre de la principal.
// - Logs: tenant y conteos. Nunca datos de Alegra.

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
type Ejecutor = Db | Tx

export interface ResultadoDrenaje {
  leidos: number
  inactivos: number
  errores: number
  requests: number
  pendientes: number
  corte: "vacia" | "deadline" | "limite_429" | "ocupado"
}

/** Cuánto dura el lease del tenant y el de cada fila tomada. Se renueva por lote. */
const LEASE_SEG = 90
/** Fallos antes de descartar una fila (la corrige la sync diaria). */
const MAX_INTENTOS = 5
/** Pocos reintentos: el drenador no insiste contra un cupo que ya está al límite. */
const REINTENTOS_429 = 1

/**
 * Encola ids de ítems para re-leer. Re-encolar uno pendiente actualiza `pedido_at` (así el
 * drenador que lo está leyendo no lo borra: su lectura puede ser anterior al aviso nuevo),
 * cambia el motivo y resetea intentos y error. Devuelve cuántos ids distintos encoló.
 */
/** Motivo de un encolado: un evento de webhook o un ajuste de inventario (alegra-ajustes-inventario.ts). */
export type MotivoCola = EventoStock | "inventory-adjustment"

export async function encolar(tx: Ejecutor, tenantId: string, ids: string[], motivo: MotivoCola): Promise<number> {
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return 0
  const ahora = new Date()
  await tx
    .insert(alegraItemRefresh)
    .values(unicos.map((alegraId) => ({ tenantId, alegraId, motivo, pedidoAt: ahora })))
    .onConflictDoUpdate({
      target: [alegraItemRefresh.tenantId, alegraItemRefresh.alegraId],
      set: {
        pedidoAt: sql`excluded.pedido_at`,
        motivo: sql`excluded.motivo`,
        intentos: 0,
        ultimoError: null,
      },
    })
  return unicos.length
}

// ── Lease del tenant ──

async function tomarLease(tenantId: string): Promise<boolean> {
  const filas = await getDb().execute(sql`
    INSERT INTO alegra_stock_drenaje (tenant_id, ocupado_hasta)
    VALUES (${tenantId}, now() + make_interval(secs => ${LEASE_SEG}))
    ON CONFLICT (tenant_id) DO UPDATE SET ocupado_hasta = excluded.ocupado_hasta
    WHERE alegra_stock_drenaje.ocupado_hasta IS NULL OR alegra_stock_drenaje.ocupado_hasta < now()
    RETURNING tenant_id
  `)
  return filas.length > 0
}

async function renovarLease(tenantId: string): Promise<void> {
  await getDb()
    .update(alegraStockDrenaje)
    .set({ ocupadoHasta: sql`now() + make_interval(secs => ${LEASE_SEG})` })
    .where(eq(alegraStockDrenaje.tenantId, tenantId))
}

async function soltarLease(tenantId: string): Promise<void> {
  await getDb()
    .update(alegraStockDrenaje)
    .set({ ocupadoHasta: null, ultimoDrenajeAt: sql`now()` })
    .where(eq(alegraStockDrenaje.tenantId, tenantId))
}

// ── Filas ──

const libre = (tenantId: string) =>
  and(
    eq(alegraItemRefresh.tenantId, tenantId),
    or(isNull(alegraItemRefresh.tomadoHasta), lt(alegraItemRefresh.tomadoHasta, sql`now()`)),
  )

async function hayLibres(tenantId: string): Promise<boolean> {
  const [r] = await getDb().select({ n: count() }).from(alegraItemRefresh).where(libre(tenantId))
  return (r?.n ?? 0) > 0
}

async function pendientesDe(tenantId: string): Promise<number> {
  const [r] = await getDb().select({ n: count() }).from(alegraItemRefresh).where(eq(alegraItemRefresh.tenantId, tenantId))
  return r?.n ?? 0
}

interface FilaTomada {
  alegraId: string
  /** Intentos ANTES de esta toma. */
  intentos: number
}

/**
 * Toma hasta `lote` filas libres (las más viejas primero) y las marca tomadas por LEASE_SEG,
 * sumando un intento. `SKIP LOCKED`: si otro proceso tiene una fila bloqueada, la saltea.
 */
async function tomarLote(tenantId: string, lote: number): Promise<FilaTomada[]> {
  const filas = await getDb().execute(sql`
    UPDATE alegra_item_refresh r
    SET tomado_hasta = now() + make_interval(secs => ${LEASE_SEG}), intentos = r.intentos + 1
    FROM (
      SELECT tenant_id, alegra_id FROM alegra_item_refresh
      WHERE tenant_id = ${tenantId} AND (tomado_hasta IS NULL OR tomado_hasta < now())
      ORDER BY pedido_at
      LIMIT ${lote}
      FOR UPDATE SKIP LOCKED
    ) libres
    WHERE r.tenant_id = libres.tenant_id AND r.alegra_id = libres.alegra_id
    RETURNING r.alegra_id, r.intentos, r.pedido_at
  `)
  return (filas as unknown as { alegra_id: string; intentos: number; pedido_at: string }[])
    .sort((a, b) => new Date(a.pedido_at).getTime() - new Date(b.pedido_at).getTime())
    .map((f) => ({ alegraId: f.alegra_id, intentos: Number(f.intentos) - 1 }))
}

/** Filas tomadas que no se llegaron a leer (deadline, 429): vuelven a la cola sin gastar intento. */
async function devolver(tenantId: string, ids: string[]): Promise<void> {
  for (const alegraId of ids) {
    await getDb()
      .update(alegraItemRefresh)
      .set({ tomadoHasta: null, intentos: sql`greatest(${alegraItemRefresh.intentos} - 1, 0)` })
      .where(and(eq(alegraItemRefresh.tenantId, tenantId), eq(alegraItemRefresh.alegraId, alegraId)))
  }
}

/**
 * Leída: se borra, SALVO que haya llegado un aviso nuevo mientras se leía (`pedido_at` posterior
 * a la lectura): esa fila queda libre para volver a leerse.
 */
async function cerrarLeida(tenantId: string, alegraId: string, leidoAt: Date): Promise<void> {
  const clave = and(eq(alegraItemRefresh.tenantId, tenantId), eq(alegraItemRefresh.alegraId, alegraId))
  await getDb().delete(alegraItemRefresh).where(and(clave, lte(alegraItemRefresh.pedidoAt, leidoAt)))
  await getDb().update(alegraItemRefresh).set({ tomadoHasta: null }).where(clave)
}

/**
 * Error que no es un 429: queda en la cola con el motivo, tomada hasta que venza su lease (así
 * no se reintenta en el mismo drenaje: lo retoma el próximo).
 */
async function anotarError(tenantId: string, alegraId: string, motivo: string): Promise<void> {
  await getDb()
    .update(alegraItemRefresh)
    .set({ ultimoError: motivo })
    .where(and(eq(alegraItemRefresh.tenantId, tenantId), eq(alegraItemRefresh.alegraId, alegraId)))
}

async function descartar(tenantId: string, alegraId: string): Promise<void> {
  await getDb()
    .delete(alegraItemRefresh)
    .where(and(eq(alegraItemRefresh.tenantId, tenantId), eq(alegraItemRefresh.alegraId, alegraId)))
  console.warn(`[alegra-stock/drenar] tenant=${tenantId} item=${alegraId} accion=descartado intentos=${MAX_INTENTOS}`)
}

function esperar(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Lee UN ítem de Alegra y lo escribe en el catálogo (principal o cuenta secundaria según el id).
 * Suma a `r` leídos / inactivos / requests. Tira los errores de Alegra (429 incluido) y de la base.
 */
async function leerItem(config: TenantConfig, alegraId: string, leidoAt: Date, r: ResultadoDrenaje): Promise<void> {
  const tenantId = config.id
  if (partirIdDeCola(alegraId)) {
    // Ítem de una cuenta SECUNDARIA (id `<slug>:<id>`): se lee de SU cuenta, con SUS
    // credenciales (alegra-stock-cuenta.ts). La principal nunca lo consulta.
    const res = await refrescarItemDeCuenta(config, alegraId, leidoAt, {
      reintentos429: REINTENTOS_429,
      onRequest: () => r.requests++,
    })
    if (res === "baja") r.inactivos++
    else if (res !== "ignorado") r.leidos++
    return
  }
  const producto = await getItemParaEspejo(config, alegraId, {
    reintentos429: REINTENTOS_429,
    onRequest: () => r.requests++,
  })
  if (producto) {
    await upsertProductos(tenantId, [producto], { leidoAt, leidoPor: "webhook" })
    // Y el stock de las sucursales que usan la principal (si no, esperan a la sync).
    await escribirStockPrincipal(tenantId, getDb(), { alegraIds: [alegraId], origen: "webhook" })
    // Un cambio de nombre llega por acá en minutos: sus atributos también (tolerante).
    await sincronizarAtributosDeNombre(tenantId, [producto], "webhook")
    r.leidos++
  } else {
    await marcarItemInactivo(tenantId, alegraId, leidoAt)
    r.inactivos++
  }
}

/** Con más filas que esto en la cola hay una ráfaga (carga masiva): el aviso no lee al instante. */
export const MAX_COLA_LECTURA_INMEDIATA = 50
/** Ítems que un aviso lee al instante (una factura grande deja el resto al drenador). */
export const MAX_ITEMS_LECTURA_INMEDIATA = 20

/**
 * Lectura INMEDIATA de los ítems de un aviso, sin esperar su turno en la cola: un cambio en
 * Alegra (un nombre, una venta) se ve en el catálogo en segundos. Cada ítem leído sale de la cola;
 * lo que no se lee (ráfaga, tope, deadline, 429, error) queda en ella para el drenador.
 *
 * - Ráfaga: si la cola del tenant tiene más de MAX_COLA_LECTURA_INMEDIATA filas no lee nada. Una
 *   carga masiva manda miles de avisos a la vez; leerlos todos en paralelo agotaría el cupo de
 *   Alegra que comparten el portal y el bot. Esos los lee el drenador a su ritmo.
 * - Mismo ritmo que el drenador: 1 request por segundo.
 */
export async function leerAlInstante(
  config: TenantConfig,
  ids: string[],
  opts: { deadline: number; ritmoMs?: number; dormir?: (ms: number) => Promise<void> },
): Promise<ResultadoDrenaje & { rafaga: boolean }> {
  const ritmoMs = opts.ritmoMs ?? 1000
  const dormir = opts.dormir ?? esperar
  const r: ResultadoDrenaje & { rafaga: boolean } = { leidos: 0, inactivos: 0, errores: 0, requests: 0, pendientes: 0, corte: "vacia", rafaga: false }
  const unicos = [...new Set(ids)].slice(0, MAX_ITEMS_LECTURA_INMEDIATA)
  if (unicos.length === 0) return r
  if ((await pendientesDe(config.id)) > MAX_COLA_LECTURA_INMEDIATA) {
    r.rafaga = true
    return r
  }
  let ultimoInicio = -Infinity
  for (const alegraId of unicos) {
    const espera = Math.max(0, ultimoInicio + ritmoMs - Date.now())
    if (Date.now() + espera >= opts.deadline) {
      r.corte = "deadline"
      break
    }
    if (espera > 0) await dormir(espera)
    ultimoInicio = Date.now()
    const leidoAt = new Date()
    try {
      await leerItem(config, alegraId, leidoAt, r)
      await cerrarLeida(config.id, alegraId, leidoAt)
    } catch (err) {
      if (err instanceof AlegraRateLimitError) {
        r.corte = "limite_429"
        break
      }
      r.errores++
      await anotarError(config.id, alegraId, motivoError(err)).catch(() => {})
    }
  }
  if (r.leidos + r.inactivos > 0) {
    try {
      await avisarShop(config.id)
    } catch (err) {
      console.warn(`[alegra-stock/inmediata] tenant=${config.id} aviso al Shop falló: ${err instanceof Error ? err.name : "error"}`)
    }
  }
  return r
}

/**
 * Drena la cola de un tenant hasta vaciarla, llegar al `deadline` (epoch ms) o recibir un 429.
 * Nunca tira por un error de Alegra (queda en el resultado); sí si la base falla.
 */
export async function drenarTenant(
  config: TenantConfig,
  opts: { deadline: number; ritmoMs?: number; lote?: number; dormir?: (ms: number) => Promise<void> },
): Promise<ResultadoDrenaje> {
  const ritmoMs = opts.ritmoMs ?? 1000
  const lote = opts.lote ?? 10
  const dormir = opts.dormir ?? esperar
  const tenantId = config.id
  const inicio = Date.now()
  const r: ResultadoDrenaje = { leidos: 0, inactivos: 0, errores: 0, requests: 0, pendientes: 0, corte: "vacia" }
  let ultimoInicio = -Infinity

  // Un GET más a este ritmo, ¿entra antes del deadline? Espera lo que falte para respetarlo.
  async function turno(): Promise<boolean> {
    const espera = Math.max(0, ultimoInicio + ritmoMs - Date.now())
    if (Date.now() + espera >= opts.deadline) return false
    if (espera > 0) await dormir(espera)
    ultimoInicio = Date.now()
    return true
  }

  if (!(await tomarLease(tenantId))) {
    r.corte = "ocupado"
    r.pendientes = await pendientesDe(tenantId)
    return r
  }

  try {
    for (;;) {
      // Una vuelta con el lease tomado.
      r.corte = "vacia"
      while (r.corte === "vacia") {
        if (Date.now() >= opts.deadline) {
          r.corte = "deadline"
          break
        }
        await renovarLease(tenantId)
        const filas = await tomarLote(tenantId, lote)
        if (filas.length === 0) break

        for (let i = 0; i < filas.length; i++) {
          const f = filas[i]
          if (f.intentos >= MAX_INTENTOS) {
            await descartar(tenantId, f.alegraId)
            continue
          }
          if (!(await turno())) {
            r.corte = "deadline"
            await devolver(tenantId, filas.slice(i).map((x) => x.alegraId))
            break
          }
          const leidoAt = new Date()
          try {
            await leerItem(config, f.alegraId, leidoAt, r)
            await cerrarLeida(tenantId, f.alegraId, leidoAt)
          } catch (err) {
            const motivo = motivoError(err)
            if (err instanceof AlegraRateLimitError) {
              // La que chocó conserva su intento; el resto vuelve sin gastarlo.
              await anotarError(tenantId, f.alegraId, motivo)
              await getDb()
                .update(alegraItemRefresh)
                .set({ tomadoHasta: null })
                .where(and(eq(alegraItemRefresh.tenantId, tenantId), eq(alegraItemRefresh.alegraId, f.alegraId)))
              await devolver(tenantId, filas.slice(i + 1).map((x) => x.alegraId))
              r.corte = "limite_429"
              break
            }
            // Otro error (Alegra 5xx, la base): se anota y sigue con la próxima.
            r.errores++
            await anotarError(tenantId, f.alegraId, motivo).catch(() => {})
          }
        }
      }

      // Se suelta el lease y se re-chequea: un aviso pudo encolar justo mientras se soltaba (él
      // no consiguió el lease porque lo teníamos; nosotros ya habíamos visto la cola vacía).
      await soltarLease(tenantId)
      if (r.corte !== "vacia") break
      if (Date.now() + ritmoMs >= opts.deadline) break
      if (!(await hayLibres(tenantId))) break
      if (!(await tomarLease(tenantId))) break // otro drenador lo agarró: que siga él
    }
  } catch (err) {
    await soltarLease(tenantId).catch(() => {})
    throw err
  }

  r.pendientes = await pendientesDe(tenantId)
  if (r.leidos + r.inactivos > 0) {
    try {
      await avisarShop(tenantId)
    } catch (err) {
      console.warn(`[alegra-stock/drenar] tenant=${tenantId} aviso al Shop falló: ${err instanceof Error ? err.name : "error"}`)
    }
  }
  console.log(
    `[alegra-stock/drenar] tenant=${tenantId} leidos=${r.leidos} inactivos=${r.inactivos} errores=${r.errores} requests=${r.requests} pendientes=${r.pendientes} corte=${r.corte} ms=${Date.now() - inicio}`,
  )
  return r
}

/**
 * La sync COMPLETA de una cuenta terminó bien: leyó todos sus ítems después de `inicio`, así que
 * los pedidos anteriores ya están cubiertos y se borran (si no, una carga masiva deja miles de
 * filas que el drenador tarda días en leer). Los posteriores a `inicio` quedan: el ítem pudo
 * cambiar después de que la sync lo leyera.
 *
 * `principal`: ids sin ":"; `slugs`: ids `<slug>:<id>` de esas cuentas secundarias.
 */
export async function limpiarColaCubiertaPorSync(
  tenantId: string,
  cuentas: { principal: boolean; slugs: string[] },
  inicio: Date,
): Promise<number> {
  const filtros = [
    ...(cuentas.principal ? [sql`position(':' in ${alegraItemRefresh.alegraId}) = 0`] : []),
    ...cuentas.slugs.map((slug) => sql`${alegraItemRefresh.alegraId} LIKE ${`${slug.replace(/[\\%_]/g, "\\$&")}:%`}`),
  ]
  if (filtros.length === 0) return 0
  const borradas = await getDb()
    .delete(alegraItemRefresh)
    .where(
      and(
        eq(alegraItemRefresh.tenantId, tenantId),
        lt(alegraItemRefresh.pedidoAt, inicio),
        or(...filtros),
      ),
    )
    .returning({ alegraId: alegraItemRefresh.alegraId })
  return borradas.length
}

/**
 * Limpieza del cron: filas de la cola sin leer hace más de `colaHoras` (las cubre la sync
 * diaria) y entradas del índice documento→ítems sin tocar hace más de `indiceDias`.
 */
export async function purgarCola(opts: { colaHoras: number; indiceDias: number }): Promise<{ cola: number; indice: number }> {
  const db = getDb()
  const cola = await db
    .delete(alegraItemRefresh)
    .where(lt(alegraItemRefresh.pedidoAt, sql`now() - make_interval(hours => ${opts.colaHoras})`))
    .returning({ id: alegraItemRefresh.alegraId })
  const indice = await db
    .delete(alegraDocumentoItems)
    .where(lt(alegraDocumentoItems.actualizadoAt, sql`now() - make_interval(days => ${opts.indiceDias})`))
    .returning({ id: alegraDocumentoItems.alegraDocId })
  if (cola.length > 0) console.warn(`[alegra-stock/purga] cola=${cola.length} indice=${indice.length}`)
  return { cola: cola.length, indice: indice.length }
}

export interface TenantParaDrenar {
  tenant: string
  /** Minutos desde el último aviso de stock recibido; null si nunca llegó uno. */
  ultimoAvisoMin: number | null
}

/**
 * Tenants que el cron tiene que mirar: los que tienen filas en la cola y los que alguna vez
 * recibieron un aviso de stock (para detectar que dejaron de llegar, aunque la cola esté vacía).
 */
export async function tenantsParaDrenar(): Promise<TenantParaDrenar[]> {
  const filas = await getDb().execute(sql`
    SELECT t.tenant_id AS tenant,
           floor(extract(epoch FROM now() - max(a.ultimo_at)) / 60)::int AS ultimo_aviso_min
    FROM (
      SELECT tenant_id FROM alegra_item_refresh
      UNION
      SELECT tenant_id FROM alegra_webhook_avisos
    ) t
    LEFT JOIN alegra_webhook_avisos a ON a.tenant_id = t.tenant_id
    GROUP BY t.tenant_id
    ORDER BY t.tenant_id
  `)
  return (filas as unknown as { tenant: string; ultimo_aviso_min: number | null }[]).map((f) => ({
    tenant: f.tenant,
    ultimoAvisoMin: f.ultimo_aviso_min == null ? null : Number(f.ultimo_aviso_min),
  }))
}
