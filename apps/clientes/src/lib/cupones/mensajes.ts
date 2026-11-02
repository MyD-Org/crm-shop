// Textos al comprador de los cupones (tabla "Mensajes de error" del spec 2026-11-01-cupones-design.md).
// En usted. Puro: lo usan el servidor (cotización, pedido) y el navegador.
import { nombreProvincia } from "../envio";
import { fmtPrecioCorto } from "../format";
import type { MotivoCupon, OpcionCupon, PromocionCupon } from "./tipos";

const OFFSET_AR_MS = -3 * 3_600_000;

/** Nombres de los medios del sistema cuando no llegan los de la base. */
const NOMBRES_MEDIO: Record<string, string> = {
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  mercadopago: "Mercado Pago",
  payway: "Payway",
  a_coordinar: "A coordinar",
};

const NOMBRES_FORMA: Record<string, string> = {
  credito: "tarjeta de crédito",
  debito: "tarjeta de débito",
  cuenta_mp: "cuenta de Mercado Pago",
};

/** "12/11 a las 23:59" en hora de Argentina (-03:00, sin horario de verano). */
export function fechaHoraAr(iso: string): string {
  const local = new Date(new Date(iso).getTime() + OFFSET_AR_MS).toISOString();
  return `${local.slice(8, 10)}/${local.slice(5, 7)} a las ${local.slice(11, 16)}`;
}

function listar(items: readonly string[], conector: string): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${conector} ${items[items.length - 1]}`;
}

const nombreMedio = (slug: string, nombres?: Record<string, string>) =>
  nombres?.[slug] ?? NOMBRES_MEDIO[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);

type DatosPromo = Partial<Pick<PromocionCupon, "inicio" | "minimo" | "medios" | "formas" | "permiteCuotas" | "provinciasEnvio">>;

/** "pagando con Transferencia", "con tarjeta de débito", "en 1 pago": la restricción que falló. */
function condicionPago(p: DatosPromo, nombres?: Record<string, string>, opcion?: OpcionCupon): string {
  const medioFalla = p.medios && (!opcion || !p.medios.includes(opcion.slug));
  const formaFalla = p.formas && (!opcion || (opcion.forma !== null && !p.formas.includes(opcion.forma)));
  const partes: string[] = [];
  if (medioFalla) partes.push(`pagando con ${listar(p.medios!.map((m) => nombreMedio(m, nombres)), "o")}`);
  else if (formaFalla) partes.push(`con ${listar(p.formas!.map((f) => NOMBRES_FORMA[f] ?? f), "o")}`);
  else if (opcion?.cuotasSinInteres && !p.permiteCuotas) partes.push("en 1 pago");
  return partes.join(" ") || "con otro medio de pago";
}

export function mensajeCupon(
  motivo: MotivoCupon,
  p?: DatosPromo,
  nombresMedios?: Record<string, string>,
  opcion?: OpcionCupon,
): string {
  switch (motivo) {
    case "no_existe":
      return "El código no es válido. Revíselo e inténtelo de nuevo.";
    case "vencido":
      return "Este cupón venció.";
    case "no_empezo":
      return p?.inicio ? `Este cupón se puede usar desde el ${fechaHoraAr(p.inicio)}.` : "Este cupón todavía no se puede usar.";
    case "usado":
      return "Este cupón ya fue usado.";
    case "no_primera_compra":
      return "Este cupón es sólo para la primera compra en la tienda.";
    case "minimo":
      return `Este cupón requiere una compra mínima de ${fmtPrecioCorto(p?.minimo ?? 0)}.`;
    case "todo_en_campania":
      return "Los productos de su carrito ya tienen precio promocional: el cupón no se suma.";
    case "sin_sesion":
      return "Para usar un cupón, inicie sesión con su cuenta de la tienda.";
    case "opcion_no_elegible":
      return `Su cupón es válido sólo ${condicionPago(p ?? {}, nombresMedios, opcion)}.`;
    case "lista_privada":
      return "Su cuenta tiene precios propios: este cupón no aplica.";
    case "agotado":
      return "Se agotaron los cupones de esta promoción.";
    case "solo_envio": {
      const zonas = p?.provinciasEnvio?.length ? p.provinciasEnvio.map(nombreProvincia) : null;
      return zonas
        ? `Este cupón es de envío gratis a ${listar(zonas, "y")}: elija envío a domicilio a esa zona para usarlo.`
        : "Este cupón es de envío gratis: elija envío a domicilio para usarlo.";
    }
    case "no_disponible":
      return "No pudimos validar el cupón. Inténtelo de nuevo en un momento.";
  }
}
