import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChipsMedioPago } from "./ChipsMedioPago";

describe("ChipsMedioPago", () => {
  it("sin chips no dibuja nada", () => {
    expect(renderToStaticMarkup(<ChipsMedioPago chips={[]} />)).toBe("");
    expect(renderToStaticMarkup(<ChipsMedioPago />)).toBe("");
  });

  it("dibuja un Badge por chip, en el orden cargado y con el tono mapeado", () => {
    const h = renderToStaticMarkup(
      <ChipsMedioPago
        chips={[
          { texto: "Hasta 8 cuotas sin interés", tono: "destacado" },
          { texto: "15% OFF", tono: "exito" },
          { texto: "Promo del mes", tono: "info" },
        ]}
      />,
    );
    const i1 = h.indexOf("Hasta 8 cuotas sin interés");
    const i2 = h.indexOf("15% OFF");
    const i3 = h.indexOf("Promo del mes");
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(h).toContain("bg-warning-soft"); // destacado
    expect(h).toContain("bg-success-soft"); // exito
    expect(h).toContain("bg-info-soft"); // info
  });

  it("escapa el texto (no interpreta HTML)", () => {
    const h = renderToStaticMarkup(<ChipsMedioPago chips={[{ texto: "<b>x</b>", tono: "info" }]} />);
    expect(h).not.toContain("<b>");
    expect(h).toContain("&lt;b&gt;");
  });
});

describe("CheckoutClient usa los chips en la lista de medios", () => {
  const fuente = readFileSync(join(__dirname, "..", "CheckoutClient.tsx"), "utf8");
  it("cada opción de medio recibe sus chips; el medio de cuenta corriente (sin elección) no los muestra", () => {
    expect(fuente).toContain("chips={m.chips}");
    expect(fuente).toContain("<ChipsMedioPago chips={chips} />");
    // El bloque de cuenta corriente es un texto sin RadioCard: no lleva chips.
    const bloqueCc = fuente.slice(fuente.indexOf("// Cuenta corriente: un único medio, sin elección."));
    expect(bloqueCc.slice(0, bloqueCc.indexOf(") : (")).includes("ChipsMedioPago")).toBe(false);
  });
});
