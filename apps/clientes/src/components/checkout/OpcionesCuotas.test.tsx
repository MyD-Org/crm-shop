import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OpcionesCuotas } from "./OpcionesCuotas";

const opciones = [
  { cuotas: 1, total: 100000, montoCuota: 100000 },
  { cuotas: 3, total: 110000, montoCuota: 36666.67 },
];
const html = (progreso?: Parameters<typeof OpcionesCuotas>[0]["progreso"]) =>
  renderToStaticMarkup(<OpcionesCuotas opciones={opciones} elegida={1} onElegir={() => {}} progreso={progreso} />);

describe("OpcionesCuotas", () => {
  it("una fila por opción con monto por cuota, etiqueta y total", () => {
    const h = html();
    expect(h).toContain("1 pago");
    expect(h).toMatch(/3 cuotas de \$\s?36\.666,67/);
    expect(h.match(/Sin interés/g)).toHaveLength(1);
    expect(h).toMatch(/Total \$\s?110\.000/);
    expect(h).not.toContain("(total");
    expect(h).toContain("Solo con tarjeta de crédito.");
    expect(h).not.toContain("Se pagan con tarjeta");
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
