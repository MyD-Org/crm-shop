import { Suspense } from "react";
import { connection } from "next/server";
import { lineasEnviarA, opcionVigente } from "@/lib/enviar-a";
import { ubicacionDelVisitante } from "@/lib/ubicacion-servidor";
import { EnviarAContenido } from "./EnviarAContenido";
import { SelectorUbicacion } from "./SelectorUbicacion";

/**
 * "Enviar a" bajo el logo del encabezado (slot `brandExtra` del Header del DS): dos líneas
 * ("Enviar a {nombre}" / "{calle altura}", "Enviar a" / "{localidad} ({CP})", "Enviar a" /
 * "Indique su ubicación" o, en retiro, ícono de local + "Retirar en" / "{local}"). Al tocarlo abre
 * el modal "Seleccione dónde recibir su compra", que se descarga recién en ese momento.
 *
 * Va en el shell estático con un hueco por request: mientras llega reserva el alto de las dos
 * líneas (`h-8`) para que no salte. El header no trae la lista de direcciones: la pide el modal.
 */
const BOTON = "inline-flex max-w-48 items-center rounded-sm text-left transition-colors hover:text-text sm:max-w-64";
const ALTO = "h-8";

export function UbicacionHeader() {
  return (
    <Suspense fallback={<div aria-hidden className={ALTO} />}>
      <UbicacionDinamica />
    </Suspense>
  );
}

async function UbicacionDinamica() {
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
      className={BOTON}
    >
      <EnviarAContenido lineas={lineasEnviarA(eleccion, nombrePila)} />
    </SelectorUbicacion>
  );
}
