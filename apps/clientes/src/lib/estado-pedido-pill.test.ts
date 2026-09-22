import { describe, expect, it } from "vitest";
import type { EntregaTipoPedido, OrderEstado, PagoEstado } from "@/data/orders";
import { estadoPedidoPill } from "./estado-pedido-pill";

const ESTADOS: OrderEstado[] = [
  "pendiente",
  "confirmado",
  "preparacion",
  "en_camino",
  "entregado",
  "cancelado",
];
const PAGOS: PagoEstado[] = ["pendiente", "pagado", "fallido"];
const ENTREGAS: EntregaTipoPedido[] = ["retiro", "envio"];
const TONOS = ["neutral", "success", "danger", "warning", "info"];

/** Estado visible único de un pedido: una sola pill (PED-3). */
describe("estadoPedidoPill", () => {
  it("la matriz de la spec", () => {
    const casos: [OrderEstado, PagoEstado, EntregaTipoPedido, string, string][] = [
      ["pendiente", "pendiente", "retiro", "Pago pendiente", "warning"],
      ["pendiente", "pagado", "retiro", "Pago confirmado", "info"],
      ["confirmado", "pendiente", "retiro", "Confirmado", "info"],
      ["preparacion", "pagado", "envio", "En preparación", "info"],
      ["en_camino", "pagado", "envio", "En camino", "info"],
      ["entregado", "pagado", "retiro", "Retirado", "success"],
      ["entregado", "pagado", "envio", "Entregado", "success"],
      ["cancelado", "fallido", "envio", "Cancelado", "danger"],
      ["confirmado", "fallido", "retiro", "Pago rechazado", "danger"],
    ];
    for (const [estado, pagoEstado, entregaTipo, label, tone] of casos) {
      expect(estadoPedidoPill({ estado, pagoEstado, entregaTipo }), `${estado}/${pagoEstado}/${entregaTipo}`).toEqual({
        label,
        tone,
      });
    }
  });

  it("barrido completo: precedencia cancelado → fallido → pago pendiente → resto", () => {
    for (const estado of ESTADOS) {
      for (const pagoEstado of PAGOS) {
        for (const entregaTipo of ENTREGAS) {
          const caso = `${estado}/${pagoEstado}/${entregaTipo}`;
          const pill = estadoPedidoPill({ estado, pagoEstado, entregaTipo });
          expect(TONOS, caso).toContain(pill.tone);
          expect(pill.label.trim(), caso).not.toBe("");

          if (estado === "cancelado") {
            expect(pill, caso).toEqual({ label: "Cancelado", tone: "danger" });
          } else if (pagoEstado === "fallido") {
            expect(pill, caso).toEqual({ label: "Pago rechazado", tone: "danger" });
          } else if (estado === "pendiente") {
            expect(pill, caso).toEqual(
              pagoEstado === "pagado"
                ? { label: "Pago confirmado", tone: "info" }
                : { label: "Pago pendiente", tone: "warning" },
            );
          } else if (estado === "entregado") {
            expect(pill, caso).toEqual({
              label: entregaTipo === "retiro" ? "Retirado" : "Entregado",
              tone: "success",
            });
          } else {
            // confirmado / preparacion / en_camino: el pago (pendiente o pagado) no cambia nada.
            expect(pill.tone, caso).toBe("info");
            expect(pill, caso).toEqual(
              estadoPedidoPill({ estado, pagoEstado: "pagado", entregaTipo: "envio" }),
            );
          }
        }
      }
    }
  });

  it("los textos están en registro formal", () => {
    const labels = ESTADOS.flatMap((estado) =>
      PAGOS.flatMap((pagoEstado) =>
        ENTREGAS.map((entregaTipo) => estadoPedidoPill({ estado, pagoEstado, entregaTipo }).label),
      ),
    ).join(" ");
    expect(labels).not.toMatch(/\b(tu|tus|te|vos)\b/i);
  });
});

/**
 * Con los pagos apagados (pagos-flag.ts) ningún pedido se paga en el Shop:
 * "Pago pendiente" sólo confunde y ya estaba oculto antes del rediseño
 * (pago-estado-visible.ts). La pill conserva esa decisión.
 */
describe("estadoPedidoPill con los pagos apagados", () => {
  it("pendiente + pago pendiente no dice 'Pago pendiente'", () => {
    expect(
      estadoPedidoPill(
        { estado: "pendiente", pagoEstado: "pendiente", entregaTipo: "retiro" },
        { pagosHabilitados: false },
      ),
    ).toEqual({ label: "Pendiente", tone: "neutral" });
  });

  it("el resto de la matriz no cambia", () => {
    for (const estado of ESTADOS) {
      for (const pagoEstado of PAGOS) {
        for (const entregaTipo of ENTREGAS) {
          if (estado === "pendiente" && pagoEstado === "pendiente") continue;
          const o = { estado, pagoEstado, entregaTipo };
          expect(estadoPedidoPill(o, { pagosHabilitados: false })).toEqual(estadoPedidoPill(o));
        }
      }
    }
  });

  it("por defecto (pagos prendidos) sigue diciendo 'Pago pendiente'", () => {
    const o = { estado: "pendiente", pagoEstado: "pendiente", entregaTipo: "envio" } as const;
    expect(estadoPedidoPill(o, { pagosHabilitados: true }).label).toBe("Pago pendiente");
    expect(estadoPedidoPill(o).label).toBe("Pago pendiente");
  });
});
