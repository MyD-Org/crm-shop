import { connection } from "next/server";
import { lineasEnviarA, opcionVigente } from "@/lib/enviar-a";
import { ubicacionDelVisitante } from "@/lib/ubicacion-servidor";
import { EnviarAContenido } from "./EnviarAContenido";
import { SelectorUbicacion } from "./SelectorUbicacion";

/**
 * "Enviar a" del encabezado. En desktop va en las acciones, a la izquierda del usuario: dos líneas
 * ("Enviar a {nombre}" / "{calle altura}", "Enviar a" / "{localidad} ({CP})", "Enviar a" /
 * "Indique su ubicación" o, en retiro, ícono de local + "Retirar en" / "{local}"). Al tocarlo abre
 * el modal "Seleccione dónde recibir su compra", que se descarga recién en ese momento. En mobile
 * (`enLinea`) es una línea debajo del buscador (ver HeaderUI).
 *
 * Bajo el logo (slot `brandExtra` del DS) se salía del alto fijo del header en desktop y se
 * comía el padding: por eso va en las acciones.
 *
 * Dos piezas: `UbicacionReserva` va en el header de reserva (shell estático) y sólo guarda el alto
 * de las dos líneas (`h-8`) para que no salte; `UbicacionHeader` va dentro del hueco por request del
 * header y se resuelve con él. Sin `<Suspense>` propio a propósito: el mismo Suspense en la reserva y
 * en el header real reusaba ids de boundary entre el shell y el resume, la respuesta del real se
 * perdía y React tiraba el error #419. El header no trae la lista de direcciones: la pide el modal.
 */
const BOTON = "inline-flex max-w-48 items-center rounded-sm text-left transition-colors hover:text-text xl:max-w-56";
const BOTON_EN_LINEA = "inline-flex max-w-full items-center rounded-sm text-left";
const ALTO = "h-8";
const ALTO_EN_LINEA = "h-4";

export function UbicacionReserva({ enLinea = false }: { enLinea?: boolean }) {
  return <div aria-hidden className={enLinea ? ALTO_EN_LINEA : ALTO} />;
}

export async function UbicacionHeader({ enLinea = false }: { enLinea?: boolean }) {
  // Lee cookie e identidad: hueco por request.
  await connection();
  const { ubicacion, origen, eleccion, nombrePila } = await ubicacionDelVisitante();
  // Envío a una localidad de Georef (sin dirección guardada): el modal la ofrece precargada.
  const localidadActual =
    eleccion.tipo === "envio" && !eleccion.direccion && ubicacion?.id
      ? { id: ubicacion.id, etiqueta: ubicacion.localidad, cp: ubicacion.cp }
      : undefined;
  return (
    <SelectorUbicacion
      conUbicacion={origen === "cookie"}
      vigente={opcionVigente(eleccion)}
      localidadActual={localidadActual}
      className={enLinea ? BOTON_EN_LINEA : BOTON}
    >
      <EnviarAContenido lineas={lineasEnviarA(eleccion, nombrePila)} enLinea={enLinea} />
    </SelectorUbicacion>
  );
}
