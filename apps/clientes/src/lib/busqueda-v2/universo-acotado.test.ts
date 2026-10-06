import { describe, expect, it } from "vitest";
import { universoAcotado } from "./universo-acotado";
import type { CriterioPlan } from "./piezas";

const plan = (terminos: { texto: string; peso: number }[] = [], categorias: { nombre: string; peso: number }[] = []): CriterioPlan => ({
  consulta: "x",
  blandos: { categorias, atributos: [], terminos },
});

describe("universoAcotado (qué acota el conjunto sobre el que una medida filtra)", () => {
  it("sin categoría, sin búsqueda y sin plan: no hay universo (el filtro manual ?atr=corriente_a:20)", () => {
    expect(universoAcotado({})).toBe(false);
    expect(universoAcotado({ categorias: [], busqueda: "  " })).toBe(false);
  });

  it("una categoría dura acota", () => {
    expect(universoAcotado({ categorias: ["Termomagnéticas"] })).toBe(true);
  });

  it("búsqueda clásica: el texto filtra, acota", () => {
    expect(universoAcotado({ busqueda: "termica" })).toBe(true);
  });

  it("con plan: los términos que recuperan acotan; los de orden (medidas, contexto) no", () => {
    expect(universoAcotado({ planBusqueda: plan([{ texto: "termica", peso: 1 }]) })).toBe(true);
    expect(universoAcotado({ planBusqueda: plan([{ texto: "20a", peso: 0.4 }]) })).toBe(false);
  });

  it("con plan, el texto crudo de la búsqueda no cuenta (no filtra: recupera el plan)", () => {
    expect(universoAcotado({ busqueda: "bipolar 20a", planBusqueda: plan([{ texto: "20a", peso: 0.4 }]) })).toBe(false);
  });

  it("una categoría BLANDA fuerte no es ancla (decisión C1: ancla = categorías duras o términos fuertes)", () => {
    expect(universoAcotado({ planBusqueda: plan([], [{ nombre: "Termomagnéticas", peso: 0.9 }]) })).toBe(false);
  });

  it("la categoría dura acota aunque haya plan sin términos fuertes", () => {
    expect(universoAcotado({ categorias: ["Termomagnéticas"], planBusqueda: plan([{ texto: "20a", peso: 0.4 }]) })).toBe(true);
  });
});
