import { cacheLife, cacheTag } from "next/cache";
import { credencialesMercadoPago } from "./credenciales";
import { SIN_TARJETAS, tarjetasDeMercadoPago, type TarjetasAceptadas } from "./tarjetas-aceptadas";
import { conRespaldoPropio } from "./tarjetas-propias";

export const TAG_TARJETAS_MP = "tarjetas-mp";

/**
 * Tarjetas habilitadas en la cuenta de Mercado Pago. Cacheado por días (`'use cache'`): va en el footer de
 * todas las páginas y la lista casi no cambia. Sin credenciales o si Mercado Pago falla, devuelve los logos
 * propios (`tarjetas-propias.ts`) con el perfil `degradado` (minutos): se reintenta pronto, y mientras tanto
 * el footer y el checkout siguen mostrando tarjetas.
 */
export async function getTarjetasMercadoPago(): Promise<TarjetasAceptadas> {
  "use cache";
  cacheTag(TAG_TARJETAS_MP);
  const token = credencialesMercadoPago().accessToken;
  if (!token) {
    cacheLife("degradado");
    return conRespaldoPropio(SIN_TARJETAS);
  }
  try {
    const res = await fetch("https://api.mercadopago.com/v1/payment_methods", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tarjetas = tarjetasDeMercadoPago(await res.json());
    if (tarjetas.credito.length + tarjetas.debito.length > 0) cacheLife("days");
    else cacheLife("degradado");
    return conRespaldoPropio(tarjetas);
  } catch (err) {
    console.error("[tarjetas-mp] no se pudo leer la lista de medios de pago:", err);
    cacheLife("degradado");
    return conRespaldoPropio(SIN_TARJETAS);
  }
}
