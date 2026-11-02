import { sql, type SQL } from "drizzle-orm"
import { getDb } from "@/db"
import { patronBusqueda } from "@/lib/clientes-tienda-repo"

// "Intentos de pago" del admin: cada intento de cobro en línea (Mercado Pago, Payway) que registra el
// Shop en `shop.pago_intentos`, con la causa de la falla, más el resumen por proveedor y cuenta.
//
// Reglas de este archivo:
//  - `tenantId` es SIEMPRE el primer argumento y se filtra en intentos, pedidos y pagos.
//  - SQL crudo parametrizado. Sólo lectura: el Shop escribe los intentos.
//  - La clasificación de la causa vive en UN solo lugar, `CLASE_INTENTO_SQL`: el resumen y la lista
//    la comparten, y la UI sólo traduce clase → etiqueta.
//  - `error_proveedor` (detalle saneado del proveedor, 0041 del Shop) sólo lo ve admin+: todas las
//    rutas que llegan acá exigen admin+.

export const INTENTOS_DEFAULT_LIMIT = 25
export const INTENTOS_MAX_LIMIT = 50
/** Largo máximo de la búsqueda (la API responde 400 por encima). */
export const INTENTOS_Q_MAX = 100

export const CLASES_INTENTO = [
  "aprobado",
  "pendiente",
  "rechazo_banco",
  "error_proveedor",
  "credenciales",
  "reserva_abandonada",
] as const
export type ClaseIntento = (typeof CLASES_INTENTO)[number]

/** Las cuatro causas de falla (entran en la tasa de fallo). */
export const CLASES_FALLO = ["rechazo_banco", "error_proveedor", "credenciales", "reserva_abandonada"] as const

/** "fallos" = las cuatro causas de falla juntas. */
export const FILTROS_CLASE = ["todas", "aprobado", "fallos", ...CLASES_INTENTO.filter((c) => c !== "aprobado")] as const
export type FiltroClase = (typeof FILTROS_CLASE)[number]

export const FILTROS_PROVEEDOR = ["todos", "mercadopago", "payway", "transferencia", "efectivo"] as const
export type FiltroProveedor = (typeof FILTROS_PROVEEDOR)[number]

export const DIAS_VENTANA = [1, 7, 30] as const
export const DIAS_VENTANA_DEFAULT = 7
export type DiasVentana = (typeof DIAS_VENTANA)[number]

/** Slug de cuenta (sucursal): minúsculas, dígitos, guion y guion bajo. */
export const CUENTA_RE = /^[a-z0-9_-]{1,40}$/

/**
 * Clase de un intento (alias `pi` = shop.pago_intentos). Precedencia: pagado > credenciales >
 * error del proveedor > reserva abandonada > rechazo del banco > en curso.
 *
 * Clave: un 5xx/timeout deja el intento 'pendiente' con `error_status` y SIN referencia; después
 * `descartarReserva` lo pasa a 'fallido'/'reserva_abandonada' sin tocar `error_*`. Eso sigue siendo
 * un error del proveedor, no una reserva abandonada. Un intento con referencia (Payway la anota
 * antes de cobrar) y 5xx sigue abierto: es 'pendiente' hasta que la consulta lo resuelva.
 */
export const CLASE_INTENTO_SQL_TEXTO = `CASE
  WHEN pi.estado = 'pagado' THEN 'aprobado'
  WHEN pi.detalle LIKE 'credenciales_rechazadas:%' THEN 'credenciales'
  WHEN pi.error_status IS NOT NULL AND pi.referencia IS NULL AND pi.estado IN ('pendiente', 'fallido') THEN 'error_proveedor'
  WHEN pi.estado = 'fallido' AND pi.detalle LIKE 'error_proveedor:%' THEN 'error_proveedor'
  WHEN pi.estado = 'fallido' AND pi.detalle = 'reserva_abandonada' THEN 'reserva_abandonada'
  WHEN pi.estado = 'fallido' THEN 'rechazo_banco'
  ELSE 'pendiente'
END`
const CLASE_INTENTO_SQL = sql.raw(CLASE_INTENTO_SQL_TEXTO)

/** Cuenta efectiva de un intento: la de cobro, si no la prevista, si no "sin_cuenta". */
const CUENTA_SQL = sql.raw(`coalesce(pi.cuenta, pi.cuenta_prevista, 'sin_cuenta')`)

export interface ListarIntentosFiltro {
  dias?: number
  proveedor?: FiltroProveedor
  cuenta?: string
  clase?: FiltroClase
  q?: string
  start?: number
  /** Default INTENTOS_DEFAULT_LIMIT, máximo INTENTOS_MAX_LIMIT. */
  limit?: number
}

export interface IntentoListaDto {
  /** 'intento' = fila de pago_intentos; 'offline' = transferencia/efectivo sin intento. */
  fuente: "intento" | "offline"
  id: string
  pedidoId: string
  pedidoNumero: number
  pedidoNumeroTexto: string
  clienteNombre: string | null
  clienteEmail: string | null
  /** 'mercadopago' | 'payway'; en filas offline, el método ('transferencia' | 'efectivo'). */
  proveedor: string
  cuenta: string | null
  cuentaPrevista: string | null
  clase: ClaseIntento | "offline"
  /** 'pendiente' | 'pagado' | 'fallido'. En filas offline: 'pagado' = acreditada. */
  estado: string
  detalle: string | null
  errorProveedor: string | null
  errorStatus: number | null
  medio: string | null
  cuotas: number | null
  monto: number | null
  fecha: string
}

export interface IntentoPedidoDto {
  id: string
  proveedor: string
  cuenta: string | null
  cuentaPrevista: string | null
  clase: ClaseIntento
  estado: string
  detalle: string | null
  errorProveedor: string | null
  errorStatus: number | null
  medio: string | null
  cuotas: number | null
  monto: number | null
  fecha: string
}

export interface ResumenCuentaDto {
  proveedor: string
  cuenta: string
  total: number
  aprobados: number
  rechazoBanco: number
  errorProveedor: number
  credenciales: number
  reservaAbandonada: number
  pendientes: number
  /** fallos / (fallos + aprobados). null = sin intentos resueltos (nunca NaN). */
  tasaFallo: number | null
}

export function formatearNumeroPedido(numero: number): string {
  return `PED-${String(numero).padStart(8, "0")}`
}

function iso(v: Date | string): string {
  return (v instanceof Date ? v : new Date(v)).toISOString()
}

function numONull(v: string | number | null): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const esClase = (v: unknown): v is ClaseIntento => (CLASES_INTENTO as readonly unknown[]).includes(v)

/**
 * Pliega las filas del GROUP BY (proveedor, cuenta, clase, n) en una fila por proveedor × cuenta.
 * Pura: la tasa de fallo es fallos / (fallos + aprobados); los pendientes quedan afuera.
 */
export function foldResumen(
  filas: { proveedor: string; cuenta: string; clase: string; n: number }[],
): ResumenCuentaDto[] {
  const porClave = new Map<string, ResumenCuentaDto>()
  for (const f of filas) {
    const clave = `${f.proveedor}\u0000${f.cuenta}`
    let r = porClave.get(clave)
    if (!r) {
      r = {
        proveedor: f.proveedor,
        cuenta: f.cuenta,
        total: 0,
        aprobados: 0,
        rechazoBanco: 0,
        errorProveedor: 0,
        credenciales: 0,
        reservaAbandonada: 0,
        pendientes: 0,
        tasaFallo: null,
      }
      porClave.set(clave, r)
    }
    const n = Number(f.n) || 0
    r.total += n
    if (f.clase === "aprobado") r.aprobados += n
    else if (f.clase === "rechazo_banco") r.rechazoBanco += n
    else if (f.clase === "error_proveedor") r.errorProveedor += n
    else if (f.clase === "credenciales") r.credenciales += n
    else if (f.clase === "reserva_abandonada") r.reservaAbandonada += n
    else r.pendientes += n
  }
  const out = [...porClave.values()]
  for (const r of out) {
    const fallos = r.rechazoBanco + r.errorProveedor + r.credenciales + r.reservaAbandonada
    const resueltos = fallos + r.aprobados
    r.tasaFallo = resueltos > 0 ? fallos / resueltos : null
  }
  return out.sort((a, b) => a.proveedor.localeCompare(b.proveedor) || a.cuenta.localeCompare(b.cuenta))
}

function diasValidos(dias: number | undefined): number {
  return (DIAS_VENTANA as readonly number[]).includes(dias ?? NaN) ? (dias as number) : DIAS_VENTANA_DEFAULT
}

interface FilaLista {
  fuente: "intento" | "offline"
  id: string
  pedido_id: string
  numero: number
  contacto_nombre: string | null
  cliente_email: string | null
  proveedor: string
  cuenta: string | null
  cuenta_prevista: string | null
  clase: string
  estado: string
  detalle: string | null
  error_proveedor: string | null
  error_status: number | null
  medio: string | null
  cuotas: number | null
  monto: string | number | null
  fecha: Date | string
}

function aDto(f: FilaLista): IntentoListaDto {
  return {
    fuente: f.fuente,
    id: f.id,
    pedidoId: f.pedido_id,
    pedidoNumero: Number(f.numero),
    pedidoNumeroTexto: formatearNumeroPedido(Number(f.numero)),
    clienteNombre: f.contacto_nombre,
    clienteEmail: f.cliente_email,
    proveedor: f.proveedor,
    cuenta: f.cuenta,
    cuentaPrevista: f.cuenta_prevista,
    clase: f.fuente === "offline" ? "offline" : esClase(f.clase) ? f.clase : "pendiente",
    estado: f.estado,
    detalle: f.detalle,
    errorProveedor: f.error_proveedor,
    errorStatus: f.error_status === null ? null : Number(f.error_status),
    medio: f.medio,
    cuotas: f.cuotas === null ? null : Number(f.cuotas),
    monto: numONull(f.monto),
    fecha: iso(f.fecha),
  }
}

export async function listarIntentos(
  tenantId: string,
  f: ListarIntentosFiltro = {},
): Promise<{ items: IntentoListaDto[]; total: number }> {
  const start = Math.max(0, Math.trunc(f.start ?? 0) || 0)
  const limit = Math.min(
    INTENTOS_MAX_LIMIT,
    Math.max(1, Math.trunc(f.limit ?? INTENTOS_DEFAULT_LIMIT) || INTENTOS_DEFAULT_LIMIT),
  )
  const dias = diasValidos(f.dias)
  const q = (f.q ?? "").trim().slice(0, INTENTOS_Q_MAX)

  // Filas de intentos (con su pedido, mismo tenant en ambos lados) + filas "sin intento" de los
  // pedidos por transferencia o efectivo. Columnas homogéneas para el UNION ALL.
  const base = sql`
    WITH filas AS (
      SELECT 'intento'::text AS fuente, pi.id::text AS id, o.id::text AS pedido_id, o.numero,
             o.contacto_nombre, o.cliente_email,
             pi.proveedor, pi.cuenta, pi.cuenta_prevista,
             ${CLASE_INTENTO_SQL}::text AS clase, pi.estado, pi.detalle,
             pi.error_proveedor, pi.error_status, pi.medio, pi.cuotas,
             coalesce(pi.total_pagado, pi.total_esperado) AS monto,
             pi.created_at AS fecha,
             ${CUENTA_SQL}::text AS cuenta_efectiva
      FROM shop.pago_intentos pi
      JOIN shop.orders o ON o.id = pi.order_id AND o.tenant_id = pi.tenant_id
      WHERE pi.tenant_id = ${tenantId}
        AND pi.created_at >= now() - make_interval(days => ${dias}::int)
      UNION ALL
      SELECT 'offline'::text, o.id::text, o.id::text, o.numero,
             o.contacto_nombre, o.cliente_email,
             o.pago_metodo, NULL::text, NULL::text,
             'offline'::text,
             CASE WHEN o.pago_estado = 'pagado'
                    OR EXISTS (SELECT 1 FROM shop.order_payments op
                               WHERE op.order_id = o.id AND op.tenant_id = o.tenant_id AND op.anulado_en IS NULL)
                  THEN 'pagado' ELSE 'pendiente' END,
             NULL::text, NULL::text, NULL::integer, NULL::text, NULL::integer,
             o.total,
             o.created_at,
             NULL::text
      FROM shop.orders o
      WHERE o.tenant_id = ${tenantId}
        AND o.pago_metodo IN ('transferencia', 'efectivo')
        AND o.created_at >= now() - make_interval(days => ${dias}::int)
        AND NOT EXISTS (SELECT 1 FROM shop.pago_intentos x WHERE x.order_id = o.id AND x.tenant_id = o.tenant_id)
    )`

  const condiciones: SQL[] = []
  if (f.proveedor && f.proveedor !== "todos") condiciones.push(sql`proveedor = ${f.proveedor}`)
  if (f.cuenta) condiciones.push(sql`fuente = 'intento' AND cuenta_efectiva = ${f.cuenta}`)
  if (f.clase && f.clase !== "todas") {
    if (f.clase === "fallos") {
      condiciones.push(sql`clase IN (${sql.join(CLASES_FALLO.map((c) => sql`${c}`), sql`, `)})`)
    } else {
      condiciones.push(sql`clase = ${f.clase}`)
    }
  }
  if (q) {
    const numero = Number(q.replace(/^PED-/i, ""))
    const partes: SQL[] = [
      sql`contacto_nombre ILIKE ${patronBusqueda(q)}`,
      sql`cliente_email ILIKE ${patronBusqueda(q)}`,
    ]
    if (/^(PED-)?\d{1,9}$/i.test(q) && Number.isInteger(numero)) partes.push(sql`numero = ${numero}`)
    condiciones.push(sql`(${sql.join(partes, sql` OR `)})`)
  }
  const where = condiciones.length ? sql`WHERE ${sql.join(condiciones, sql` AND `)}` : sql``

  const [filas, conteo] = await Promise.all([
    getDb().execute(sql`
      ${base}
      SELECT * FROM filas ${where}
      ORDER BY fecha DESC, id
      LIMIT ${limit} OFFSET ${start}
    `),
    getDb().execute(sql`${base} SELECT count(*)::int AS total FROM filas ${where}`),
  ])

  return {
    items: (filas as unknown as FilaLista[]).map(aDto),
    total: Number((conteo as unknown as { total: number }[])[0]?.total ?? 0),
  }
}

export interface ResumenIntentosDto {
  cuentas: ResumenCuentaDto[]
  /** Pedidos por transferencia/efectivo de la ventana: informativo, fuera de la tasa de fallo. */
  offline: { transferencia: number; efectivo: number }
  /** Inicio de la ventana (ISO). */
  desde: string
}

export async function resumenIntentos(tenantId: string, { dias }: { dias?: number } = {}): Promise<ResumenIntentosDto> {
  const d = diasValidos(dias)
  const [filas, offline, [reloj]] = await Promise.all([
    getDb().execute(sql`
      SELECT pi.proveedor, ${CUENTA_SQL}::text AS cuenta, ${CLASE_INTENTO_SQL}::text AS clase, count(*)::int AS n
      FROM shop.pago_intentos pi
      WHERE pi.tenant_id = ${tenantId}
        AND pi.created_at >= now() - make_interval(days => ${d}::int)
      GROUP BY 1, 2, 3
    `),
    getDb().execute(sql`
      SELECT o.pago_metodo AS metodo, count(*)::int AS n
      FROM shop.orders o
      WHERE o.tenant_id = ${tenantId}
        AND o.pago_metodo IN ('transferencia', 'efectivo')
        AND o.created_at >= now() - make_interval(days => ${d}::int)
      GROUP BY 1
    `),
    getDb().execute(sql`SELECT now() - make_interval(days => ${d}::int) AS desde`) as unknown as Promise<
      { desde: Date | string }[]
    >,
  ])
  const porMetodo = new Map((offline as unknown as { metodo: string; n: number }[]).map((r) => [r.metodo, Number(r.n)]))
  return {
    cuentas: foldResumen(filas as unknown as { proveedor: string; cuenta: string; clase: string; n: number }[]),
    offline: { transferencia: porMetodo.get("transferencia") ?? 0, efectivo: porMetodo.get("efectivo") ?? 0 },
    desde: iso(reloj.desde),
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Intentos de un pedido del tenant, del más nuevo al más viejo. Id inválido o ajeno => []. */
export async function intentosDelPedido(tenantId: string, orderId: string): Promise<IntentoPedidoDto[]> {
  if (!UUID_RE.test(orderId)) return []
  const filas = (await getDb().execute(sql`
    SELECT pi.id::text AS id, pi.proveedor, pi.cuenta, pi.cuenta_prevista,
           ${CLASE_INTENTO_SQL}::text AS clase, pi.estado, pi.detalle,
           pi.error_proveedor, pi.error_status, pi.medio, pi.cuotas,
           coalesce(pi.total_pagado, pi.total_esperado) AS monto, pi.created_at AS fecha
    FROM shop.pago_intentos pi
    WHERE pi.tenant_id = ${tenantId} AND pi.order_id = ${orderId}
    ORDER BY pi.created_at DESC, pi.id
  `)) as unknown as Omit<FilaLista, "fuente" | "pedido_id" | "numero" | "contacto_nombre" | "cliente_email">[]
  return filas.map((f) => ({
    id: f.id,
    proveedor: f.proveedor,
    cuenta: f.cuenta,
    cuentaPrevista: f.cuenta_prevista,
    clase: esClase(f.clase) ? f.clase : "pendiente",
    estado: f.estado,
    detalle: f.detalle,
    errorProveedor: f.error_proveedor,
    errorStatus: f.error_status === null ? null : Number(f.error_status),
    medio: f.medio,
    cuotas: f.cuotas === null ? null : Number(f.cuotas),
    monto: numONull(f.monto),
    fecha: iso(f.fecha),
  }))
}
