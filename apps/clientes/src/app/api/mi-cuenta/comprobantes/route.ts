import { contactoPorId } from "@/lib/contactos-espejo";
import {
  COMPROBANTES_NO_DISPONIBLE,
  FORMULARIO_INVALIDO,
  HISTORIAL_CAIDO,
  INIT_CAIDO,
  LIMITE_DIARIO,
  LIMITE_HORARIO,
} from "@/lib/comprobantes/mensajes";
import { claves } from "@/lib/comprobantes/claves";
import { contarRecientes, crearSubiendo, listarDelCliente } from "@/lib/comprobantes/repo";
import {
  RECEIPTS_DAILY_LIMIT,
  RECEIPTS_HOURLY_LIMIT,
  UPLOAD_URL_TTL_SECONDS,
  parseInitBody,
} from "@/lib/comprobantes/validacion";
import { startSeguro } from "@/lib/cuenta-corriente/filtros";
import { jsonNoStore, requerirCliente } from "@/lib/cuenta-corriente/guard";
import { getComprobantesR2 } from "@/lib/r2";
import { permitir } from "@/lib/rate-limit";
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
 * `GET ?start` → `{ comprobantes, total }`: sólo `pending`/`loaded` propios.
 *
 * El cliente (código, razón social, CUIT, email) sale SIEMPRE de la identidad:
 * lo que venga en el body se ignora.
 */
const HORA_MS = 60 * 60 * 1000;

export async function GET(request: Request) {
  const guard = await requerirCliente();
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
  const guard = await requerirCliente();
  if (guard.error) return guard.error;
  const { cliente } = guard;

  const r2 = getComprobantesR2();
  if (!r2) return jsonNoStore({ error: COMPROBANTES_NO_DISPONIBLE }, { status: 503 });

  try {
    const now = new Date();
    const parsed = parseInitBody(await request.json().catch(() => null), now);
    if (!parsed.ok) {
      if (parsed.status === 400)
        return jsonNoStore({ error: FORMULARIO_INVALIDO, fields: parsed.fields }, { status: 400 });
      return jsonNoStore({ error: parsed.error, code: parsed.code }, { status: parsed.status });
    }

    const tenantId = shopTenantId();
    const codigo = cliente.codigocliente;

    // Primero el límite de la hora (barato, en memoria), después el del día (base).
    if (!permitir(`comprobantes:${tenantId}:${codigo}`, RECEIPTS_HOURLY_LIMIT, HORA_MS)) {
      return jsonNoStore({ error: LIMITE_HORARIO, code: "hourly_limit" }, { status: 429 });
    }
    if ((await contarRecientes(tenantId, codigo, now)) >= RECEIPTS_DAILY_LIMIT) {
      return jsonNoStore({ error: LIMITE_DIARIO, code: "daily_limit" }, { status: 429 });
    }

    // Snapshot del cliente para el backoffice: la identidad y, si no trae la
    // razón social (vinculado por la cookie del CRM), el espejo de contactos.
    let razonsocial = cliente.razonsocial?.trim() ?? "";
    let cuit = cliente.cuit?.trim() ?? "";
    let email = cliente.email?.trim() || null;
    if (!razonsocial) {
      const contacto = await contactoPorId(codigo);
      razonsocial = contacto?.nombre ?? "";
      cuit = cuit || contacto?.identificacion || "";
      email = email ?? contacto?.email ?? null;
    }

    const row = await crearSubiendo(
      tenantId,
      {
        codigocliente: codigo,
        razonsocial,
        cuit,
        clientEmail: email,
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

    const upload = await r2.presignPut(claves.tmp(tenantId, row.id), {
      contentType: parsed.value.file.contentType,
      contentLength: parsed.value.file.size,
      ttlSeconds: UPLOAD_URL_TTL_SECONDS,
    });

    return jsonNoStore(
      {
        id: row.id,
        upload: { url: upload.url, method: "PUT", headers: upload.headers, expiresAt: upload.expiresAt.toISOString() },
      },
      { status: 201 },
    );
  } catch (err) {
    // Sin datos del cliente ni la URL firmada en el log.
    console.error("mi-cuenta/comprobantes: init falló", err instanceof Error ? err.name : "");
    return jsonNoStore({ error: INIT_CAIDO }, { status: 500 });
  }
}
