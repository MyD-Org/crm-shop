import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { limpiar } from "@/test/registro-usted";

/**
 * Superficie del invitado (change `compra-como-invitado`, S2a): SOLO estos archivos pueden aceptar el
 * token de compra (`X-Pedido-Token`). Cualquier otra ruta —lista de pedidos, `/api/mi-cuenta/*`,
 * comprobantes, facturas, direcciones, facturación, `/api/geocode`, cuenta corriente— sigue pidiendo
 * sesión: si alguien engancha el principal del invitado en otro lado, este test lo hace notar y obliga
 * a revisarlo (y a sumar su matriz de aislamiento).
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));

const PERMITIDOS = [
  // El núcleo
  "lib/invitado-acceso.ts",
  "lib/invitado-respuesta.ts",
  // Lado navegador: el único que ARMA el header (en memoria; ver invitado-token-cliente.ts)
  "lib/invitado-token-cliente.ts",
  // Endpoints del pedido (D4)
  "app/api/pedidos/[id]/pago/route.ts",
  "app/api/pedidos/[id]/medio/route.ts",
  "app/api/pedidos/[id]/cuotas/route.ts",
  "app/api/pedidos/[id]/avisos/route.ts",
  "app/api/pedidos/[id]/cancelar/route.ts", // sólo para responder 403 al invitado
  "app/api/pedidos/pendiente/route.ts",
  "app/api/pagos/mercadopago/preferencia/route.ts",
  "app/api/pagos/payway-config/route.ts",
  "app/api/pagos/cuenta-rechazada/route.ts",
  "lib/pagos/cobrar.ts", // POST /api/pagos/mercadopago y POST /api/pagos/[proveedor]
].sort();

function fuentes(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return fuentes(ruta);
    return /\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

describe("quién puede aceptar el token de compra del invitado", () => {
  const aceptan = fuentes(SRC)
    .filter((f) => !relative(SRC, f).startsWith("test"))
    .filter((f) => /\b(?:principalDelPedido|resolverPrincipal|HEADER_TOKEN_PEDIDO)\b|x-pedido-token/i.test(limpiar(readFileSync(f, "utf8"))))
    .map((f) => relative(SRC, f).split(sep).join("/"))
    .sort();

  it("la lista es exactamente la de los endpoints del pedido (D4)", () => {
    expect(aceptan).toEqual(PERMITIDOS);
  });

  it("nada de /api/mi-cuenta, /api/geocode ni la lista de pedidos acepta al invitado", () => {
    for (const ruta of aceptan) {
      expect(ruta).not.toMatch(/^app\/api\/mi-cuenta\//);
      expect(ruta).not.toMatch(/^app\/api\/geocode\//);
      expect(ruta).not.toMatch(/^app\/mi-cuenta\//);
    }
    expect(aceptan).not.toContain("app/api/pedidos/route.ts");
  });

  it("ningún componente ni página de /mi-cuenta lee el token del invitado", () => {
    for (const ruta of aceptan) expect(ruta).not.toMatch(/^(components|app\/(?!api))/);
  });
});
