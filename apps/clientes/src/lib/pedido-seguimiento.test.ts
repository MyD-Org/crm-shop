import { describe, expect, it } from "vitest";
import type { EntregaTipoPedido, OrderEstado, PagoEstado } from "@/data/orders";
import { seguimientoPedido } from "./pedido-seguimiento";

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

function pasos(entregaTipo: EntregaTipoPedido, estado: OrderEstado, pagoEstado: PagoEstado) {
  return seguimientoPedido({ entregaTipo, estado, pagoEstado });
}

/** `id:state` de cada paso, para comparar de un vistazo. */
function resumen(entregaTipo: EntregaTipoPedido, estado: OrderEstado, pagoEstado: PagoEstado) {
  return pasos(entregaTipo, estado, pagoEstado)?.map((p) => `${p.id}:${p.state}`);
}

/** Seguimiento del pedido como proyección del estado (PED-4). */
describe("seguimientoPedido", () => {
  it("retiro recién recibido: 4 pasos, el pago en curso", () => {
    expect(resumen("retiro", "pendiente", "pendiente")).toEqual([
      "recibido:done",
      "pago:current",
      "preparando:pending",
      "retirado:pending",
    ]);
  });

  it("retiro en preparación cobrado en el local: pago y preparando hechos, retiro en curso", () => {
    expect(resumen("retiro", "preparacion", "pendiente")).toEqual([
      "recibido:done",
      "pago:done",
      "preparando:done",
      "retirado:current",
    ]);
  });

  it("envío entregado: 5 pasos hechos y ninguno en curso", () => {
    const p = pasos("envio", "entregado", "pagado")!;
    expect(p.map((x) => x.id)).toEqual(["recibido", "pago", "preparando", "en_camino", "entregado"]);
    expect(p.every((x) => x.state === "done")).toBe(true);
  });

  it("cancelado no tiene seguimiento, con cualquier pago y entrega", () => {
    for (const pago of PAGOS) {
      for (const entrega of ENTREGAS) expect(pasos(entrega, "cancelado", pago)).toBeNull();
    }
  });

  it("confirmado sin pago online: el pago cuenta como confirmado (cobro offline)", () => {
    expect(resumen("envio", "confirmado", "pendiente")).toEqual([
      "recibido:done",
      "pago:done",
      "preparando:current",
      "en_camino:pending",
      "entregado:pending",
    ]);
  });

  it("pendiente pero pagado online: pago hecho, preparando en curso", () => {
    expect(resumen("retiro", "pendiente", "pagado")).toEqual([
      "recibido:done",
      "pago:done",
      "preparando:current",
      "retirado:pending",
    ]);
  });

  it("un pago fallido no cambia el seguimiento (lo dice la pill)", () => {
    for (const estado of ESTADOS) {
      for (const entrega of ENTREGAS) {
        expect(pasos(entrega, estado, "fallido"), `${estado}/${entrega}`).toEqual(
          pasos(entrega, estado, "pendiente"),
        );
      }
    }
  });

  it("en camino con retiro (posible desde el CRM): sin paso en camino, retiro en curso", () => {
    expect(resumen("retiro", "en_camino", "pagado")).toEqual([
      "recibido:done",
      "pago:done",
      "preparando:done",
      "retirado:current",
    ]);
  });

  it("barrido: a lo sumo un paso en curso, siempre el primero no hecho, y nunca 'listo para retiro'", () => {
    for (const estado of ESTADOS) {
      for (const pago of PAGOS) {
        for (const entrega of ENTREGAS) {
          const p = pasos(entrega, estado, pago);
          if (!p) continue;
          const caso = `${estado}/${pago}/${entrega}`;
          expect(p.length, caso).toBe(entrega === "retiro" ? 4 : 5);
          expect(p[0].state, caso).toBe("done");
          const primeroNoHecho = p.findIndex((x) => x.state !== "done");
          p.forEach((x, i) => {
            if (primeroNoHecho === -1 || i < primeroNoHecho) expect(x.state, caso).toBe("done");
            else if (i === primeroNoHecho) expect(x.state, caso).toBe("current");
            else expect(x.state, caso).toBe("pending");
          });
          expect(p.map((x) => x.id), caso).not.toContain("listo_retiro");
        }
      }
    }
  });

  it("labels exactos del copy aprobado", () => {
    expect(pasos("retiro", "pendiente", "pendiente")!.map((p) => p.label)).toEqual([
      "Pedido recibido",
      "Pago confirmado",
      "Preparando",
      "Retirado",
    ]);
    expect(pasos("envio", "pendiente", "pendiente")!.map((p) => p.label)).toEqual([
      "Pedido recibido",
      "Pago confirmado",
      "Preparando",
      "En camino",
      "Entregado",
    ]);
  });

  describe("con los pagos apagados", () => {
    const sinPagos = (entregaTipo: EntregaTipoPedido, estado: OrderEstado, pagoEstado: PagoEstado) =>
      seguimientoPedido({ entregaTipo, estado, pagoEstado }, { pagosHabilitados: false });

    it("el segundo paso dice 'Pedido confirmado' en lugar de 'Pago confirmado'", () => {
      expect(sinPagos("retiro", "pendiente", "pendiente")!.map((p) => p.label)).toEqual([
        "Pedido recibido",
        "Pedido confirmado",
        "Preparando",
        "Retirado",
      ]);
    });

    it("recién recibido: la confirmación en curso", () => {
      expect(sinPagos("retiro", "pendiente", "pendiente")!.map((p) => `${p.id}:${p.state}`)).toEqual([
        "recibido:done",
        "pago:current",
        "preparando:pending",
        "retirado:pending",
      ]);
    });

    it("un pago_estado 'pagado' no da el paso por hecho: sólo la confirmación del operador", () => {
      expect(sinPagos("envio", "pendiente", "pagado")!.find((p) => p.id === "pago")!.state).toBe("current");
      expect(sinPagos("envio", "confirmado", "pendiente")!.find((p) => p.id === "pago")!.state).toBe("done");
    });

    it("sin la opción se comporta como hasta ahora (pagos habilitados)", () => {
      for (const e of ENTREGAS) {
        for (const estado of ESTADOS) {
          for (const pago of PAGOS) {
            expect(seguimientoPedido({ entregaTipo: e, estado, pagoEstado: pago })).toEqual(
              seguimientoPedido({ entregaTipo: e, estado, pagoEstado: pago }, { pagosHabilitados: true }),
            );
          }
        }
      }
    });
  });
});
