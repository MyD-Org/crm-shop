/**
 * Con qué cuenta de Mercado Pago / Payway se cobra un pedido. Módulo PURO: sin entorno, sin base, sin
 * imports (lo usa también `credenciales.ts`, que importa `headers-seguridad.ts` desde next.config).
 *
 * La "cuenta" es el slug de la sucursal (`igz`, `mdp`): cada sucursal tiene su CUIT, su cuenta de Alegra
 * y su cuenta en cada procesador (mapeo 1 a 1). La cuenta PREVISTA de un pedido sigue la misma regla que
 * la cuenta que factura en el CRM (`resolverCuentaFactura` sin override): la sucursal que fuerza la zona,
 * si no la del pedido, si no la predeterminada.
 */

export function cuentaDeCobro(
  p: { sucursal: string | null; facturaSucursal: string | null },
  predeterminada: string | null,
): string | null {
  // null = no hay ninguna prevista (pedido sin sucursal y sin predeterminada en el CRM).
  return p.facturaSucursal ?? p.sucursal ?? predeterminada;
}

/**
 * Sufijo de las variables de entorno de una cuenta: mayúsculas y `-` -> `_` (`mar-del-plata` ->
 * `MAR_DEL_PLATA`). Los slugs del CRM son `[a-z0-9-]`, así que el mapeo es inyectivo salvo que dos
 * slugs difieran sólo en guiones contra guiones bajos (imposible con ese alfabeto); igual se loguea si
 * dos colisionan (`cuentas-sucursales.ts`).
 */
export function slugAVariable(slug: string): string {
  return slug.trim().toUpperCase().replace(/-/g, "_");
}

/** Una cuenta que podría cobrar este pedido. */
export interface Candidata {
  cuenta: string;
  /** Tiene el juego completo de credenciales del procesador. */
  configurada: boolean;
  /** El procesador rechazó sus credenciales en ESTE pedido (evidencia persistida; R2). */
  rechazada: boolean;
}

export type CuentaElegida =
  | { ok: true; cuenta: string; prevista: string | null; fallback: boolean }
  | { ok: false; motivo: "sin_cuenta" | "cuenta_no_valida" };

/**
 * Política de la cuenta USADA. Usable = configurada y sin rechazo. Por defecto, la primera usable de
 * `candidatas` (que vienen con la prevista primero). Con `declarada` (la que el navegador usó para
 * tokenizar la tarjeta), tiene que ser usable y ser la prevista, o que la prevista no sea usable; si
 * no, `cuenta_no_valida`: el navegador nunca elige la cuenta, sólo se valida contra la política.
 */
export function elegirCuenta(i: {
  prevista: string | null;
  candidatas: readonly Candidata[];
  declarada?: string | null;
}): CuentaElegida {
  const usable = (c: Candidata) => c.configurada && !c.rechazada;
  const usables = i.candidatas.filter(usable);
  const previstaUsable = i.prevista !== null && usables.some((c) => c.cuenta === i.prevista);
  const resultado = (cuenta: string): CuentaElegida => ({
    ok: true,
    cuenta,
    prevista: i.prevista,
    fallback: i.prevista !== null && cuenta !== i.prevista,
  });

  if (i.declarada) {
    const declaradaUsable = usables.some((c) => c.cuenta === i.declarada);
    if (!declaradaUsable) return { ok: false, motivo: "cuenta_no_valida" };
    if (i.declarada !== i.prevista && previstaUsable) return { ok: false, motivo: "cuenta_no_valida" };
    return resultado(i.declarada);
  }

  if (previstaUsable) return resultado(i.prevista as string);
  const primera = usables[0];
  return primera ? resultado(primera.cuenta) : { ok: false, motivo: "sin_cuenta" };
}

/**
 * Orden determinista de las candidatas: la prevista primero, después la predeterminada y el resto por
 * slug. Sin duplicados.
 */
export function ordenarCandidatas(
  slugs: readonly string[],
  o: { prevista: string | null; predeterminada: string | null },
): string[] {
  const resto = [...new Set(slugs)].filter((s) => s !== o.prevista && s !== o.predeterminada).sort();
  const primeras = [o.prevista, o.predeterminada].filter((s): s is string => Boolean(s));
  return [...new Set([...primeras, ...resto])];
}
