/**
 * Cuántas cuotas SIN INTERÉS da hoy la cuenta de Mercado Pago, para exhibirlas en la tienda (card,
 * ficha y modal). Las cuotas de MP se configuran en su cuenta, no en el admin (#533): este dato se lee
 * de MP y sigue solo cualquier cambio que se haga allá (3, 6 o ninguna).
 *
 * `GET /v1/payment_methods/installments?amount=<referencia>&payment_method_id=<visa|master>` devuelve
 * una entrada por banco emisor. Regla conservadora: se anuncia la MAYOR cantidad de cuotas con tasa 0
 * que ofrecen TODOS los bancos que dan cuotas (los que sólo dan 1 pago no cuentan). Así el anuncio
 * vale para cualquier tarjeta de crédito; si un banco da más, se ve recién al pagar.
 *
 * Fail-closed: sin credenciales, si MP no responde o no hay cuotas sin interés → null (no se anuncia nada).
 */
import { cacheLife, cacheTag } from "next/cache";
import { credencialesMercadoPago } from "./credenciales";
import { leerDatosCuentas } from "./cuentas-sucursales";
import { parsearPlanesMP, type PlanesMP } from "./mercadopago-planes";

export const TAG_CUOTAS_MP = "cuotas-mp";

const API = "https://api.mercadopago.com/v1/payment_methods/installments";
/** Monto de referencia para la consulta: alcanza los mínimos habituales de cuotas. */
const MONTO_REFERENCIA = 100_000;
const MARCAS = ["visa", "master"] as const;
const TIMEOUT_MS = 5_000;

/**
 * Mayor cantidad de cuotas sin interés común a todos los emisores que ofrecen cuotas. null si no hay.
 * Puro: recibe las entradas ya parseadas de una o varias marcas.
 */
export function maxCuotasSinInteresComun(entradas: readonly PlanesMP[]): number | null {
  const conCuotas = entradas.filter((e) => e.planes.length > 0);
  if (conCuotas.length === 0) return null;
  const sinInteres = conCuotas.map((e) => new Set(e.planes.filter((p) => !p.conInteres).map((p) => p.cuotas)));
  const comunes = [...sinInteres[0]].filter((n) => sinInteres.every((s) => s.has(n)));
  const max = Math.max(...comunes);
  return Number.isFinite(max) && max >= 2 ? max : null;
}

/** Consulta las marcas con un token. Lanza si alguna falla: sin el dato completo no se anuncia nada. */
export async function consultarCuotasSinInteres(
  accessToken: string,
  deps: { fetch?: typeof fetch } = {},
): Promise<number | null> {
  const entradas: PlanesMP[] = [];
  for (const marca of MARCAS) {
    const res = await (deps.fetch ?? fetch)(`${API}?amount=${MONTO_REFERENCIA}&payment_method_id=${marca}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    entradas.push(...parsearPlanesMP(await res.json()));
  }
  return maxCuotasSinInteresComun(entradas);
}

async function tokenPredeterminada(): Promise<string | null> {
  const { predeterminada } = await leerDatosCuentas();
  return predeterminada ? credencialesMercadoPago(predeterminada).accessToken : null;
}

/**
 * Cuotas sin interés de la cuenta de MP de la sucursal PREDETERMINADA (como las tarjetas del footer).
 * Cacheado por horas: un cambio en MP se ve en la tienda en menos de 1 hora. Si falla, se reintenta
 * a los pocos minutos (perfil `degradado`).
 */
export async function cuotasSinInteresMP(): Promise<number | null> {
  "use cache";
  cacheTag(TAG_CUOTAS_MP);
  try {
    const token = await tokenPredeterminada();
    if (!token) {
      cacheLife("degradado");
      return null;
    }
    const cuotas = await consultarCuotasSinInteres(token);
    cacheLife("hours");
    return cuotas;
  } catch (err) {
    console.error("[cuotas-mp] no se pudieron leer las cuotas de Mercado Pago:", (err as Error)?.message ?? err);
    cacheLife("degradado");
    return null;
  }
}
