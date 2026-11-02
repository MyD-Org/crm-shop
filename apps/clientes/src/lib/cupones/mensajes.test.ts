import { describe, expect, it } from "vitest";
import { fmtPrecioCorto } from "../format";
import { mensajeCupon } from "./mensajes";

describe("mensajeCupon", () => {
  it("un texto por motivo, en usted", () => {
    expect(mensajeCupon("no_existe")).toBe("El código no es válido. Revíselo e inténtelo de nuevo.");
    expect(mensajeCupon("vencido")).toBe("Este cupón venció.");
    expect(mensajeCupon("no_empezo", { inicio: "2026-11-12T00:00:00-03:00" })).toBe("Este cupón se puede usar desde el 12/11 a las 00:00.");
    expect(mensajeCupon("usado")).toBe("Este cupón ya fue usado.");
    expect(mensajeCupon("no_primera_compra")).toBe("Este cupón es sólo para la primera compra en la tienda.");
    expect(mensajeCupon("minimo", { minimo: 30000 })).toBe(`Este cupón requiere una compra mínima de ${fmtPrecioCorto(30000)}.`);
    expect(mensajeCupon("todo_en_campania")).toBe("Los productos de su carrito ya tienen precio promocional: el cupón no se suma.");
    expect(mensajeCupon("sin_sesion")).toBe("Para usar un cupón, inicie sesión con su cuenta de la tienda.");
    expect(mensajeCupon("lista_privada")).toBe("Su cuenta tiene precios propios: este cupón no aplica.");
    expect(mensajeCupon("agotado")).toBe("Se agotaron los cupones de esta promoción.");
    expect(mensajeCupon("no_disponible")).toBe("No pudimos validar el cupón. Inténtelo de nuevo en un momento.");
  });

  it("solo_envio con y sin zona", () => {
    expect(mensajeCupon("solo_envio", { provinciasEnvio: null })).toBe("Este cupón es de envío gratis: elija envío a domicilio para usarlo.");
    expect(mensajeCupon("solo_envio", { provinciasEnvio: ["buenosaires", "cordoba"] })).toBe(
      "Este cupón es de envío gratis a Buenos Aires y Córdoba: elija envío a domicilio a esa zona para usarlo.",
    );
  });

  it("opcion_no_elegible dice qué restricción falló para la opción elegida", () => {
    const p = { medios: ["transferencia", "efectivo"], formas: null, permiteCuotas: false };
    expect(mensajeCupon("opcion_no_elegible", p, { transferencia: "Transferencia bancaria" }, { slug: "mercadopago", forma: "credito", cuotasSinInteres: false })).toBe(
      "Su cupón es válido sólo pagando con Transferencia bancaria o Efectivo.",
    );
    expect(mensajeCupon("opcion_no_elegible", { medios: null, formas: ["debito"], permiteCuotas: false }, undefined, { slug: "mercadopago", forma: "credito", cuotasSinInteres: false })).toBe(
      "Su cupón es válido sólo con tarjeta de débito.",
    );
    expect(mensajeCupon("opcion_no_elegible", { medios: null, formas: null, permiteCuotas: false }, undefined, { slug: "mercadopago", forma: "credito", cuotasSinInteres: true })).toBe(
      "Su cupón es válido sólo en 1 pago.",
    );
  });
});
