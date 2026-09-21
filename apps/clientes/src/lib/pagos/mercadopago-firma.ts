/**
 * Validación de la firma de los webhooks de Mercado Pago. Módulo PURO.
 *
 * Es la puerta del webhook: sin esto, cualquiera que conozca la URL puede
 * mandarnos un POST diciendo "el pedido X está pagado". Por eso vive separado
 * del cliente HTTP y se testea con vectores conocidos, sin red.
 *
 * MP manda `x-signature: ts=<epoch>,v1=<hmac-sha256-hex>`, donde el HMAC se
 * calcula sobre `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` con la clave
 * secreta de la aplicación.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface DatosFirma {
  /** Header `x-signature`. */
  signature: string | null | undefined;
  /** Header `x-request-id`. */
  requestId: string | null | undefined;
  /** Query param `data.id` de la URL de notificación. */
  dataId: string | null | undefined;
  secreto: string;
  /** Inyectable para poder testear la ventana de frescura. */
  ahoraMs?: number;
}

export type ResultadoFirma =
  | { valido: true }
  | { valido: false; motivo: string };

/**
 * Ventana de frescura, deliberadamente generosa.
 *
 * MP reintenta las notificaciones que no respondieron 200, y no está
 * documentado si el reintento se re-firma con un `ts` nuevo. Una ventana corta
 * rechazaría reintentos legítimos, y perder una confirmación de pago es peor
 * que aceptar un replay tardío.
 *
 * Además el replay acá casi no daña: el handler es idempotente y de todos modos
 * vuelve a consultarle el estado a MP, así que reprocesar un evento viejo
 * termina en un no-op. Este chequeo es defensa en profundidad, no la garantía
 * principal.
 */
const VENTANA_MS = 60 * 60 * 1000;

/** Compara en tiempo constante, para no filtrar el HMAC por timing. */
function iguales(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Parsea `ts=123,v1=abc` sin asumir orden ni espacios. */
function parsearSignature(header: string): { ts?: string; v1?: string } {
  const out: { ts?: string; v1?: string } = {};
  for (const parte of header.split(",")) {
    const i = parte.indexOf("=");
    if (i === -1) continue;
    const clave = parte.slice(0, i).trim();
    const valor = parte.slice(i + 1).trim();
    if (clave === "ts") out.ts = valor;
    else if (clave === "v1") out.v1 = valor;
  }
  return out;
}

/**
 * ¿La notificación viene realmente de Mercado Pago?
 *
 * Devuelve el motivo del rechazo para poder loguearlo. Ese motivo NO se le
 * responde a quien llama: decirle a un atacante si falló el timestamp o el
 * HMAC le sirve para ajustar el intento.
 */
export function firmaValida(d: DatosFirma): ResultadoFirma {
  if (!d.secreto) {
    // Falla cerrado: sin secreto configurado no se puede validar nada, y dar
    // por buena una notificación sin validar sería peor que rechazarla.
    return { valido: false, motivo: "falta MP_WEBHOOK_SECRET" };
  }
  if (!d.signature) return { valido: false, motivo: "sin header x-signature" };
  if (!d.requestId) return { valido: false, motivo: "sin header x-request-id" };
  if (!d.dataId) return { valido: false, motivo: "sin data.id" };

  const { ts, v1 } = parsearSignature(d.signature);
  if (!ts || !v1) return { valido: false, motivo: "x-signature mal formado" };

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) {
    return { valido: false, motivo: "ts no numérico" };
  }

  // `ts` viene en segundos.
  const ahora = d.ahoraMs ?? Date.now();
  const edad = Math.abs(ahora - tsNum * 1000);
  if (edad > VENTANA_MS) {
    return { valido: false, motivo: "notificación fuera de la ventana de tiempo" };
  }

  /**
   * `data.id` va en minúsculas: MP lo documenta así para los ids alfanuméricos,
   * y firmar con el casing crudo hace que la comparación falle contra las
   * notificaciones reales.
   */
  const manifest = `id:${String(d.dataId).toLowerCase()};request-id:${d.requestId};ts:${ts};`;
  const esperado = createHmac("sha256", d.secreto).update(manifest).digest("hex");

  if (!iguales(esperado, v1.toLowerCase())) {
    return { valido: false, motivo: "HMAC no coincide" };
  }

  return { valido: true };
}

/**
 * Arma la firma como la mandaría Mercado Pago. Existe para los tests: permite
 * verificar el validador con vectores generados, en vez de con un hash pegado a
 * mano que nadie puede volver a derivar si algo cambia.
 */
export function firmarParaTest(opts: {
  dataId: string;
  requestId: string;
  tsSegundos: number;
  secreto: string;
}): string {
  const manifest = `id:${opts.dataId.toLowerCase()};request-id:${opts.requestId};ts:${opts.tsSegundos};`;
  const v1 = createHmac("sha256", opts.secreto).update(manifest).digest("hex");
  return `ts=${opts.tsSegundos},v1=${v1}`;
}
