import { contactoPorId } from "@/lib/contactos-espejo";
import {
  COMPROBANTES_NO_DISPONIBLE,
  FORMULARIO_INVALIDO,
  HISTORIAL_CAIDO,
  INIT_CAIDO,
  LIMITE_DIARIO,
  LIMITE_HORARIO,
  LIMITE_PEDIDO,
  PEDIDO_NO_ENCONTRADO,
  PEDIDO_NO_INFORMABLE,
} from "@/lib/comprobantes/mensajes";
import { claves, esUuid } from "@/lib/comprobantes/claves";
import {
  MAX_COMPROBANTES_POR_PEDIDO,
  datosClienteDelPedido,
  motivoNoInformable,
} from "@/lib/comprobantes/pedido";
import { contarDelPedido, contarRecientes, crearSubiendo, listarDelCliente } from "@/lib/comprobantes/repo";
import {
  RECEIPTS_DAILY_LIMIT,
  RECEIPTS_HOURLY_LIMIT,
  UPLOAD_URL_TTL_SECONDS,
  parseInitBody,
} from "@/lib/comprobantes/validacion";
import { startSeguro } from "@/lib/cuenta-corriente/filtros";
import { jsonNoStore, requerirComprador, requerirCuentaCorriente } from "@/lib/cuenta-corriente/guard";
import { getPedidoParaComprobante } from "@/lib/pedidos";
import { getComprobantesR2 } from "@/lib/r2";
import { permitirAsync } from "@/lib/rate-limit";
import { shopTenantId } from "@/lib/tenant";

/**
 * Informar pago (CMP-1/2/5) y "Mis comprobantes" (CMP-4) de Mi cuenta → Pagos.
 * Portado de apps/admin/src/app/api/portal/comprobantes/route.ts.
 *
 * `POST` NO recibe bytes: valida el body, crea la fila en `uploading` y
 * devuelve una URL PUT prefirmada para que el navegador suba directo a R2.
 * Orden: guard → storage → validación → límite por hora (memoria) → tope
 * diario (base) → INSERT → presign. Sin limpieza de huérfanos: el Shop no
 * tiene DELETE (la hace el listado del backoffice del CRM).
 *
 * Con `pedidoId` en el body (comprobante de la transferencia de un pedido) puede informar
 * CUALQUIER comprador logueado, con o sin cuenta corriente: el pedido tiene que ser suyo, de
 * transferencia y con el pago pendiente; el medio se fija a `transferencia`; tope de
 * `MAX_COMPROBANTES_POR_PEDIDO` por pedido. Sin `pedidoId` sigue siendo sólo de cuenta corriente.
 *
 * `GET ?start` → `{ comprobantes, total }`: sólo `pending`/`loaded` propios.
 *
 * El cliente (código, razón social, CUIT, email) sale SIEMPRE de la identidad:
 * lo que venga en el body se ignora.
 */
const HORA_MS = 60 * 60 * 1000;

export async function GET(request: Request) {
  const guard = await requerirCuentaCorriente();
  if (guard.error) return guard.error;
  if (!getComprobantesR2()) return jsonNoStore({ error: COMPROBANTES_NO_DISPONIBLE }, { status: 503 });

  const start = startSeguro(new URL(request.url).searchParams.get("start"));
  try {
    return jsonNoStore(await listarDelCliente(shopTenantId(), guard.cliente.codigocliente, start));
  } catch (err) {
    console.error("mi-cuenta/comprobantes: historial falló", err instanceof Error ? err.name : "");
    return jsonNoStore({ error: HISTORIAL_CAIDO }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // El cuerpo se lee una vez: `pedidoId` decide qué guard aplica (ver arriba).
  const raw: unknown = await request.json().catch(() => null);
  const conPedido = typeof raw === "object" && raw !== null && "pedidoId" in raw && raw.pedidoId != null;
  if (conPedido) return informarDePedido(raw as Record<string, unknown>);
  return informarDeCuentaCorriente(raw);
}

/** Datos del cliente para el backoffice: la identidad y, si no trae la razón social (vinculado
 * por la cookie del CRM), el espejo de contactos. */
async function datosDelVinculado(cliente: {
  codigocliente: string;
  razonsocial?: string;
  cuit?: string;
  email?: string;
}) {
  let razonsocial = cliente.razonsocial?.trim() ?? "";
  let cuit = cliente.cuit?.trim() ?? "";
  let email = cliente.email?.trim() || null;
  if (!razonsocial) {
    const contacto = await contactoPorId(cliente.codigocliente);
    razonsocial = contacto?.nombre ?? "";
    cuit = cuit || contacto?.identificacion || "";
    email = email ?? contacto?.email ?? null;
  }
  return { razonsocial, cuit, email };
}

/** Respuesta de un init ya validado: crea la fila y firma la URL PUT. */
async function crearYFirmar(
  r2: NonNullable<ReturnType<typeof getComprobantesR2>>,
  tenantId: string,
  alta: Parameters<typeof crearSubiendo>[1],
  now: Date,
) {
  const row = await crearSubiendo(tenantId, alta, now);
  const upload = await r2.presignPut(claves.tmp(tenantId, row.id), {
    contentType: alta.declaredContentType,
    contentLength: alta.declaredSize,
    ttlSeconds: UPLOAD_URL_TTL_SECONDS,
  });
  return jsonNoStore(
    {
      id: row.id,
      upload: { url: upload.url, method: "PUT", headers: upload.headers, expiresAt: upload.expiresAt.toISOString() },
    },
    { status: 201 },
  );
}

async function informarDePedido(raw: Record<string, unknown>) {
  const guard = await requerirComprador();
  if (guard.error) return guard.error;
  const { comprador } = guard;

  const r2 = getComprobantesR2();
  if (!r2) return jsonNoStore({ error: COMPROBANTES_NO_DISPONIBLE }, { status: 503 });

  try {
    const now = new Date();
    // El medio lo fija el servidor: sólo se informa la transferencia de un pedido.
    const parsed = parseInitBody({ ...raw, method: "transferencia", methodOther: undefined }, now);
    if (!parsed.ok) {
      if (parsed.status === 400)
        return jsonNoStore({ error: FORMULARIO_INVALIDO, fields: parsed.fields }, { status: 400 });
      return jsonNoStore({ error: parsed.error, code: parsed.code }, { status: parsed.status });
    }

    const pedidoId = raw.pedidoId;
    if (typeof pedidoId !== "string" || !esUuid(pedidoId)) {
      return jsonNoStore({ error: PEDIDO_NO_ENCONTRADO }, { status: 404 });
    }
    // El pedido tiene que ser del comprador (su usuario o su cuenta corriente); uno ajeno
    // responde igual que uno inexistente.
    const pedido = await getPedidoParaComprobante(pedidoId, {
      clerkUserId: comprador.clerkUserId,
      clienteCodigo: comprador.cliente?.codigocliente,
    });
    if (!pedido) return jsonNoStore({ error: PEDIDO_NO_ENCONTRADO }, { status: 404 });
    const motivo = motivoNoInformable(pedido);
    if (motivo) return jsonNoStore({ error: PEDIDO_NO_INFORMABLE[motivo] }, { status: 409 });

    const tenantId = shopTenantId();
    const claveHora =
      typeof comprador.duenio === "string"
        ? `comprobantes:${tenantId}:${comprador.duenio}`
        : `comprobantes:${tenantId}:clerk:${comprador.duenio.clerkUserId}`;
    if (!await permitirAsync(claveHora, RECEIPTS_HOURLY_LIMIT, HORA_MS)) {
      return jsonNoStore({ error: LIMITE_HORARIO, code: "hourly_limit" }, { status: 429 });
    }
    if ((await contarRecientes(tenantId, comprador.duenio, now)) >= RECEIPTS_DAILY_LIMIT) {
      return jsonNoStore({ error: LIMITE_DIARIO, code: "daily_limit" }, { status: 429 });
    }
    if ((await contarDelPedido(tenantId, pedido.id)) >= MAX_COMPROBANTES_POR_PEDIDO) {
      return jsonNoStore({ error: LIMITE_PEDIDO, code: "order_limit" }, { status: 429 });
    }

    // Vinculado: sus datos de siempre y su codigocliente. Sin cuenta corriente: el snapshot del
    // pedido, con codigocliente NULL (el CHECK de la base exige pedido y usuario).
    const datos = comprador.cliente ? await datosDelVinculado(comprador.cliente) : datosClienteDelPedido(pedido);

    return await crearYFirmar(
      r2,
      tenantId,
      {
        codigocliente: comprador.cliente?.codigocliente ?? null,
        shopOrderId: pedido.id,
        clerkUserId: comprador.clerkUserId,
        razonsocial: datos.razonsocial,
        cuit: datos.cuit,
        clientEmail: datos.email,
        amount: parsed.value.amount,
        paidOn: parsed.value.paidOn,
        method: "transferencia",
        methodOther: null,
        notes: parsed.value.notes,
        declaredContentType: parsed.value.file.contentType,
        declaredSize: parsed.value.file.size,
      },
      now,
    );
  } catch (err) {
    // Sin datos del cliente ni la URL firmada en el log.
    console.error("mi-cuenta/comprobantes: init por pedido falló", err instanceof Error ? err.name : "");
    return jsonNoStore({ error: INIT_CAIDO }, { status: 500 });
  }
}

async function informarDeCuentaCorriente(raw: unknown) {
  const guard = await requerirCuentaCorriente();
  if (guard.error) return guard.error;
  const { cliente } = guard;

  const r2 = getComprobantesR2();
  if (!r2) return jsonNoStore({ error: COMPROBANTES_NO_DISPONIBLE }, { status: 503 });

  try {
    const now = new Date();
    const parsed = parseInitBody(raw, now);
    if (!parsed.ok) {
      if (parsed.status === 400)
        return jsonNoStore({ error: FORMULARIO_INVALIDO, fields: parsed.fields }, { status: 400 });
      return jsonNoStore({ error: parsed.error, code: parsed.code }, { status: parsed.status });
    }

    const tenantId = shopTenantId();
    const codigo = cliente.codigocliente;

    // Primero el límite de la hora (barato, en memoria), después el del día (base).
    if (!await permitirAsync(`comprobantes:${tenantId}:${codigo}`, RECEIPTS_HOURLY_LIMIT, HORA_MS)) {
      return jsonNoStore({ error: LIMITE_HORARIO, code: "hourly_limit" }, { status: 429 });
    }
    if ((await contarRecientes(tenantId, codigo, now)) >= RECEIPTS_DAILY_LIMIT) {
      return jsonNoStore({ error: LIMITE_DIARIO, code: "daily_limit" }, { status: 429 });
    }

    // Snapshot del cliente para el backoffice.
    const datos = await datosDelVinculado(cliente);

    return await crearYFirmar(
      r2,
      tenantId,
      {
        codigocliente: codigo,
        razonsocial: datos.razonsocial,
        cuit: datos.cuit,
        clientEmail: datos.email,
        amount: parsed.value.amount,
        paidOn: parsed.value.paidOn,
        method: parsed.value.method,
        methodOther: parsed.value.methodOther,
        notes: parsed.value.notes,
        declaredContentType: parsed.value.file.contentType,
        declaredSize: parsed.value.file.size,
      },
      now,
    );
  } catch (err) {
    // Sin datos del cliente ni la URL firmada en el log.
    console.error("mi-cuenta/comprobantes: init falló", err instanceof Error ? err.name : "");
    return jsonNoStore({ error: INIT_CAIDO }, { status: 500 });
  }
}
