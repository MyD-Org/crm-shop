import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MetaCuotas, OpcionesCuotas } from "./OpcionesCuotas";

const opciones = [
  { cuotas: 1, total: 100000, montoCuota: 100000 },
  { cuotas: 3, total: 110000, montoCuota: 36666.67 },
];
const html = (progreso?: Parameters<typeof OpcionesCuotas>[0]["progreso"], elegida = 1) =>
  renderToStaticMarkup(<OpcionesCuotas opciones={opciones} elegida={elegida} onElegir={() => {}} progreso={progreso} />);

describe("OpcionesCuotas", () => {
  it("una fila por opción con monto por cuota, etiqueta y total", () => {
    const h = html();
    expect(h).toContain("1 pago");
    expect(h).toMatch(/3 cuotas de \$\s?36\.666,67/);
    expect(h.match(/Sin interés/g)).toHaveLength(1);
    expect(h).toMatch(/Total \$\s?110\.000/);
    expect(h).not.toContain("(total");
    expect(h).not.toContain("Se pagan con tarjeta");
  });
  it("el aviso de sólo crédito aparece únicamente con cuotas elegidas", () => {
    expect(html(undefined, 1)).not.toContain("sólo con tarjeta de crédito");
    expect(html(undefined, 3)).toContain("En cuotas, sólo con tarjeta de crédito. Con débito, elija 1 pago.");
  });
  it("muestra la meta compacta con énfasis cuando falta para el próximo escalón", () => {
    const h = html({ cuotasActuales: 3, proximo: { cuotas: 6, falta: 15000, minimo: 90000 }, pct: 83 });
    expect(h).toContain("Sume");
    expect(h).toContain("<strong>");
    expect(h).toContain('data-meta="cuotas"');
  });
  it("sin próximo escalón no muestra la meta", () => {
    expect(html({ cuotasActuales: 12, proximo: null, pct: 100 })).not.toContain("data-meta");
    expect(html(null)).not.toContain("data-meta");
  });
});

describe("MetaCuotas (Mercado Pago: las cuotas van en el formulario)", () => {
  it("sólo la meta, sin el selector", () => {
    const h = renderToStaticMarkup(<MetaCuotas progreso={{ cuotasActuales: 3, proximo: { cuotas: 6, falta: 15000, minimo: 90000 }, pct: 83 }} />);
    expect(h).toContain('data-meta="cuotas"');
    expect(h).not.toContain("Cantidad de cuotas");
  });
  it("sin próximo escalón, nada", () => {
    expect(renderToStaticMarkup(<MetaCuotas progreso={{ cuotasActuales: 12, proximo: null, pct: 100 }} />)).toBe("");
    expect(renderToStaticMarkup(<MetaCuotas progreso={null} />)).toBe("");
  });
});
