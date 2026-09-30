import { describe, expect, it } from "vitest";
import { limpiarEventoPosthog } from "./posthog-limpieza";

describe("limpiarEventoPosthog", () => {
  it("limpia toda URL de las props, $set y $set_once", () => {
    const limpio = limpiarEventoPosthog({
      event: "$pageview",
      properties: {
        $current_url: "https://tienda.example/carrito/compartido?i=p1.2&utm_source=wa",
        $referrer: "https://buscador.example/buscar?q=datos",
        $pathname: "/carrito/compartido",
        valor: 10,
        $set_once: { $initial_current_url: "https://tienda.example/?__clerk_ticket=x" },
      },
      $set: { $current_url: "https://tienda.example/checkout?tema=azul" },
    });
    expect(limpio?.properties).toMatchObject({
      $current_url: "https://tienda.example/carrito/compartido?utm_source=wa",
      $referrer: "https://buscador.example/buscar",
      $pathname: "/carrito/compartido",
      valor: 10,
      $set_once: { $initial_current_url: "https://tienda.example/" },
    });
    expect(limpio?.$set).toEqual({ $current_url: "https://tienda.example/checkout" });
  });

  it("null pasa como null (otro before_send ya lo descartó)", () => {
    expect(limpiarEventoPosthog(null)).toBeNull();
  });
});
