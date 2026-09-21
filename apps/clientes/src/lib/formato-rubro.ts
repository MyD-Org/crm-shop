/**
 * Formateo de rubros para mostrar. El dato fuente (Alegra) viene en
 * MAYÚSCULAS sin acentos —"ELECTRICIDAD", "ILUMINACION"— y en el diseño se
 * leen como título normal: "Electricidad", "Iluminación".
 *
 * Sólo display: el valor crudo sigue siendo el que viaja en URLs, filtros
 * y matching (ver src/lib/catalogo-url.ts).
 */

/** Acentos que el dato fuente pierde al venir en mayúsculas sin tildes. */
const ACENTOS: Record<string, string> = {
  iluminacion: "iluminación",
  lampara: "lámpara",
  lamparas: "lámparas",
  electricidad: "electricidad",
  automaticacion: "automatización",
  automatizacion: "automatización",
  fuente: "fuente",
  fuentes: "fuentes",
  colgante: "colgante",
  velador: "velador",
  exterior: "exterior",
  interior: "interior",
};

/** Siglas y códigos que se leen en mayúscula aunque el rubro se formatee. */
const ACRONIMOS = new Set([
  "led",
  "wifi",
  "wi-fi",
  "ip",
  "rgb",
  "usb",
  "e27",
  "gu10",
  "mr16",
  "12v",
  "24v",
  "220v",
  "t8",
  "t5",
]);

/** ¿Viene (casi) todo en mayúsculas? Si no, el label ya es presentable. */
function esMayusculaSostenida(rubro: string): boolean {
  const letras = rubro.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]/g, "");
  if (!letras) return false;
  const mayusculas = letras.replace(/[^A-ZÁÉÍÓÚÑÜ]/g, "");
  return mayusculas.length / letras.length >= 0.8;
}

export function formatRubro(rubro: string): string {
  if (!esMayusculaSostenida(rubro)) return rubro;
  return rubro
    .split(/\s+/)
    .filter(Boolean)
    .map((palabra) => {
      const baja = palabra.toLowerCase();
      if (ACRONIMOS.has(baja)) return baja.toUpperCase();
      const conAcento = ACENTOS[baja] ?? baja;
      return conAcento.charAt(0).toUpperCase() + conAcento.slice(1);
    })
    .join(" ");
}
