/**
 * Página Envíos y pagos: el contenido sale de la configuración de envío del CRM
 * (`ConfigEnvio`, texto con `textoRegla`), de los medios de pago activos del CRM por modalidad
 * (`medios_pago_shop`) y del flag `cuotas`, que resuelve la página en el server. Nada de texto fijo
 * duplicado: si cambian el alcance, el mínimo o los medios, la página se acomoda sola.
 */
import {
  ENTREGA_LABEL,
  PAGO_LABEL,
  textoRegla,
  type ConfigEnvio,
  type EntregaTipo,
} from "@/lib/envio";
import { SLUG_MERCADOPAGO, mediosParaModalidad, type MedioPago } from "@/lib/medios-pago";
import { fmtPesosEnteros } from "@/lib/format";
import type { MetodoEnvio } from "@/lib/envio-zona";
import type { Bloque } from "./comun";

function listar(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

const conPunto = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);

/**
 * Un párrafo por método de envío por zona activo (flag `envio-por-zona`; sin él `envio.metodos` no existe):
 * nombre, localidades que atiende, tarifa de cada zona, la promesa y el aviso de feriados que cargó el comercio.
 * Sin geometría: sólo nombres y precios. Vacío si no hay métodos activos con zonas.
 */
function parrafosMetodos(metodos: readonly MetodoEnvio[] | undefined): string[] {
  return (metodos ?? [])
    .filter((m) => m.activo && m.zonas.some((z) => z.activa))
    .sort((a, b) => a.orden - b.orden)
    .map((m) => {
      const vistas = new Set<string>();
      const zonas = m.zonas
        .filter((z) => z.activa)
        .sort((a, b) => a.precio - b.precio)
        .filter((z) => (vistas.has(z.nombre) ? false : (vistas.add(z.nombre), true)))
        .map((z) => `${z.nombre}: ${fmtPesosEnteros(z.precio)}`);
      const lugares = [
        ...new Set((m.localidades ?? []).map((l) => (l.etiqueta ?? "").split(" — ")[0].trim()).filter(Boolean)),
      ];
      const donde = lugares.length ? ` a ${listar(lugares)}` : "";
      // Con sucursal de origen, el método sólo vale si el pedido sale completo de ese local (como al cobrarlo).
      const origen = m.sucursalOrigen
        ? "Vale para pedidos con todos sus productos disponibles en el local que despacha; si alguno hay que traerlo de otra sucursal, el envío se coordina aparte"
        : "";
      return [`${m.nombre}${donde}. ${conPunto(listar(zonas))}`, m.promesa.trim(), m.avisoFeriados.trim(), origen]
        .filter(Boolean)
        .map(conPunto)
        .join(" ");
    });
}

const PAGO_A_COORDINAR = `${PAGO_LABEL.a_coordinar}: una vez confirmado el pedido, el comercio se comunicará con usted para acordar el medio de pago.`;

/** Nombres de los medios que aplican a la modalidad; vacío si ninguno. */
function mediosDe(tipo: EntregaTipo, medios: readonly MedioPago[]): string {
  return listar(mediosParaModalidad(medios, tipo).map((m) => m.nombre));
}

/**
 * `medios`: los activos del CRM que el Shop puede ofrecer (sin Mercado Pago si faltan credenciales).
 * Sin medios aplicables a ninguna modalidad, el pago se coordina con un asesor.
 */
export function bloquesEnviosYPagos(ctx: { envio: ConfigEnvio; medios: readonly MedioPago[]; cuotas: boolean }): Bloque[] {
  const metodos = parrafosMetodos(ctx.envio.metodos);
  const entregas: Bloque = ctx.envio.domicilioActivo
    ? {
        titulo: "Entregas",
        parrafos: metodos.length
          ? [
              ...metodos,
              `Otros destinos: ${textoRegla(ctx.envio)}`,
              `En esos casos, una vez confirmado el pedido, el comercio se comunicará con usted para coordinar la entrega.`,
            ]
          : [
              `${ENTREGA_LABEL.envio}: ${textoRegla(ctx.envio)}`,
              `Una vez confirmado el pedido, el comercio se comunicará con usted para coordinar la entrega.`,
            ],
      }
    : {
        titulo: "Entregas",
        parrafos: [
          `Por el momento, la única opción de entrega es «${ENTREGA_LABEL.retiro}»: el envío a domicilio no está disponible.`,
        ],
      };

  const modalidades: EntregaTipo[] = ctx.envio.domicilioActivo ? ["retiro", "envio"] : ["retiro"];
  const hayMedios = modalidades.some((t) => mediosParaModalidad(ctx.medios, t).length > 0);
  const conMp = modalidades.some((t) =>
    mediosParaModalidad(ctx.medios, t).some((m) => m.slug === SLUG_MERCADOPAGO),
  );

  const pagos: Bloque = hayMedios
    ? {
        titulo: "Medios de pago",
        parrafos: [
          ...modalidades.map((t) => {
            const lista = mediosDe(t, ctx.medios);
            const cuando = `Con ${ENTREGA_LABEL[t].toLowerCase()}`;
            return lista ? `${cuando}: ${lista}.` : `${cuando}: el pago se coordina con un asesor una vez confirmado el pedido.`;
          }),
          ...(ctx.cuotas && conMp
            ? ["Con tarjeta de crédito, las cuotas sin interés disponibles para su tarjeta se eligen al ingresarla, antes de pagar."]
            : []),
        ],
      }
    : { titulo: "Medios de pago", parrafos: [PAGO_A_COORDINAR] };

  return [entregas, pagos];
}
