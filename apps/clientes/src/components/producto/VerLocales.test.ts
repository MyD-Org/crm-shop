import { describe, expect, it } from "vitest";
import { partirLineaHorario } from "./VerLocales";

describe("partirLineaHorario", () => {
  it("separa los días de las horas", () => {
    expect(partirLineaHorario("Lunes a viernes 7:45 a 12:00 y 14:45 a 19:00")).toEqual([
      "Lunes a viernes",
      "7:45 a 12:00 y 14:45 a 19:00",
    ]);
    expect(partirLineaHorario("Sábado 8:00 a 12:00")).toEqual(["Sábado", "8:00 a 12:00"]);
  });

  it("'cerrado' también va a la columna de horas", () => {
    expect(partirLineaHorario("Domingo cerrado")).toEqual(["Domingo", "cerrado"]);
  });

  it("un texto libre sin horas queda entero", () => {
    expect(partirLineaHorario("Consultar por WhatsApp")).toEqual(["Consultar por WhatsApp"]);
  });
});
