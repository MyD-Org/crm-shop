/**
 * Lectura de los medios de pago del CRM (`public.medios_pago_shop`). SOLO servidor.
 *
 * La tabla la crea una migración del CRM que puede no estar aplicada todavía: toda lectura
 * TOLERA que no exista (o que el permiso no esté concedido) y devuelve `[]`, que el checkout
 * interpreta como "sin medios cargados": el pago sale "a_coordinar". Una lista vacía
 * (tabla vacía) se trata igual, a propósito: no cargar medios todavía no puede
 * dejar el paso Pago sin salida.
 *
 * Trae TODAS las filas del tenant (activas o no): el filtro por activo y por modalidad es puro
 * (`mediosParaModalidad`), y el nombre de un medio ya desactivado sigue haciendo falta para mostrar
 * pedidos viejos.
 */
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { crmListaPrecioCondiciones, crmMediosPagoShop } from "@/db/crm";
import { shopTenantId } from "./tenant";
import type { CondicionCuotas } from "./cuotas-sin-interes";
import type { AudienciaMedio, MedioPago } from "./medios-pago";
import { leerChipsMedio } from "./medios-pago-chips";
import { leerOpcionesCobro, type OpcionCobro } from "./pagos/opciones-cobro";
import { leerMarcas } from "./pagos/marcas";

/** Lo mínimo que hace falta de una conexión o transacción de drizzle. */
type Ejecutor = Pick<ReturnType<typeof getDb>, "select">;

/** ¿El error es Postgres 42P01 (tabla inexistente) o 42501 (sin permiso)? Mira también `cause`. */
function esTablaAusenteOSinPermiso(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    const code = (e as { code?: unknown }).code;
    if (code === "42P01" || code === "42501") return true;
  }
  return false;
}

/** ¿El error es Postgres 42703 (columna inexistente)? Mira también `cause`. */
function esColumnaAusente(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: unknown }).code === "42703") return true;
  }
  return false;
}

/**
 * Formas de pago del cobro en línea de cada medio (migración 0073 del CRM): slug -> opciones. Va en
 * una consulta APARTE de la de medios para que un desfasaje de migración degrade (sin dato = todas
 * las del procesador, como antes de la columna) en vez de dejar todos los medios "a coordinar".
 * Columna ausente => mapa vacío; otro error tira (lo maneja quien lee los medios).
 */
async function opcionesCobroDeLosMedios(db: Ejecutor): Promise<Map<string, OpcionCobro[]>> {
  try {
    const filas = await db
      .select({ slug: crmMediosPagoShop.slug, opcionesCobro: crmMediosPagoShop.opcionesCobro })
      .from(crmMediosPagoShop)
      .where(eq(crmMediosPagoShop.tenantId, shopTenantId()));
    const porMedio = new Map<string, OpcionCobro[]>();
    for (const f of filas) {
      const opciones = leerOpcionesCobro(f.opcionesCobro);
      if (opciones !== null) porMedio.set(f.slug, opciones);
    }
    return porMedio;
  } catch (err) {
    if (!esColumnaAusente(err)) throw err;
    console.warn("[medios-pago] la migración 0073 del CRM no está aplicada; los medios ofrecen todas sus formas de pago.");
    return new Map();
  }
}

/**
 * Tarjetas de cada condición de cuotas (migración 0074 del CRM): "slug:cuotas" -> marcas. Consulta
 * APARTE, como las opciones de cobro: columna ausente => mapa vacío (todas las tarjetas, como antes
 * de la columna); otro error tira. Una restricción que queda vacía tras descartar las marcas que el
 * Shop no conoce vuelve inaccesible la condición (`"inaccesible"`).
 */
async function marcasDeLasCondiciones(db: Ejecutor): Promise<Map<string, string[] | null | "inaccesible">> {
  try {
    const filas = await db
      .select({
        medioSlug: crmListaPrecioCondiciones.medioSlug,
        cuotas: crmListaPrecioCondiciones.cuotas,
        marcas: crmListaPrecioCondiciones.marcas,
      })
      .from(crmListaPrecioCondiciones)
      .where(and(eq(crmListaPrecioCondiciones.tenantId, shopTenantId()), isNotNull(crmListaPrecioCondiciones.cuotas)));
    const porCondicion = new Map<string, string[] | null | "inaccesible">();
    for (const f of filas) {
      const { marcas, inaccesible } = leerMarcas(f.marcas);
      porCondicion.set(`${f.medioSlug}:${f.cuotas}`, inaccesible ? "inaccesible" : marcas);
    }
    return porCondicion;
  } catch (err) {
    if (!esColumnaAusente(err)) throw err;
    console.warn("[medios-pago] la migración 0074 del CRM no está aplicada; las cuotas valen para todas las tarjetas.");
    return new Map();
  }
}

/** Lo que enlazan las condiciones del CRM para un medio: la lista del pago único y las de cuotas. */
interface CondicionesDelMedio {
  /** uuid de la lista del pago único (`cuotas` NULL); null = rige la de referencia. */
  idListaPrecios: string | null;
  /** Condiciones de N >= 2 cuotas sin interés, ascendentes. */
  condicionesCuotas: CondicionCuotas[];
}

/**
 * Condiciones (medio, cuotas) -> lista de precio ONLINE, de todos los medios: slug -> lo que enlazan.
 * El uuid de la lista es el mismo que trae `idPriceList` en los precios de la vista del catálogo, así
 * que el resto del Shop resuelve "precio con este medio" como siempre (`precioDeLista`). `cuotas`
 * NULL es el pago único; N >= 2 son las cuotas sin interés (rebanada D).
 *
 * Tolera que la migración 0065 del CRM no esté aplicada (tabla inexistente o sin permiso): ningún
 * medio tiene lista y rige la de referencia, que es lo correcto antes de enlazar nada.
 */
async function condicionesDeLosMedios(db: Ejecutor): Promise<Map<string, CondicionesDelMedio>> {
  const porMedio = new Map<string, CondicionesDelMedio>();
  try {
    const filas = await db
      .select({
        medioSlug: crmListaPrecioCondiciones.medioSlug,
        listaId: crmListaPrecioCondiciones.listaId,
        cuotas: crmListaPrecioCondiciones.cuotas,
        montoMinimo: crmListaPrecioCondiciones.montoMinimo,
      })
      .from(crmListaPrecioCondiciones)
      .where(eq(crmListaPrecioCondiciones.tenantId, shopTenantId()));
    for (const f of filas) {
      const m = porMedio.get(f.medioSlug) ?? { idListaPrecios: null, condicionesCuotas: [] };
      if (f.cuotas === null) m.idListaPrecios = f.listaId;
      else {
        // numeric llega como texto; null = sin mínimo (columna de la migración 0066 del CRM).
        const minimo = f.montoMinimo == null ? null : Number(f.montoMinimo);
        m.condicionesCuotas.push({
          cuotas: f.cuotas,
          idListaPrecios: f.listaId,
          montoMinimo: minimo !== null && Number.isFinite(minimo) ? minimo : null,
        });
      }
      porMedio.set(f.medioSlug, m);
    }
    if (filas.some((f) => f.cuotas !== null)) await aplicarMarcas(db, porMedio);
    for (const m of porMedio.values()) m.condicionesCuotas.sort((a, b) => a.cuotas - b.cuotas);
    return porMedio;
  } catch (err) {
    if (!esTablaAusenteOSinPermiso(err)) throw err;
    console.warn("[medios-pago] la migración 0065 del CRM no está aplicada; los medios usan la lista de referencia.");
    return new Map();
  }
}

/** Suma las marcas a cada condición de cuotas; las inaccesibles se quitan, con aviso. */
async function aplicarMarcas(db: Ejecutor, porMedio: Map<string, CondicionesDelMedio>): Promise<void> {
  const marcas = await marcasDeLasCondiciones(db);
  for (const [slug, m] of porMedio) {
    m.condicionesCuotas = m.condicionesCuotas.flatMap((c) => {
      const v = marcas.get(`${slug}:${c.cuotas}`) ?? null;
      if (v !== "inaccesible") return [{ ...c, marcas: v }];
      console.warn(`[medios-pago] ${slug}, ${c.cuotas} cuotas: ninguna de sus tarjetas es conocida por la tienda; no se ofrece.`);
      return [];
    });
  }
}

/**
 * Lectura que TIRA si la tabla de medios no existe. La usa la lectura cacheada (que elige su perfil
 * de caché). `idListaPrecios` y `condicionesCuotas` salen de las condiciones de la migración 0065
 * (uuid de la lista online enlazada; `null` = rige la lista de referencia).
 */
export async function leerMediosPago(db: Ejecutor = getDb()): Promise<MedioPago[]> {
  const filas = await db
    .select({
      slug: crmMediosPagoShop.slug,
      nombre: crmMediosPagoShop.nombre,
      instrucciones: crmMediosPagoShop.instrucciones,
      activo: crmMediosPagoShop.activo,
      aplicaRetiro: crmMediosPagoShop.aplicaRetiro,
      aplicaEnvio: crmMediosPagoShop.aplicaEnvio,
      cobroOnline: crmMediosPagoShop.cobroOnline,
      orden: crmMediosPagoShop.orden,
      destacarEnCatalogo: crmMediosPagoShop.destacarEnCatalogo,
      mostrarEnFicha: crmMediosPagoShop.mostrarEnFicha,
      audiencia: crmMediosPagoShop.audiencia,
      chips: crmMediosPagoShop.chips,
    })
    .from(crmMediosPagoShop)
    .where(eq(crmMediosPagoShop.tenantId, shopTenantId()))
    .orderBy(asc(crmMediosPagoShop.orden), asc(crmMediosPagoShop.nombre));
  const condiciones = await condicionesDeLosMedios(db);
  const opciones = await opcionesCobroDeLosMedios(db);
  return filas.map((f) => ({
    ...f,
    // Lo desconocido se trata como público: sólo el valor exacto restringe el medio.
    audiencia: (f.audiencia === "cuenta_corriente" ? "cuenta_corriente" : "publico") as AudienciaMedio,
    // Etiquetas del checkout: tolerante (lo inválido o ausente es []).
    chips: leerChipsMedio(f.chips),
    idListaPrecios: condiciones.get(f.slug)?.idListaPrecios ?? null,
    condicionesCuotas: condiciones.get(f.slug)?.condicionesCuotas ?? [],
    // Sin dato (columna ausente) el campo no va: rigen las formas de pago del procesador.
    ...(opciones.has(f.slug) ? { opcionesCobro: opciones.get(f.slug) } : {}),
  }));
}

/** Lo mismo, pero con la tabla ausente (o cualquier falla) devuelve `[]`: el pago sale "a_coordinar". */
export async function leerMediosPagoTolerante(db: Ejecutor = getDb()): Promise<MedioPago[]> {
  try {
    return await leerMediosPago(db);
  } catch (err) {
    console.warn(
      "[medios-pago] no se pudieron leer los medios de pago del CRM; el pago sale a_coordinar:",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
