import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MetaCuotas } from "./MetaCuotas";

describe("MetaCuotas (las cuotas van en el formulario de pago)", () => {
  it("sólo la meta, sin el selector", () => {
    const h = renderToStaticMarkup(<MetaCuotas progreso={{ cuotasActuales: 3, proximo: { cuotas: 6, falta: 15000, minimo: 90000 }, pct: 83 }} />);
    expect(h).toContain('data-meta="cuotas"');
    expect(h).not.toContain("Cantidad de cuotas");
  });
  it("muestra la meta compacta con énfasis cuando falta para el próximo escalón", () => {
    const h = renderToStaticMarkup(<MetaCuotas progreso={{ cuotasActuales: 3, proximo: { cuotas: 6, falta: 15000, minimo: 90000 }, pct: 83 }} />);
    expect(h).toContain("Sume");
    expect(h).toContain("<strong>");
  });
  it("sin próximo escalón, nada", () => {
    expect(renderToStaticMarkup(<MetaCuotas progreso={{ cuotasActuales: 12, proximo: null, pct: 100 }} />)).toBe("");
    expect(renderToStaticMarkup(<MetaCuotas progreso={null} />)).toBe("");
  });
});
