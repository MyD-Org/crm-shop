import { describe, expect, it } from "vitest";
import { codigoPaisGeocode, idiomaGeocode } from "./geocode-pais";

describe("codigoPaisGeocode", () => {
  it("mapea los países que factura la tienda", () => {
    expect(codigoPaisGeocode("AR")).toBe("ar");
    expect(codigoPaisGeocode("BR")).toBe("br");
    expect(codigoPaisGeocode("py")).toBe("py");
  });

  it("sin país o con uno desconocido, Argentina", () => {
    expect(codigoPaisGeocode(null)).toBe("ar");
    expect(codigoPaisGeocode("")).toBe("ar");
    expect(codigoPaisGeocode("CL")).toBe("ar");
  });
});

describe("idiomaGeocode", () => {
  it("portugués sólo para Brasil", () => {
    expect(idiomaGeocode("BR")).toBe("pt");
    expect(idiomaGeocode("PY")).toBe("es");
    expect(idiomaGeocode(null)).toBe("es");
  });
});
