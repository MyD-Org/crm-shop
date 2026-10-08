import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { IDS_MERCADO_PAGO, marcaDeMercadoPago } from "./marcas";
import { SIN_TARJETAS, logosTarjetas, tarjetasDeMercadoPago } from "./tarjetas-aceptadas";
import { tarjetasPayway } from "./tarjetas-payway";
import { TARJETAS_PROPIAS, conRespaldoPropio } from "./tarjetas-propias";

const PUBLIC = resolve(__dirname, "../../../public");
const todas = [...TARJETAS_PROPIAS.credito, ...TARJETAS_PROPIAS.debito];

const medio = (id: string, name: string, payment_type_id: string) => ({
  id,
  name,
  payment_type_id,
  status: "active",
  secure_thumbnail: `https://img.example/${id}.gif`,
});

describe("TARJETAS_PROPIAS (respaldo cuando Mercado Pago no devuelve la lista)", () => {
  it("cubre las tarjetas que se muestran hoy: Visa, Mastercard, American Express, Naranja, Cabal, Diners, Argencard y Maestro", () => {
    const nombres = logosTarjetas(TARJETAS_PROPIAS).map((l) => l.name);
    for (const n of ["Visa", "Mastercard", "American Express", "Naranja", "Cabal", "Diners", "Argencard", "Maestro"]) {
      expect(nombres).toContain(n);
    }
  });

  it("usa ids de Mercado Pago que marcas.ts reconoce (así tarjetasPayway los une por marca)", () => {
    for (const t of todas) {
      expect(IDS_MERCADO_PAGO).toContain(t.id);
      expect(marcaDeMercadoPago(t.id)).not.toBeNull();
    }
  });

  it("separa crédito y débito como Mercado Pago", () => {
    expect(TARJETAS_PROPIAS.credito.map((t) => t.id)).toEqual(["visa", "master", "amex", "naranja", "cabal", "argencard", "diners"]);
    expect(TARJETAS_PROPIAS.debito.map((t) => t.id)).toEqual(["debvisa", "debmaster", "maestro", "debcabal"]);
  });

  it("cada logo es un archivo propio de /images/tarjetas, sin hosts externos", () => {
    for (const t of todas) expect(t.logo).toMatch(/^\/images\/tarjetas\/[a-z]+\.(png|svg)$/);
  });

  it("cada logo existe en public/ y es una imagen válida (PNG por su firma, SVG sin scripts ni recursos externos)", () => {
    for (const t of todas) {
      const archivo = resolve(PUBLIC, t.logo.slice(1));
      expect(existsSync(archivo), t.logo).toBe(true);
      const bytes = readFileSync(archivo);
      if (t.logo.endsWith(".png")) {
        expect(bytes.subarray(0, 8).toString("hex"), t.logo).toBe("89504e470d0a1a0a");
      } else {
        const svg = bytes.toString("utf8");
        expect(svg, t.logo).toMatch(/^<svg\b/);
        expect(svg, t.logo).not.toMatch(/<script|<image|<foreignObject|xlink:href|@import|url\(\s*["']?https?:|\son\w+=/i);
      }
    }
  });

  it("crédito y débito de una marca pueden compartir logo: el footer no lo repite", () => {
    const srcs = logosTarjetas(TARJETAS_PROPIAS).map((l) => l.src);
    expect(new Set(srcs).size).toBe(srcs.length);
  });
});

describe("conRespaldoPropio", () => {
  it("con tarjetas de Mercado Pago no cambia nada (devuelve las mismas)", () => {
    const mp = tarjetasDeMercadoPago([medio("visa", "Visa", "credit_card"), medio("debvisa", "Visa Débito", "debit_card")]);
    expect(conRespaldoPropio(mp)).toBe(mp);
  });

  it("con sólo crédito o sólo débito de Mercado Pago tampoco cambia nada", () => {
    const soloCredito = tarjetasDeMercadoPago([medio("visa", "Visa", "credit_card")]);
    expect(conRespaldoPropio(soloCredito)).toBe(soloCredito);
  });

  it("sin tarjetas (falla, sin credenciales o respuesta vacía) usa las propias", () => {
    expect(conRespaldoPropio(SIN_TARJETAS)).toBe(TARJETAS_PROPIAS);
    expect(conRespaldoPropio(tarjetasDeMercadoPago([]))).toBe(TARJETAS_PROPIAS);
    expect(conRespaldoPropio(tarjetasDeMercadoPago("no es una lista"))).toBe(TARJETAS_PROPIAS);
    expect(conRespaldoPropio(undefined)).toBe(TARJETAS_PROPIAS);
  });

  it("una respuesta sin tarjetas (sólo efectivo, por ejemplo) también cae al respaldo", () => {
    const soloEfectivo = tarjetasDeMercadoPago([medio("rapipago", "Rapipago", "ticket")]);
    expect(conRespaldoPropio(soloEfectivo)).toBe(TARJETAS_PROPIAS);
  });
});

describe("el respaldo con Payway", () => {
  it("sin Mercado Pago, Payway muestra sus cuatro marcas con logo propio", () => {
    const t = tarjetasPayway(conRespaldoPropio(SIN_TARJETAS));
    expect(t.credito.map((x) => x.nombre)).toEqual(["Visa", "Mastercard", "American Express", "Cabal"]);
    expect(t.debito.map((x) => x.nombre)).toEqual(["Visa Débito", "Mastercard Débito", "Cabal Débito"]);
    for (const x of [...t.credito, ...t.debito]) expect(x.logo).toMatch(/^\/images\/tarjetas\//);
  });

  it("tarjetasPayway sin datos de Mercado Pago (undefined o vacío) usa los logos propios", () => {
    expect(tarjetasPayway(undefined)).toEqual(tarjetasPayway(TARJETAS_PROPIAS));
    expect(tarjetasPayway(SIN_TARJETAS)).toEqual(tarjetasPayway(TARJETAS_PROPIAS));
  });

  it("con las de Mercado Pago, Payway usa sus logos y completa las marcas que faltan con los propios", () => {
    const mp = tarjetasDeMercadoPago([medio("visa", "Visa", "credit_card"), medio("debvisa", "Visa Débito", "debit_card")]);
    const t = tarjetasPayway(mp);
    expect(t.credito.map((x) => x.logo)[0]).toBe("https://img.example/visa.gif");
    expect(t.debito.map((x) => x.logo)[0]).toBe("https://img.example/debvisa.gif");
    expect(t.credito).toHaveLength(4);
    expect(t.debito).toHaveLength(3);
  });
});
