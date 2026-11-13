import { describe, expect, it } from "vitest";
import { urlGeocode } from "./DireccionAutocomplete";

describe("urlGeocode", () => {
  it("sin localidad es la URL de siempre", () => {
    expect(urlGeocode("Av. Colón 2500", "AR")).toBe("/api/geocode?text=Av.%20Col%C3%B3n%202500&pais=AR");
    expect(urlGeocode("Av. Colón 2500", "AR", "  ", "Buenos Aires")).toBe("/api/geocode?text=Av.%20Col%C3%B3n%202500&pais=AR");
  });

  it("con localidad y provincia las manda para acotar", () => {
    const u = new URL(urlGeocode("Colón 2500", "AR", "Mar del Plata", "Buenos Aires"), "http://localhost");
    expect(u.searchParams.get("ciudad")).toBe("Mar del Plata");
    expect(u.searchParams.get("provincia")).toBe("Buenos Aires");
  });

  it("con localidad y sin provincia manda sólo la localidad", () => {
    const u = new URL(urlGeocode("Colón 2500", "AR", "Mar del Plata"), "http://localhost");
    expect(u.searchParams.get("ciudad")).toBe("Mar del Plata");
    expect(u.searchParams.has("provincia")).toBe(false);
  });
});
