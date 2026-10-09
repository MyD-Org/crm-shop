import { createHash } from "node:crypto"
import { and, asc, desc, eq, sql } from "drizzle-orm"
import { getDb, type Db } from "@/db"
import {
  alegraContacts,
  alegraCuentas,
  listaPrecioAlegraMapeo,
  listaPrecioCondiciones,
  listaPrecioOverrides,
  listasPrecioOnline,
  mediosPagoShop,
  preciosOnlineCambios,
  preciosOnlineConfig,
  shopCategories,
} from "@/db/schema"
import { avisarShop } from "./aviso-shop"
import { combinarListasAlegra, leerListasDeAlegra, type ListaAlegraSelector } from "./listas-alegra-selector"
import { getTenantByIdFromDb } from "./tenants"
import { pingShopRevalidarSucursales } from "./shop-revalidar"
import { FORMAS_CONDICION, normalizarMarca, type CambioPrecios, type FormaCondicion } from "./precios-online-cambios"
import { opcionesAplicables } from "./medios-pago-shop-opciones"
import { ordenarMarcas } from "./marcas-tarjeta"

// Capa de aplicación de las listas de precio online (change `listas-precio-online`, rebanada B).
//
// El CÁLCULO vive en SQL (migración 0064: calcular_precios_online / aplicar_precios_online). Acá
// están los cambios sobre la configuración (listas, overrides, umbrales), la vista previa, el
// aplicar atómico con historial, y revertir. Todo cambio pasa por `simular` dentro de UNA
// transacción con el advisory lock del tenant: la previa hace ROLLBACK, el aplicar hace COMMIT.

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

export class PreciosOnlineError extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = "PreciosOnlineError"
  }
}

export const MSG_PREVIA_VENCIDA = "La vista previa quedó desactualizada. Genere una nueva."
const MSG_LISTA_NO_EXISTE = "La lista indicada no existe."
const MSG_NOMBRE_DUPLICADO = "Ya existe una lista con ese nombre."
const MSG_REFERENCIA_PRIVADA = "La lista de referencia no puede ser privada."
const MSG_PRIVADA_CON_MEDIO = "Una lista enlazada a un medio de pago no puede ser privada. Quite el enlace primero."
const MSG_PRIVADA_A_MEDIO = "Una lista privada no puede enlazarse a un medio de pago."
const MSG_MAPEO_NO_PRIVADA = "Solo una lista privada puede enlazarse con una lista de Alegra."

const lockKey = (tenantId: string) => `precios_online:${tenantId}`

/** Un solo escritor de precios por tenant a la vez (la sync, el webhook, la previa y el aplicar). */
export async function lockTenant(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey(tenantId)}))`)
}

/** `ARRAY['a','b']::text[]` o `NULL::text[]` (todo el tenant). */
export function idsSql(ids: string[] | null) {
  if (ids === null) return sql`NULL::text[]`
  return sql`ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::text[]`
}

/** Mismas marcas sin importar el orden; null (todas) sólo es igual a null. */
function mismaListaDeMarcas(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b
  return a.length === b.length && ordenarMarcas(a).join(",") === ordenarMarcas(b).join(",")
}

// ── Configuración (umbrales + versión) ──────────────────────────────────────────────────────

export interface ConfigPrecios {
  version: number
  umbralConfirmacionPct: string
  umbralRetencionPct: string
}

const CONFIG_DEFAULT: ConfigPrecios = { version: 0, umbralConfirmacionPct: "20.00", umbralRetencionPct: "10.00" }

/** Lectura sin escribir: sin fila rigen los defaults (20 / 10). */
export async function leerConfig(tenantId: string, ej: Db | Tx = getDb()): Promise<ConfigPrecios> {
  const [c] = await ej.select().from(preciosOnlineConfig).where(eq(preciosOnlineConfig.tenantId, tenantId))
  if (!c) return { ...CONFIG_DEFAULT }
  return { version: c.version, umbralConfirmacionPct: c.umbralConfirmacionPct, umbralRetencionPct: c.umbralRetencionPct }
}

async function asegurarConfig(tx: Tx, tenantId: string): Promise<ConfigPrecios> {
  await tx.insert(preciosOnlineConfig).values({ tenantId }).onConflictDoNothing()
  return leerConfig(tenantId, tx)
}

// ── Cambios sobre la configuración ──────────────────────────────────────────────────────────

export interface EntradaHistorial {
  tipo: string
  objeto: string
  listaId: string | null
  antes: Record<string, unknown> | null
  despues: Record<string, unknown> | null
}

type ListaRow = typeof listasPrecioOnline.$inferSelect

const snapLista = (l: ListaRow) => ({
  id: l.id,
  nombre: l.nombre,
  coeficiente: l.coeficiente,
  orden: l.orden,
  activa: l.activa,
  esReferencia: l.esReferencia,
  privada: l.privada,
})

type MapeoRow = typeof listaPrecioAlegraMapeo.$inferSelect
const snapMapeo = (alegraAccount: string, alegraPriceListId: string, listaId: string | null) => ({
  alegraAccount,
  alegraPriceListId,
  listaId,
})

async function cargarLista(tx: Tx, tenantId: string, listaId: string): Promise<ListaRow> {
  const [l] = await tx
    .select()
    .from(listasPrecioOnline)
    .where(and(eq(listasPrecioOnline.tenantId, tenantId), eq(listasPrecioOnline.id, listaId)))
  if (!l) throw new PreciosOnlineError(404, "lista_no_existe", MSG_LISTA_NO_EXISTE)
  return l
}

async function nombreLibre(tx: Tx, tenantId: string, nombre: string, exceptoId?: string): Promise<void> {
  const dup = await tx
    .select({ id: listasPrecioOnline.id })
    .from(listasPrecioOnline)
    .where(and(eq(listasPrecioOnline.tenantId, tenantId), sql`lower(${listasPrecioOnline.nombre}) = lower(${nombre})`))
  if (dup.some((d) => d.id !== exceptoId)) throw new PreciosOnlineError(422, "duplicado", MSG_NOMBRE_DUPLICADO)
}

type OverrideRow = typeof listaPrecioOverrides.$inferSelect
const snapOverride = (o: OverrideRow) => ({
  id: o.id,
  listaId: o.listaId,
  tipo: o.tipo,
  marca: o.marca,
  categoriaId: o.categoriaId,
  coeficiente: o.coeficiente,
})

async function aplicarUno(tx: Tx, tenantId: string, c: CambioPrecios): Promise<EntradaHistorial[]> {
  switch (c.op) {
    case "crearLista": {
      await nombreLibre(tx, tenantId, c.nombre)
      const existentes = await tx.select().from(listasPrecioOnline).where(eq(listasPrecioOnline.tenantId, tenantId))
      // Siempre hay exactamente UNA referencia: la primera lista que se crea lo es.
      const esReferencia = !existentes.some((l) => l.esReferencia)
      if (esReferencia && c.privada) throw new PreciosOnlineError(422, "referencia_privada", MSG_REFERENCIA_PRIVADA)
      const orden = c.orden ?? existentes.reduce((m, l) => Math.max(m, l.orden), 0) + 1
      const [l] = await tx
        .insert(listasPrecioOnline)
        .values({ tenantId, nombre: c.nombre, coeficiente: c.coeficiente, orden, esReferencia, privada: c.privada ?? false })
        .returning()
      return [{ tipo: "lista_alta", objeto: `lista:${l.id}`, listaId: l.id, antes: null, despues: snapLista(l) }]
    }
    case "editarLista": {
      const l = await cargarLista(tx, tenantId, c.listaId)
      if (c.nombre !== undefined && c.nombre.toLowerCase() !== l.nombre.toLowerCase()) {
        await nombreLibre(tx, tenantId, c.nombre, l.id)
      }
      if (c.activa === false && l.esReferencia) {
        throw new PreciosOnlineError(
          422,
          "referencia_inactiva",
          "La lista de referencia no puede desactivarse. Elija otra lista como referencia antes.",
        )
      }
      const entradas: EntradaHistorial[] = []
      if (c.privada !== undefined && c.privada !== l.privada) {
        if (c.privada) {
          if (l.esReferencia) throw new PreciosOnlineError(422, "referencia_privada", MSG_REFERENCIA_PRIVADA)
          const [uso] = await tx
            .select({ id: listaPrecioCondiciones.id })
            .from(listaPrecioCondiciones)
            .where(eq(listaPrecioCondiciones.listaId, l.id))
          if (uso) throw new PreciosOnlineError(422, "lista_en_uso", MSG_PRIVADA_CON_MEDIO)
        } else {
          // Volver pública quita sus enlaces con la lista de Alegra (la base no deja uno sin el otro).
          const enlaces = await tx.select().from(listaPrecioAlegraMapeo).where(eq(listaPrecioAlegraMapeo.listaId, l.id))
          if (enlaces.length > 0) {
            await tx.delete(listaPrecioAlegraMapeo).where(eq(listaPrecioAlegraMapeo.listaId, l.id))
            for (const m of enlaces) {
              entradas.push({
                tipo: "mapeo",
                objeto: `mapeo:${m.alegraAccount}:${m.alegraPriceListId}`,
                listaId: l.id,
                antes: snapMapeo(m.alegraAccount, m.alegraPriceListId, l.id),
                despues: snapMapeo(m.alegraAccount, m.alegraPriceListId, null),
              })
            }
          }
        }
      }
      const [n] = await tx
        .update(listasPrecioOnline)
        .set({
          ...(c.nombre !== undefined ? { nombre: c.nombre } : {}),
          ...(c.coeficiente !== undefined ? { coeficiente: c.coeficiente } : {}),
          ...(c.orden !== undefined ? { orden: c.orden } : {}),
          ...(c.activa !== undefined ? { activa: c.activa } : {}),
          ...(c.privada !== undefined ? { privada: c.privada } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(listasPrecioOnline.id, l.id))
        .returning()
      entradas.push({ tipo: "lista_edicion", objeto: `lista:${l.id}`, listaId: l.id, antes: snapLista(l), despues: snapLista(n) })
      return entradas
    }
    case "borrarLista": {
      const l = await cargarLista(tx, tenantId, c.listaId)
      if (l.esReferencia) {
        throw new PreciosOnlineError(
          422,
          "referencia_no_se_borra",
          "No puede eliminarse la lista de referencia. Elija otra lista como referencia antes.",
        )
      }
      const usos = await tx
        .select({ medio: listaPrecioCondiciones.medioSlug })
        .from(listaPrecioCondiciones)
        .where(eq(listaPrecioCondiciones.listaId, l.id))
      if (usos.length > 0) {
        throw new PreciosOnlineError(
          422,
          "lista_en_uso",
          "No puede eliminarse una lista enlazada a un medio de pago. Quite el enlace primero.",
        )
      }
      const ovs = await tx.select().from(listaPrecioOverrides).where(eq(listaPrecioOverrides.listaId, l.id))
      const enlaces = await tx.select().from(listaPrecioAlegraMapeo).where(eq(listaPrecioAlegraMapeo.listaId, l.id))
      await tx.delete(listasPrecioOnline).where(eq(listasPrecioOnline.id, l.id)) // overrides y enlaces caen por cascada
      return [
        {
          tipo: "lista_baja",
          objeto: `lista:${l.id}`,
          listaId: l.id,
          antes: {
            ...snapLista(l),
            overrides: ovs.map(snapOverride),
            mapeos: enlaces.map((m: MapeoRow) => ({ alegraAccount: m.alegraAccount, alegraPriceListId: m.alegraPriceListId })),
          },
          despues: null,
        },
      ]
    }
    case "setReferencia": {
      const nueva = await cargarLista(tx, tenantId, c.listaId)
      if (!nueva.activa) {
        throw new PreciosOnlineError(422, "referencia_inactiva", "La lista de referencia debe estar activa.")
      }
      const [actual] = await tx
        .select()
        .from(listasPrecioOnline)
        .where(and(eq(listasPrecioOnline.tenantId, tenantId), eq(listasPrecioOnline.esReferencia, true)))
      if (actual?.id === nueva.id) {
        throw new PreciosOnlineError(422, "ya_es_referencia", "Esa lista ya es la de referencia.")
      }
      // Misma transacción: nunca hay 0 ni 2 referencias visibles desde afuera.
      if (actual) await tx.update(listasPrecioOnline).set({ esReferencia: false, updatedAt: sql`now()` }).where(eq(listasPrecioOnline.id, actual.id))
      await tx.update(listasPrecioOnline).set({ esReferencia: true, updatedAt: sql`now()` }).where(eq(listasPrecioOnline.id, nueva.id))
      return [
        {
          tipo: "referencia",
          objeto: "referencia",
          listaId: nueva.id,
          antes: { listaId: actual?.id ?? null },
          despues: { listaId: nueva.id },
        },
      ]
    }
    case "upsertOverride": {
      // El validador ya la normaliza; acá se asegura igual (la base exige lower(btrim(marca))).
      if (c.tipo === "marca") c = { ...c, marca: normalizarMarca(c.marca) }
      const lista = await cargarLista(tx, tenantId, c.listaId)
      if (c.tipo === "categoria") {
        const [cat] = await tx
          .select({ id: shopCategories.id })
          .from(shopCategories)
          .where(and(eq(shopCategories.tenantId, tenantId), eq(shopCategories.id, c.categoriaId)))
        if (!cat) throw new PreciosOnlineError(404, "categoria_no_existe", "La categoría indicada no existe.")
      }
      const [previo] = await tx
        .select()
        .from(listaPrecioOverrides)
        .where(
          and(
            eq(listaPrecioOverrides.listaId, lista.id),
            c.tipo === "marca"
              ? and(eq(listaPrecioOverrides.tipo, "marca"), eq(listaPrecioOverrides.marca, c.marca))
              : and(eq(listaPrecioOverrides.tipo, "categoria"), eq(listaPrecioOverrides.categoriaId, c.categoriaId)),
          ),
        )
      if (previo) {
        const [n] = await tx
          .update(listaPrecioOverrides)
          .set({ coeficiente: c.coeficiente, updatedAt: sql`now()` })
          .where(eq(listaPrecioOverrides.id, previo.id))
          .returning()
        return [
          { tipo: "override_edicion", objeto: `override:${n.id}`, listaId: lista.id, antes: snapOverride(previo), despues: snapOverride(n) },
        ]
      }
      const [n] = await tx
        .insert(listaPrecioOverrides)
        .values({
          tenantId,
          listaId: lista.id,
          tipo: c.tipo,
          marca: c.tipo === "marca" ? c.marca : null,
          categoriaId: c.tipo === "categoria" ? c.categoriaId : null,
          coeficiente: c.coeficiente,
        })
        .returning()
      return [{ tipo: "override_alta", objeto: `override:${n.id}`, listaId: lista.id, antes: null, despues: snapOverride(n) }]
    }
    case "borrarOverride": {
      const [o] = await tx
        .select()
        .from(listaPrecioOverrides)
        .where(and(eq(listaPrecioOverrides.tenantId, tenantId), eq(listaPrecioOverrides.id, c.overrideId)))
      if (!o) throw new PreciosOnlineError(404, "override_no_existe", "El ajuste indicado no existe.")
      await tx.delete(listaPrecioOverrides).where(eq(listaPrecioOverrides.id, o.id))
      return [{ tipo: "override_baja", objeto: `override:${o.id}`, listaId: o.listaId, antes: snapOverride(o), despues: null }]
    }
    case "setUmbrales": {
      const previo = await asegurarConfig(tx, tenantId)
      const [n] = await tx
        .update(preciosOnlineConfig)
        .set({
          ...(c.confirmacionPct !== undefined ? { umbralConfirmacionPct: c.confirmacionPct } : {}),
          ...(c.retencionPct !== undefined ? { umbralRetencionPct: c.retencionPct } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(preciosOnlineConfig.tenantId, tenantId))
        .returning()
      return [
        {
          tipo: "umbral",
          objeto: "umbral",
          listaId: null,
          antes: { confirmacionPct: previo.umbralConfirmacionPct, retencionPct: previo.umbralRetencionPct },
          despues: { confirmacionPct: n.umbralConfirmacionPct, retencionPct: n.umbralRetencionPct },
        },
      ]
    }
    case "setCondicion": {
      const { medioSlug, cuotas, listaId } = c
      // Ausente = todas las formas (fila de siempre). Sólo existe en el pago único (CHECK de la 0076).
      const forma = c.forma ?? null
      if (forma !== null && cuotas !== null) {
        throw new PreciosOnlineError(422, "forma_invalida", "La forma de pago solo se elige para el pago único.")
      }
      // Ausente = sin mínimo. Sólo las filas de cuotas pueden tenerlo (CHECK de la migración 0066).
      const montoMinimo = c.montoMinimo ?? null
      if (montoMinimo !== null && cuotas === null) {
        throw new PreciosOnlineError(422, "monto_minimo_invalido", "El monto mínimo sólo aplica a las cuotas.")
      }
      // Ausente = todas las tarjetas. Igual que el mínimo, sólo en filas de cuotas (CHECK de la 0074).
      const marcas = c.marcas && c.marcas.length > 0 ? ordenarMarcas(c.marcas) : null
      if (marcas !== null && cuotas === null) {
        throw new PreciosOnlineError(422, "marcas_invalidas", "Las tarjetas sólo se eligen para las cuotas.")
      }
      const [medio] = await tx
        .select({ slug: mediosPagoShop.slug, opcionesCobro: mediosPagoShop.opcionesCobro })
        .from(mediosPagoShop)
        .where(and(eq(mediosPagoShop.tenantId, tenantId), eq(mediosPagoShop.slug, medioSlug)))
      if (!medio) throw new PreciosOnlineError(404, "medio_no_existe", "El medio de pago indicado no existe.")
      if (forma !== null) {
        if (medioSlug !== "mercadopago" && medioSlug !== "payway") {
          throw new PreciosOnlineError(422, "forma_invalida", "Las listas por forma de pago solo aplican a Mercado Pago y Payway.")
        }
        // Dar de alta o cambiar exige la forma habilitada (y que el procesador la cobre: Payway no cobra
        // con cuenta de Mercado Pago). Quitar la lista de una forma deshabilitada siempre se permite.
        if (listaId !== null && !opcionesAplicables(medioSlug, medio.opcionesCobro).includes(forma)) {
          throw new PreciosOnlineError(
            422,
            "forma_no_habilitada",
            medioSlug === "payway" && forma === "cuenta_mp"
              ? "Payway no admite la forma Cuenta de Mercado Pago."
              : "Habilite esa forma de pago en el medio antes de asignarle una lista.",
          )
        }
      }
      if (listaId !== null) {
        const destino = await cargarLista(tx, tenantId, listaId)
        if (destino.privada) throw new PreciosOnlineError(422, "lista_privada", MSG_PRIVADA_A_MEDIO)
      }
      const [previo] = await tx
        .select()
        .from(listaPrecioCondiciones)
        .where(
          and(
            eq(listaPrecioCondiciones.tenantId, tenantId),
            eq(listaPrecioCondiciones.medioSlug, medioSlug),
            cuotas === null ? sql`${listaPrecioCondiciones.cuotas} IS NULL` : eq(listaPrecioCondiciones.cuotas, cuotas),
            // Una fila por forma (0076) o, sin forma, la de todas las formas.
            forma === null ? sql`${listaPrecioCondiciones.forma} IS NULL` : eq(listaPrecioCondiciones.forma, forma),
          ),
        )
      // Entradas viejas (sin forma) conservan su clave.
      const objeto = `condicion:${medioSlug}:${cuotas ?? 0}${forma ? `:${forma}` : ""}`
      // `forma` sólo viaja cuando hay una: el historial de siempre queda idéntico.
      const conForma = forma ? { forma } : {}
      const snap = (x: typeof previo | undefined) =>
        x
          ? { medioSlug: x.medioSlug, cuotas: x.cuotas, listaId: x.listaId, montoMinimo: x.montoMinimo, marcas: x.marcas, ...conForma }
          : { medioSlug: medioSlug, cuotas: cuotas, listaId: null, montoMinimo: null, marcas: null, ...conForma }
      if (listaId === null) {
        if (!previo) throw new PreciosOnlineError(422, "sin_cambios", "Ese medio de pago no tiene una lista enlazada.")
        await tx.delete(listaPrecioCondiciones).where(eq(listaPrecioCondiciones.id, previo.id))
        return [{ tipo: "condicion", objeto, listaId: previo.listaId, antes: snap(previo), despues: snap(undefined) }]
      }
      // Mismo monto aunque el texto difiera ("50000" vs "50000.00"): se compara como número.
      const mismoMonto =
        previo !== undefined &&
        (previo.montoMinimo === null
          ? montoMinimo === null
          : montoMinimo !== null && Number(previo.montoMinimo) === Number(montoMinimo))
      const mismasMarcas = previo !== undefined && mismaListaDeMarcas(previo.marcas, marcas)
      if (previo?.listaId === listaId && mismoMonto && mismasMarcas) {
        throw new PreciosOnlineError(422, "sin_cambios", "Ese medio de pago ya usa esa lista.")
      }
      if (previo) {
        await tx
          .update(listaPrecioCondiciones)
          .set({ listaId: listaId, montoMinimo: montoMinimo, marcas: marcas, updatedAt: sql`now()` })
          .where(eq(listaPrecioCondiciones.id, previo.id))
      } else {
        await tx
          .insert(listaPrecioCondiciones)
          .values({ tenantId, listaId: listaId, medioSlug: medioSlug, cuotas: cuotas, montoMinimo: montoMinimo, marcas: marcas, forma })
      }
      return [
        {
          tipo: "condicion",
          objeto,
          listaId: listaId,
          antes: snap(previo),
          despues: { medioSlug: medioSlug, cuotas: cuotas, listaId: listaId, montoMinimo: montoMinimo, marcas: marcas, ...conForma },
        },
      ]
    }
    case "setMapeo": {
      const { alegraAccount, alegraPriceListId, listaId } = c
      if (listaId !== null) {
        const destino = await cargarLista(tx, tenantId, listaId)
        if (!destino.privada) throw new PreciosOnlineError(422, "lista_no_privada", MSG_MAPEO_NO_PRIVADA)
      }
      const [previo] = await tx
        .select()
        .from(listaPrecioAlegraMapeo)
        .where(
          and(
            eq(listaPrecioAlegraMapeo.tenantId, tenantId),
            eq(listaPrecioAlegraMapeo.alegraAccount, alegraAccount),
            eq(listaPrecioAlegraMapeo.alegraPriceListId, alegraPriceListId),
          ),
        )
      const objeto = `mapeo:${alegraAccount}:${alegraPriceListId}`
      if (listaId === null) {
        if (!previo) throw new PreciosOnlineError(422, "sin_cambios", "Esa lista de Alegra no está enlazada a ninguna lista.")
        await tx.delete(listaPrecioAlegraMapeo).where(eq(listaPrecioAlegraMapeo.id, previo.id))
        return [
          {
            tipo: "mapeo",
            objeto,
            listaId: previo.listaId,
            antes: snapMapeo(alegraAccount, alegraPriceListId, previo.listaId),
            despues: snapMapeo(alegraAccount, alegraPriceListId, null),
          },
        ]
      }
      if (previo?.listaId === listaId) {
        throw new PreciosOnlineError(422, "sin_cambios", "Esa lista de Alegra ya está enlazada a esa lista.")
      }
      if (previo) {
        await tx
          .update(listaPrecioAlegraMapeo)
          .set({ listaId, updatedAt: sql`now()` })
          .where(eq(listaPrecioAlegraMapeo.id, previo.id))
      } else {
        await tx.insert(listaPrecioAlegraMapeo).values({ tenantId, alegraAccount, alegraPriceListId, listaId })
      }
      return [
        {
          tipo: "mapeo",
          objeto,
          listaId,
          antes: snapMapeo(alegraAccount, alegraPriceListId, previo?.listaId ?? null),
          despues: snapMapeo(alegraAccount, alegraPriceListId, listaId),
        },
      ]
    }
    case "restaurarLista": {
      // Solo al revertir una baja: la lista vuelve con su mismo id (el historial la sigue nombrando).
      await nombreLibre(tx, tenantId, c.lista.nombre)
      const [ref] = await tx
        .select({ id: listasPrecioOnline.id })
        .from(listasPrecioOnline)
        .where(and(eq(listasPrecioOnline.tenantId, tenantId), eq(listasPrecioOnline.esReferencia, true)))
      const [l] = await tx
        .insert(listasPrecioOnline)
        .values({
          id: c.lista.id,
          tenantId,
          nombre: c.lista.nombre,
          coeficiente: c.lista.coeficiente,
          orden: c.lista.orden,
          activa: c.lista.activa,
          esReferencia: ref ? false : c.lista.esReferencia,
          privada: c.lista.privada ?? false,
        })
        .returning()
      // Los enlaces con la lista de Alegra vuelven si la clave (cuenta + lista de Alegra) sigue libre.
      for (const m of c.lista.privada ? (c.mapeos ?? []) : []) {
        await tx
          .insert(listaPrecioAlegraMapeo)
          .values({ tenantId, alegraAccount: m.alegraAccount, alegraPriceListId: m.alegraPriceListId, listaId: l.id })
          .onConflictDoNothing()
      }
      const existentes = new Set(
        (await tx.select({ id: shopCategories.id }).from(shopCategories).where(eq(shopCategories.tenantId, tenantId))).map((x) => x.id),
      )
      const restaurables = c.overrides.filter((o) => o.tipo === "marca" || (o.categoriaId && existentes.has(o.categoriaId)))
      const nuevos = restaurables.length
        ? await tx
            .insert(listaPrecioOverrides)
            .values(
              restaurables.map((o) => ({
                tenantId,
                listaId: l.id,
                tipo: o.tipo,
                marca: o.marca,
                categoriaId: o.categoriaId,
                coeficiente: o.coeficiente,
              })),
            )
            .returning()
        : []
      return [
        {
          tipo: "lista_alta",
          objeto: `lista:${l.id}`,
          listaId: l.id,
          antes: null,
          despues: { ...snapLista(l), overrides: nuevos.map(snapOverride) },
        },
      ]
    }
  }
}

// ── Simulación (vista previa y aplicar comparten el código) ─────────────────────────────────

export interface FilaMuestra {
  alegraId: string
  code: string | null
  nombre: string
  listaId: string
  listaNombre: string | null
  antes: string | null
  despues: string | null
  variacionPct: number | null
}

export interface ResultadoPrevia {
  baseVersion: number
  huella: string
  productosAfectados: number
  suben: number
  bajan: number
  /** (producto, lista) que pasan a tener precio por primera vez: no tienen variación que medir. */
  nuevos: number
  /** (producto, lista) que dejan de tener precio (lista desactivada o eliminada). */
  quitan: number
  /** Productos sin costo: excluidos del cálculo (sin precio online). */
  sinPrecio: number
  /** Variación entre el precio online ANTERIOR y el NUEVO; null si ninguno la tiene. */
  mayorSubaPct: number | null
  mayorBajaPct: number | null
  mayorSubaMonto: string | null
  mayorBajaMonto: string | null
  requiereConfirmacionExtra: boolean
  umbralPct: number
  advertencias: { listaSuperaReferencia: number }
  muestra: FilaMuestra[]
}

interface Simulada {
  resultado: ResultadoPrevia
  entradas: EntradaHistorial[]
}

async function simular(tx: Tx, tenantId: string, cambios: CambioPrecios[], cfg: ConfigPrecios): Promise<Simulada> {
  const entradas: EntradaHistorial[] = []
  for (const c of cambios) entradas.push(...(await aplicarUno(tx, tenantId, c)))

  await tx.execute(sql`
    CREATE TEMP TABLE _po_nuevo ON COMMIT DROP AS
    SELECT alegra_id, lista_id::text AS lista_id, precio
    FROM calcular_precios_online(${tenantId}, NULL) WHERE precio IS NOT NULL
  `)
  const [ref] = await tx
    .select({ id: listasPrecioOnline.id })
    .from(listasPrecioOnline)
    .where(and(eq(listasPrecioOnline.tenantId, tenantId), eq(listasPrecioOnline.esReferencia, true)))
  const refId = ref?.id ?? null
  // Diferencias entre lo vigente (catalog_products.precios_online) y lo que daría la configuración
  // nueva: una fila por (producto, lista) con 'lista', y una por producto para el precio principal
  // ('ref': el de la lista de referencia, que cambia también si se cambia de referencia).
  await tx.execute(sql`
    CREATE TEMP TABLE _po_diff ON COMMIT DROP AS
    SELECT 'lista'::text AS kind, coalesce(n.alegra_id, v.alegra_id) AS alegra_id,
           coalesce(n.lista_id, v.lista_id) AS lista_id, v.precio AS antes, n.precio AS despues
    FROM _po_nuevo n
    FULL JOIN (
      SELECT p.alegra_id, e->>'idPriceList' AS lista_id, (e->>'price')::numeric AS precio
      FROM catalog_products p CROSS JOIN LATERAL jsonb_array_elements(p.precios_online || p.precios_online_privados) e
      WHERE p.tenant_id = ${tenantId}
    ) v ON v.alegra_id = n.alegra_id AND v.lista_id = n.lista_id
    WHERE n.precio IS DISTINCT FROM v.precio
    UNION ALL
    SELECT 'ref', p.alegra_id, 'ref', p.precio_online_ref, r.precio
    FROM catalog_products p
    LEFT JOIN _po_nuevo r ON r.alegra_id = p.alegra_id AND r.lista_id = ${refId === null ? sql`NULL` : sql`${refId}`}
    WHERE p.tenant_id = ${tenantId} AND p.precio_online_ref IS DISTINCT FROM r.precio
  `)

  const umbral = cfg.umbralConfirmacionPct
  const [agg] = (await tx.execute(sql`
    SELECT
      count(DISTINCT d.alegra_id)::int AS afectados,
      (count(*) FILTER (WHERE d.kind = 'lista' AND d.antes IS NOT NULL AND d.despues IS NOT NULL AND d.despues > d.antes))::int AS suben,
      (count(*) FILTER (WHERE d.kind = 'lista' AND d.antes IS NOT NULL AND d.despues IS NOT NULL AND d.despues < d.antes))::int AS bajan,
      (count(*) FILTER (WHERE d.kind = 'lista' AND d.antes IS NULL AND d.despues IS NOT NULL))::int AS nuevos,
      (count(*) FILTER (WHERE d.kind = 'lista' AND d.despues IS NULL))::int AS quitan,
      round(max((d.despues - d.antes) * 100 / d.antes) FILTER (WHERE d.antes > 0 AND d.despues IS NOT NULL AND d.despues > d.antes), 2)::float8 AS mayor_suba_pct,
      round(min((d.despues - d.antes) * 100 / d.antes) FILTER (WHERE d.antes > 0 AND d.despues IS NOT NULL AND d.despues < d.antes), 2)::float8 AS mayor_baja_pct,
      (max(d.despues - d.antes) FILTER (WHERE d.antes IS NOT NULL AND d.despues IS NOT NULL AND d.despues > d.antes))::text AS mayor_suba_monto,
      (min(d.despues - d.antes) FILTER (WHERE d.antes IS NOT NULL AND d.despues IS NOT NULL AND d.despues < d.antes))::text AS mayor_baja_monto,
      coalesce(bool_or(abs(d.despues - d.antes) * 100 > ${umbral}::numeric * d.antes) FILTER (WHERE d.antes > 0 AND d.despues IS NOT NULL), false) AS supera,
      -- La lista se identifica por NOMBRE (único por tenant) y no por id: una lista que se crea con
      -- estos cambios recibe un uuid distinto en la previa y en el aplicar.
      md5(coalesce(string_agg(
        d.kind || '|' || d.alegra_id || '|' || coalesce(lower(l.nombre), d.lista_id) || '|' || coalesce(d.antes::text, '') || '|' || coalesce(d.despues::text, ''),
        ',' ORDER BY d.kind, d.alegra_id, coalesce(lower(l.nombre), d.lista_id)), '')) AS huella
    FROM _po_diff d
    LEFT JOIN listas_precio_online l ON l.id::text = d.lista_id
  `)) as unknown as {
    afectados: number
    suben: number
    bajan: number
    nuevos: number
    quitan: number
    mayor_suba_pct: number | null
    mayor_baja_pct: number | null
    mayor_suba_monto: string | null
    mayor_baja_monto: string | null
    supera: boolean
    huella: string
  }[]

  const muestra = (await tx.execute(sql`
    SELECT d.alegra_id AS "alegraId", p.code, coalesce(o.nombre, p.name) AS nombre, d.lista_id AS "listaId",
           l.nombre AS "listaNombre", d.antes::text AS antes, d.despues::text AS despues,
           CASE WHEN d.antes > 0 AND d.despues IS NOT NULL THEN round((d.despues - d.antes) * 100 / d.antes, 2)::float8 END AS "variacionPct"
    FROM _po_diff d
    JOIN catalog_products p ON p.tenant_id = ${tenantId} AND p.alegra_id = d.alegra_id
    LEFT JOIN catalog_overlay o ON o.tenant_id = p.tenant_id AND o.alegra_id = p.alegra_id
    LEFT JOIN listas_precio_online l ON l.id::text = d.lista_id
    WHERE d.kind = 'lista'
    ORDER BY abs(coalesce(d.despues, 0) - coalesce(d.antes, 0)) DESC, d.alegra_id, d.lista_id
    LIMIT 50
  `)) as unknown as FilaMuestra[]

  const [{ sin_precio }] = (await tx.execute(sql`
    SELECT count(*)::int AS sin_precio FROM catalog_products
    WHERE tenant_id = ${tenantId} AND status = 'active' AND reemplazado_por_alegra_id IS NULL
      AND (costo_aplicado IS NULL OR costo_aplicado <= 0)
  `)) as unknown as { sin_precio: number }[]

  let superanRef = 0
  if (refId) {
    const [r] = (await tx.execute(sql`
      SELECT count(DISTINCT n.alegra_id)::int AS c
      FROM _po_nuevo n JOIN _po_nuevo r ON r.alegra_id = n.alegra_id AND r.lista_id = ${refId}
      WHERE n.lista_id <> ${refId} AND n.precio > r.precio
    `)) as unknown as { c: number }[]
    superanRef = r.c
  }

  const huella = createHash("sha256").update(`${agg.huella}|${cfg.version}|${JSON.stringify(cambios)}`).digest("hex")
  return {
    entradas,
    resultado: {
      baseVersion: cfg.version,
      huella,
      productosAfectados: agg.afectados,
      suben: agg.suben,
      bajan: agg.bajan,
      nuevos: agg.nuevos,
      quitan: agg.quitan,
      sinPrecio: sin_precio,
      mayorSubaPct: agg.mayor_suba_pct,
      mayorBajaPct: agg.mayor_baja_pct,
      mayorSubaMonto: agg.mayor_suba_monto,
      mayorBajaMonto: agg.mayor_baja_monto,
      requiereConfirmacionExtra: agg.supera,
      umbralPct: Number(umbral),
      advertencias: { listaSuperaReferencia: superanRef },
      muestra,
    },
  }
}

class Rollback extends Error {
  constructor(readonly resultado: ResultadoPrevia) {
    super("rollback")
  }
}

/** Vista previa: aplica los cambios dentro de una transacción y los DESHACE. No escribe nada. */
export async function previsualizar(tenantId: string, cambios: CambioPrecios[]): Promise<ResultadoPrevia> {
  try {
    await getDb().transaction(async (tx) => {
      await lockTenant(tx, tenantId)
      const cfg = await asegurarConfig(tx, tenantId)
      const { resultado } = await simular(tx, tenantId, cambios, cfg)
      throw new Rollback(resultado)
    })
  } catch (e) {
    if (e instanceof Rollback) return e.resultado
    throw e
  }
  throw new Error("unreachable")
}

export interface UsuarioActor {
  id: string
  name: string
  email: string
}

export interface EntradaAplicar {
  cambios: CambioPrecios[]
  baseVersion: number
  huella: string
  confirmaExtra?: boolean
  /** Solo al revertir (lo arma `aplicarReversion`). */
  revertidoDe?: string
}

export interface ResultadoAplicar {
  version: number
  resultado: ResultadoPrevia
  entradas: number
  /** Hubo cambios de condiciones de medios de pago (hay que invalidar la caché de medios del Shop). */
  condiciones: boolean
}

async function aplicarEnTx(
  tx: Tx,
  tenantId: string,
  usuario: UsuarioActor,
  entrada: EntradaAplicar,
): Promise<ResultadoAplicar> {
  const cfg = await asegurarConfig(tx, tenantId)
  if (cfg.version !== entrada.baseVersion) {
    throw new PreciosOnlineError(409, "previa_vencida", MSG_PREVIA_VENCIDA)
  }
  const { resultado, entradas } = await simular(tx, tenantId, entrada.cambios, cfg)
  if (resultado.huella !== entrada.huella) {
    throw new PreciosOnlineError(409, "previa_vencida", MSG_PREVIA_VENCIDA)
  }
  if (resultado.requiereConfirmacionExtra && !entrada.confirmaExtra) {
    throw new PreciosOnlineError(
      409,
      "confirmacion_extra",
      `Este cambio modifica algún precio en más de ${resultado.umbralPct} %. Confirme que desea aplicarlo.`,
      { resultado },
    )
  }
  await tx.execute(sql`SELECT * FROM aplicar_precios_online(${tenantId}, NULL::text[], 'config')`)
  const version = cfg.version + 1
  const resumen = {
    productosAfectados: resultado.productosAfectados,
    suben: resultado.suben,
    bajan: resultado.bajan,
    nuevos: resultado.nuevos,
    quitan: resultado.quitan,
    mayorSubaPct: resultado.mayorSubaPct,
    mayorBajaPct: resultado.mayorBajaPct,
    confirmacionExtra: resultado.requiereConfirmacionExtra,
  }
  for (const e of entradas) {
    await tx.insert(preciosOnlineCambios).values({
      tenantId,
      tipo: entrada.revertidoDe ? "revertir" : e.tipo,
      objeto: e.objeto,
      listaId: e.listaId,
      antes: e.antes,
      despues: e.despues,
      resumen: entrada.revertidoDe ? { ...resumen, operacion: e.tipo } : resumen,
      usuario: usuario.email || usuario.id,
      creadoAt: sql`clock_timestamp()`,
      revertidoDe: entrada.revertidoDe ?? null,
      versionConfig: version,
    })
  }
  await tx
    .update(preciosOnlineConfig)
    .set({ version, updatedAt: sql`now()`, updatedBy: usuario.email || usuario.id })
    .where(eq(preciosOnlineConfig.tenantId, tenantId))
  return { version, resultado, entradas: entradas.length, condiciones: entradas.some((e) => e.tipo === "condicion") }
}

/**
 * Avisos al Shop DESPUÉS del commit (si fallan, se registra y el cambio ya está guardado; el Shop
 * lo toma al vencer su caché). Un cambio de condiciones además invalida la caché de los medios.
 */
async function avisarTrasCommit(tenantId: string, hubo: { condiciones?: boolean } = {}): Promise<void> {
  try {
    await avisarShop(tenantId)
  } catch (err) {
    console.warn(`[precios-online] aviso al Shop falló: ${err instanceof Error ? err.name : "error"}`)
  }
  if (hubo.condiciones) {
    try {
      await pingShopRevalidarSucursales()
    } catch (err) {
      console.warn(`[precios-online] aviso de condiciones al Shop falló: ${err instanceof Error ? err.name : "error"}`)
    }
  }
}

/**
 * Aplica los cambios en UNA transacción: valida que la previa siga vigente (versión + huella),
 * exige la confirmación extra si la variación SUPERA el umbral, recalcula, deja el historial y
 * sube la versión. Todo o nada.
 */
export async function aplicarCambios(
  tenantId: string,
  usuario: UsuarioActor,
  entrada: EntradaAplicar,
): Promise<ResultadoAplicar> {
  const r = await getDb().transaction(async (tx) => {
    await lockTenant(tx, tenantId)
    return aplicarEnTx(tx, tenantId, usuario, entrada)
  })
  await avisarTrasCommit(tenantId, { condiciones: r.condiciones })
  return r
}

// ── Revertir (OQ2: solo la última entrada vigente de cada objeto) ───────────────────────────

type CambioRow = typeof preciosOnlineCambios.$inferSelect

const IRREVERTIBLES = new Set(["revertir", "costo_aprobado", "costo_rechazado"])

async function inversosDe(tx: Tx | Db, tenantId: string, entradaId: string): Promise<{ cambios: CambioPrecios[]; entrada: CambioRow }> {
  const [e] = await tx
    .select()
    .from(preciosOnlineCambios)
    .where(and(eq(preciosOnlineCambios.tenantId, tenantId), eq(preciosOnlineCambios.id, entradaId)))
  if (!e) throw new PreciosOnlineError(404, "entrada_no_existe", "El cambio indicado no existe.")
  if (IRREVERTIBLES.has(e.tipo)) {
    throw new PreciosOnlineError(422, "irreversible", "Este cambio no puede revertirse.")
  }
  const [ya] = await tx
    .select({ id: preciosOnlineCambios.id })
    .from(preciosOnlineCambios)
    .where(and(eq(preciosOnlineCambios.tenantId, tenantId), eq(preciosOnlineCambios.revertidoDe, e.id)))
  if (ya) throw new PreciosOnlineError(409, "ya_revertido", "Este cambio ya fue revertido.")
  const [posterior] = await tx
    .select({ id: preciosOnlineCambios.id })
    .from(preciosOnlineCambios)
    .where(
      and(
        eq(preciosOnlineCambios.tenantId, tenantId),
        eq(preciosOnlineCambios.objeto, e.objeto),
        // Se compara en SQL: el timestamp tiene microsegundos y un Date de JS los pierde.
        sql`${preciosOnlineCambios.creadoAt} > (SELECT c.creado_at FROM precios_online_cambios c WHERE c.id = ${e.id})`,
      ),
    )
  if (posterior) {
    throw new PreciosOnlineError(
      409,
      "choque",
      "Este elemento se modificó después de este cambio. Revierta primero el cambio más reciente.",
    )
  }
  const a = (e.antes ?? {}) as Record<string, unknown>
  const d = (e.despues ?? {}) as Record<string, unknown>
  let cambios: CambioPrecios[]
  switch (e.tipo) {
    case "lista_alta":
      cambios = [{ op: "borrarLista", listaId: String(d.id) }]
      break
    case "lista_edicion":
      cambios = [
        {
          op: "editarLista",
          listaId: String(a.id),
          nombre: String(a.nombre),
          coeficiente: String(a.coeficiente),
          orden: Number(a.orden),
          activa: Boolean(a.activa),
          // Entradas anteriores a la 0068 no guardaron `privada`: no la tocan.
          ...(typeof a.privada === "boolean" ? { privada: a.privada } : {}),
        },
      ]
      break
    case "lista_baja":
      cambios = [
        {
          op: "restaurarLista",
          lista: {
            id: String(a.id),
            nombre: String(a.nombre),
            coeficiente: String(a.coeficiente),
            orden: Number(a.orden),
            activa: Boolean(a.activa),
            esReferencia: Boolean(a.esReferencia),
            privada: Boolean(a.privada),
          },
          mapeos: ((a.mapeos as Record<string, unknown>[] | undefined) ?? []).map((m) => ({
            alegraAccount: String(m.alegraAccount),
            alegraPriceListId: String(m.alegraPriceListId),
          })),
          overrides: ((a.overrides as Record<string, unknown>[] | undefined) ?? []).map((o) => ({
            tipo: o.tipo as "marca" | "categoria",
            marca: (o.marca as string | null) ?? null,
            categoriaId: (o.categoriaId as string | null) ?? null,
            coeficiente: String(o.coeficiente),
          })),
        },
      ]
      break
    case "referencia":
      if (!a.listaId) throw new PreciosOnlineError(422, "irreversible", "Este cambio no puede revertirse.")
      cambios = [{ op: "setReferencia", listaId: String(a.listaId) }]
      break
    case "override_alta":
      cambios = [{ op: "borrarOverride", overrideId: String(d.id) }]
      break
    case "override_edicion":
    case "override_baja": {
      // Los dos restauran el ajuste con los valores de `antes`.
      cambios = [
        a.tipo === "marca"
          ? { op: "upsertOverride", listaId: String(a.listaId), tipo: "marca", marca: String(a.marca), coeficiente: String(a.coeficiente) }
          : {
              op: "upsertOverride",
              listaId: String(a.listaId),
              tipo: "categoria",
              categoriaId: String(a.categoriaId),
              coeficiente: String(a.coeficiente),
            },
      ]
      break
    }
    case "condicion":
      cambios = [
        {
          op: "setCondicion",
          medioSlug: String(a.medioSlug),
          cuotas: a.cuotas === null || a.cuotas === undefined ? null : Number(a.cuotas),
          listaId: (a.listaId as string | null) ?? null,
          // Entradas anteriores a la 0066 no guardaron el mínimo: restauran "sin mínimo".
          montoMinimo: a.montoMinimo === null || a.montoMinimo === undefined ? null : String(a.montoMinimo),
          // Entradas anteriores a la 0074 no guardaron las marcas: restauran "todas las tarjetas".
          marcas: Array.isArray(a.marcas) && a.marcas.length > 0 ? a.marcas.map(String) : null,
          // Entradas anteriores a la 0076 no guardaron la forma: restauran la fila de todas las formas.
          forma: typeof a.forma === "string" && (FORMAS_CONDICION as readonly string[]).includes(a.forma) ? (a.forma as FormaCondicion) : null,
        },
      ]
      break
    case "mapeo":
      cambios = [
        {
          op: "setMapeo",
          alegraAccount: String(a.alegraAccount),
          alegraPriceListId: String(a.alegraPriceListId),
          listaId: (a.listaId as string | null) ?? null,
        },
      ]
      break
    case "umbral":
      cambios = [{ op: "setUmbrales", confirmacionPct: String(a.confirmacionPct), retencionPct: String(a.retencionPct) }]
      break
    default:
      throw new PreciosOnlineError(422, "irreversible", "Este cambio no puede revertirse.")
  }
  return { cambios, entrada: e }
}

/** Vista previa de revertir la entrada: los cambios inversos, por el mismo camino que cualquier cambio. */
export async function previsualizarReversion(
  tenantId: string,
  entradaId: string,
): Promise<{ resultado: ResultadoPrevia; cambios: CambioPrecios[] }> {
  const { cambios } = await inversosDe(getDb(), tenantId, entradaId)
  return { resultado: await previsualizar(tenantId, cambios), cambios }
}

export async function aplicarReversion(
  tenantId: string,
  usuario: UsuarioActor,
  entradaId: string,
  entrada: { baseVersion: number; huella: string; confirmaExtra?: boolean },
): Promise<ResultadoAplicar> {
  const r = await getDb().transaction(async (tx) => {
    await lockTenant(tx, tenantId)
    const { cambios } = await inversosDe(tx, tenantId, entradaId)
    return aplicarEnTx(tx, tenantId, usuario, { ...entrada, cambios, revertidoDe: entradaId })
  })
  await avisarTrasCommit(tenantId, { condiciones: r.condiciones })
  return r
}

// ── Lecturas para el admin ──────────────────────────────────────────────────────────────────

export interface ListaDto {
  id: string
  nombre: string
  coeficiente: string
  esReferencia: boolean
  orden: number
  activa: boolean
  /** Lista privada (0068): solo la ven las cuentas corrientes con la lista de Alegra enlazada. */
  privada: boolean
  /** Enlaces con la lista de Alegra del contacto (solo las privadas los tienen). */
  mapeos: { id: string; alegraAccount: string; alegraPriceListId: string }[]
  overrides: {
    id: string
    tipo: "marca" | "categoria"
    marca: string | null
    categoriaId: string | null
    categoriaNombre: string | null
    coeficiente: string
  }[]
}

export async function listarListas(tenantId: string): Promise<ListaDto[]> {
  const db = getDb()
  const listas = await db
    .select()
    .from(listasPrecioOnline)
    .where(eq(listasPrecioOnline.tenantId, tenantId))
    .orderBy(asc(listasPrecioOnline.orden), asc(listasPrecioOnline.nombre))
  const ovs = await db
    .select({ o: listaPrecioOverrides, categoriaNombre: shopCategories.nombre })
    .from(listaPrecioOverrides)
    .leftJoin(shopCategories, eq(shopCategories.id, listaPrecioOverrides.categoriaId))
    .where(eq(listaPrecioOverrides.tenantId, tenantId))
    .orderBy(asc(listaPrecioOverrides.tipo), asc(listaPrecioOverrides.marca))
  const enlaces = await db
    .select()
    .from(listaPrecioAlegraMapeo)
    .where(eq(listaPrecioAlegraMapeo.tenantId, tenantId))
    .orderBy(asc(listaPrecioAlegraMapeo.alegraAccount), asc(listaPrecioAlegraMapeo.alegraPriceListId))
  return listas.map((l) => ({
    id: l.id,
    nombre: l.nombre,
    coeficiente: l.coeficiente,
    esReferencia: l.esReferencia,
    orden: l.orden,
    activa: l.activa,
    privada: l.privada,
    mapeos: enlaces
      .filter((m) => m.listaId === l.id)
      .map((m) => ({ id: m.id, alegraAccount: m.alegraAccount, alegraPriceListId: m.alegraPriceListId })),
    overrides: ovs
      .filter((x) => x.o.listaId === l.id)
      .map((x) => ({
        id: x.o.id,
        tipo: x.o.tipo as "marca" | "categoria",
        marca: x.o.marca,
        categoriaId: x.o.categoriaId,
        categoriaNombre: x.categoriaNombre,
        coeficiente: x.o.coeficiente,
      })),
  }))
}

export type ListaAlegraDto = ListaAlegraSelector

export interface ListasAlegraResultado {
  listas: ListaAlegraDto[]
  /** Nombres de las cuentas cuyas listas no se pudieron leer de Alegra (se muestran solo las de sus clientes). */
  cuentasConAviso: string[]
}

/**
 * Listas de precio de Alegra que se pueden enlazar, por cuenta: TODAS las que existen en Alegra
 * (GET /price-lists de cada cuenta, con caché; ver listas-alegra-selector.ts), con la cantidad de
 * contactos activos del espejo (`alegra_contacts.price_list_id`) que la tienen, y los enlaces ya
 * cargados aunque la lista ya no exista. Si Alegra falla en una cuenta, esa cuenta cae a las listas
 * derivadas de sus contactos y se avisa.
 */
export async function listarListasAlegra(tenantId: string): Promise<ListasAlegraResultado> {
  const db = getDb()
  const filas = await db
    .select({
      alegraAccount: alegraContacts.alegraAccount,
      alegraPriceListId: sql<string>`${alegraContacts.priceListId}`,
      nombre: sql<string | null>`max(${alegraContacts.priceListName})`,
      contactos: sql<number>`count(*)::int`,
    })
    .from(alegraContacts)
    .where(and(eq(alegraContacts.tenantId, tenantId), eq(alegraContacts.status, "active"), sql`${alegraContacts.priceListId} IS NOT NULL`))
    .groupBy(alegraContacts.alegraAccount, alegraContacts.priceListId)
  const enlaces = await db
    .select({ alegraAccount: listaPrecioAlegraMapeo.alegraAccount, alegraPriceListId: listaPrecioAlegraMapeo.alegraPriceListId })
    .from(listaPrecioAlegraMapeo)
    .where(eq(listaPrecioAlegraMapeo.tenantId, tenantId))
  const cuentas = await db
    .select({ slug: alegraCuentas.slug, nombre: alegraCuentas.nombre })
    .from(alegraCuentas)
    .where(eq(alegraCuentas.tenantId, tenantId))
  const nombresCuenta = new Map(cuentas.map((c) => [c.slug, c.nombre]))

  const base = await getTenantByIdFromDb(tenantId)
  const api = base ? await leerListasDeAlegra(base) : { porCuenta: {}, cuentasFallidas: [] as string[] }

  const listas = combinarListasAlegra({
    derivadas: filas.map((f) => ({
      alegraAccount: f.alegraAccount,
      alegraPriceListId: f.alegraPriceListId,
      nombre: f.nombre,
      contactos: Number(f.contactos),
    })),
    enlaces,
    api: api.porCuenta,
    nombresCuenta,
  })
  const nombreDe = (slug: string) => nombresCuenta.get(slug) ?? (slug === "principal" ? "Cuenta principal" : slug)
  return { listas, cuentasConAviso: api.cuentasFallidas.map(nombreDe).sort() }
}

export interface HistorialDto {
  id: string
  tipo: string
  objeto: string
  usuario: string
  creadoAt: string
  antes: Record<string, unknown> | null
  despues: Record<string, unknown> | null
  resumen: Record<string, unknown> | null
  revertidoDe: string | null
  versionConfig: number
  /** true si ya hay una reversión de esta entrada. */
  revertido: boolean
}

export async function listarHistorial(
  tenantId: string,
  opts: { start: number; limit: number },
): Promise<{ items: HistorialDto[]; total: number }> {
  const db = getDb()
  const [{ total }] = (await db.execute(
    sql`SELECT count(*)::int AS total FROM precios_online_cambios WHERE tenant_id = ${tenantId}`,
  )) as unknown as { total: number }[]
  const rows = await db
    .select()
    .from(preciosOnlineCambios)
    .where(eq(preciosOnlineCambios.tenantId, tenantId))
    .orderBy(desc(preciosOnlineCambios.creadoAt), desc(preciosOnlineCambios.id))
    .limit(opts.limit)
    .offset(opts.start)
  const ids = rows.map((r) => r.id)
  const revertidas = new Set<string>()
  if (ids.length) {
    const rs = (await db.execute(sql`
      SELECT revertido_de FROM precios_online_cambios
      WHERE tenant_id = ${tenantId} AND revertido_de = ANY (${idsUuidSql(ids)})
    `)) as unknown as { revertido_de: string }[]
    for (const r of rs) revertidas.add(r.revertido_de)
  }
  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      objeto: r.objeto,
      usuario: r.usuario,
      creadoAt: r.creadoAt.toISOString(),
      antes: r.antes,
      despues: r.despues,
      resumen: r.resumen,
      revertidoDe: r.revertidoDe,
      versionConfig: r.versionConfig,
      revertido: revertidas.has(r.id),
    })),
  }
}

export function idsUuidSql(ids: string[]) {
  return sql`ARRAY[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::uuid[]`
}
