"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Field, Input, Select, Spinner } from "@myd-org/ui";
import { useCart } from "@/context/CartContext";
import { useCotizacion } from "@/hooks/useCotizacion";
import { COPY_CARRITO } from "@/lib/carrito-cliente";
import { PagoMercadoPago } from "@/components/PagoMercadoPago";
import { SelectorDireccionEnvio } from "@/components/SelectorDireccionEnvio";
import { AvisoVincular } from "@/components/mi-cuenta/AvisoVincular";
import { eleccionInicial, entregaElegida, type DireccionEnvio } from "@/lib/direcciones-envio";
import { fmtPrecio } from "@/lib/format";
import { CompletarFacturacionDialog } from "@/components/checkout/CompletarFacturacionDialog";
import type { PerfilFacturacionUI } from "@/components/FacturacionForm";
import {
  estadoFacturacionCheckout,
  hayTelefonoParaPedido,
  type CampoFacturacion,
  type Complemento,
} from "@/lib/contacto-alegra";
import type { DatosDelContactoPublico } from "@/lib/datos-del-contacto";
import { CuotasResumen } from "@/components/CuotasResumen";
import { resumenCuotas } from "@/lib/cuotas-exhibicion";
import { TEXTOS_CUOTAS } from "@/lib/cuotas-textos";
import type { OfertaCuotas } from "@/lib/pagos/cuotas-tipos";
import {
  CIUDADES_ENVIO,
  PAGO_LABEL,
  pagosDisponibles,
  type EntregaTipo,
  type PagoMetodo,
} from "@/lib/envio";

/*
 * Entrada de la pantalla de éxito (momento único por compra: acá sí va algo de
 * festejo). `starting:` es @starting-style: anima al montar sin JS, y el
 * navegador que no lo soporta muestra todo quieto. El check entra con un leve
 * rebote y el texto sube escalonado 60 ms; con reduced motion, sólo fade.
 * Strings literales para que Tailwind las genere.
 */
const POP_EXITO =
  "transition-[opacity,scale] duration-[400ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] starting:scale-[0.6] starting:opacity-0 motion-reduce:starting:scale-100";
const ENTRADA_EXITO =
  "transition-[opacity,translate] duration-[250ms] ease-[cubic-bezier(0.23,1,0.32,1)] starting:translate-y-2 starting:opacity-0 motion-reduce:starting:translate-y-0";

function CheckCircleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

function RadioCard({
  selected,
  onClick,
  title,
  description,
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full cursor-pointer items-start gap-3 rounded-[20px] p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
        selected
          ? "border-[1.5px] border-accent bg-surface shadow-2"
          : "border border-border bg-surface hover:border-accent"
      }`}
    >
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          selected ? "border-primary bg-primary text-white" : "border-border"
        }`}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-white" />}
      </span>
      <span>
        <span className="block text-sm font-semibold text-text">{title}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
    </button>
  );
}

/**
 * Qué le pasa al comprador con cada medio. Es un mapa y no un ternario porque
 * antes lo era: `transferencia` tenía su texto y TODO el resto heredaba "pagás
 * al momento del retiro", así que al sumar Mercado Pago la tarjeta decía que se
 * pagaba después. Con un Record, agregar un medio sin su texto no compila.
 */
const DESCRIPCION_PAGO: Record<PagoMetodo, string> = {
  transferencia: "Te pasamos el CBU al confirmar el pedido",
  efectivo: "Pagás al momento del retiro",
  cuenta_corriente: "Se carga a tu cuenta corriente",
  mercadopago: "Pagás ahora con tarjeta, en cuotas si querés",
  // Hoy no se llega a mostrar: con los pagos apagados no hay sección "Forma de
  // pago". Está porque el Record exige un texto por método.
  a_coordinar: "Un asesor coordinará el pago con usted después de confirmar su pedido",
};

/**
 * Aviso del checkout cuando los pagos están apagados: reemplaza a la sección
 * "Forma de pago". El comprador tiene que saber ANTES de confirmar que no va a
 * pagar ahora ni elegir cómo.
 */
const AVISO_PAGO_A_COORDINAR =
  "El pago se coordina con un asesor después de confirmar su pedido.";

interface Props {
  nombreSugerido: string;
  /**
   * Teléfono precargado: el de Alegra del vinculado (`facturacion.telefonoAlegra`,
   * no hace falta tipearlo) o el guardado en Mis datos. Vacío = se pide acá; el
   * perfil lo aprende y, si Alegra no tiene ninguno, se sube a Alegra.
   */
  telefonoSugerido?: string;
  emailCliente?: string;
  /**
   * Datos de facturación de la lectura única (`datosDelContacto`): vinculado ⇒
   * espejo de Alegra; no vinculado ⇒ perfil. Sin `completo` no se puede
   * emitir la factura: se ofrece cargar lo que falta en un modal.
   */
  facturacion: DatosDelContactoPublico;
  /** Perfil del no vinculado, para precargar el formulario del modal. */
  perfilFacturacion?: PerfilFacturacionUI | null;
  /**
   * El comprador factura con documento argentino. Solo se envía dentro de
   * Argentina: al resto se le ofrece únicamente el retiro. El servidor lo
   * vuelve a controlar al crear el pedido.
   */
  admiteEnvio: boolean;
  /**
   * Flag de envío (src/lib/envio-flag.ts) resuelto en el server. Apagado: sólo
   * se ofrece el retiro / entrega a coordinar, sin importar `admiteEnvio`.
   */
  envioHabilitado: boolean;
  /** Oferta de cuotas resuelta en el server. null = no se muestran cuotas. */
  oferta?: OfertaCuotas | null;
  /**
   * Flag de pagos (src/lib/pagos-flag.ts) resuelto en el server: acá llega el booleano, nunca el
   * env. Apagado: no hay "Forma de pago", el pedido sale con "a_coordinar", no
   * se rescata ningún pendiente de Mercado Pago y nunca se entra al cobro. El
   * servidor valida lo mismo al crear el pedido. Prendido: el checkout de antes.
   */
  pagosHabilitados: boolean;
  /**
   * Direcciones de envío guardadas en Mi cuenta (sólo con Clerk; la
   * predeterminada primero). Vacío = el checkout de siempre: anónimos no
   * llegan acá y la cookie del CRM sin Clerk no guarda direcciones.
   */
  direccionesGuardadas?: DireccionEnvio[];
  /**
   * El documento de facturación ya es de un cliente de Alegra y la cuenta no
   * está vinculada: se recomienda vincular antes de confirmar. Si confirma
   * igual, el pedido sale con `requiereRevision`.
   */
  sugerirVincular?: boolean;
}

export function CheckoutClient({
  nombreSugerido,
  telefonoSugerido = "",
  emailCliente,
  facturacion,
  perfilFacturacion = null,
  admiteEnvio,
  envioHabilitado,
  oferta = null,
  pagosHabilitados,
  direccionesGuardadas = [],
  sugerirVincular = false,
}: Props) {
  const { items, vaciarTrasPedido, ready } = useCart();

  const [pago, setPago] = useState<PagoMetodo>("transferencia");
  const [entrega, setEntrega] = useState<EntregaTipo>("retiro");
  const [ciudad, setCiudad] = useState("");
  const [direccion, setDireccion] = useState("");
  // Envío a domicilio arranca con la predeterminada. `ciudad` y `direccion`
  // quedan para "otra dirección para esta compra", que no toca las guardadas.
  const [eleccionDireccion, setEleccionDireccion] = useState(() =>
    eleccionInicial(direccionesGuardadas),
  );
  // Ciudad y dirección que viajan a la cotización y al pedido. La zona de envío
  // sigue decidiéndose en `evaluarEnvio` (src/lib/envio.ts): una guardada fuera
  // de zona llega con su ciudad y se rechaza igual que hoy.
  const {
    ciudad: ciudadEntrega,
    direccion: direccionEntrega,
    guardada,
    fueraDeZona: guardadaFueraDeZona,
  } = entregaElegida(direccionesGuardadas, eleccionDireccion, { ciudad, direccion });
  const [nombre, setNombre] = useState(nombreSugerido);
  const [telefono, setTelefono] = useState(telefonoSugerido);
  const [notas, setNotas] = useState("");

  // Facturación: el modal de datos que faltan y, si Alegra no respondió al
  // guardarlos (sólo cookie del CRM), lo cargado viaja con el pedido.
  const [modalFacturacion, setModalFacturacion] = useState(false);
  const [complementoFacturacion, setComplementoFacturacion] = useState<Complemento | null>(null);
  // Faltantes que devolvió un 409 del servidor (más frescos que los de la página).
  const [faltantes409, setFaltantes409] = useState<CampoFacturacion[] | null>(null);
  const facturacionVista = faltantes409
    ? { ...facturacion, completo: false, faltantes: faltantes409 }
    : facturacion;
  const estadoFacturacion = estadoFacturacionCheckout({
    completo: facturacionVista.completo,
    fuente: facturacionVista.fuente,
    complemento: complementoFacturacion,
  });
  const facturacionCompleta = estadoFacturacion.puedeConfirmar;

  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  /**
   * El pedido ya existe en la base. Se guarda el total además del número porque
   * el brick necesita un monto para mostrar, y traer los pedidos completos por
   * cada render sería innecesario.
   */
  const [confirmado, setConfirmado] = useState<{
    numero: string;
    id: string;
    total: number;
    /** Máximo de cuotas congelado en el pedido. null = sin límite propio (flag off o legacy). */
    cuotasMax: number | null;
  } | null>(null);
  const [pagado, setPagado] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [errorCancelar, setErrorCancelar] = useState<string | null>(null);
  /**
   * Mientras se busca un pedido pendiente para retomar. Como el carrito se
   * vacía al crear el pedido (también con Mercado Pago impago), quien vuelve a
   * pagar llega con el carrito vacío: sin esta espera vería "carrito vacío"
   * un instante antes de la pantalla de pago.
   */
  const [buscandoPendiente, setBuscandoPendiente] = useState(pagosHabilitados);
  /**
   * Al montar, se chequea si hay un pedido pendiente reciente de este comprador
   * (ver `pedidoPendienteMasReciente` en pedidos.ts). Sin este atajo, quien
   * vuelve al checkout después de abandonar el pago crearía un pedido-fantasma
   * nuevo. Solo se dispara una vez; mientras carga, el checkout con productos
   * se ve normal y el carrito vacío espera (ver `buscandoPendiente`).
   */
  useEffect(() => {
    // Sin cobros no hay nada que retomar: el rescate fuerza el método a Mercado
    // Pago y salta al cobro, justo lo que el flag apagado tiene que impedir.
    if (!pagosHabilitados) return;
    let cancelado = false;
    fetch("/api/pedidos/pendiente")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelado || !data?.pedido) return;
        setConfirmado({
          numero: data.pedido.numero,
          id: data.pedido.id,
          total: data.pedido.total,
          cuotasMax: typeof data.pedido.cuotasMax === "number" ? data.pedido.cuotasMax : null,
        });
        setPago("mercadopago");
      })
      .catch(() => {
        // Silencioso: fallar en la detección solo lleva al flujo normal, no
        // rompe nada.
      })
      .finally(() => {
        if (!cancelado) setBuscandoPendiente(false);
      });
    return () => {
      cancelado = true;
    };
  }, [pagosHabilitados]);

  /**
   * Clave del intento de compra. Se genera en el PRIMER confirmar y se reusa en
   * cada reintento, que es lo que la vuelve útil.
   *
   * El caso que resuelve no es el doble clic —eso ya lo tapa el botón
   * deshabilitado— sino el peor: el POST llega, el pedido se crea, y la
   * respuesta se pierde. Abajo eso se muestra como "no pudimos conectarnos", el
   * cliente reintenta, y sin esta clave quedan dos pedidos por una sola compra.
   *
   * En un `ref` y no en `useState` porque cambiarla no tiene que repintar nada.
   * Se genera acá y no en el render para no llamar a `crypto` durante el SSR.
   */
  const claveIntento = useRef<string | null>(null);

  const { cotizacion, estado, error, recotizar } = useCotizacion({
    entregaTipo: entrega,
    ciudad: entrega === "envio" ? ciudadEntrega : undefined,
    // Una vez confirmado el carrito queda vacío: no tiene sentido recotizar.
    activo: !confirmado,
  });

  // Con los pagos apagados esto es ["a_coordinar"], así que `pagoElegido` (abajo)
  // deriva a "a_coordinar" sin estado extra y la rama de Mercado Pago queda
  // inalcanzable.
  const metodosPago = pagosDisponibles(entrega, pagosHabilitados);

  // Efectivo solo existe con retiro. Si el cliente lo eligió y después pasó a
  // envío, el método se corrige DERIVÁNDOLO en el render — no sincronizando el
  // estado desde un efecto, que agrega un render de más y un frame donde el
  // formulario muestra una opción que el servidor va a rechazar.
  const pagoElegido: PagoMetodo = metodosPago.includes(pago) ? pago : metodosPago[0];

  const envioDisponible = cotizacion?.envio.disponible ?? false;
  const datosCompletos =
    nombre.trim() !== "" &&
    hayTelefonoParaPedido(telefono, facturacion.telefonoAlegra) &&
    (entrega === "retiro" || (ciudadEntrega !== "" && direccionEntrega.trim() !== ""));

  const puedeConfirmar =
    estado === "ok" &&
    !!cotizacion &&
    !cotizacion.hayProblemas &&
    cotizacion.lineas.length > 0 &&
    datosCompletos &&
    facturacionCompleta &&
    (entrega === "retiro" || envioDisponible) &&
    !enviando;

  async function confirmar() {
    setEnviando(true);
    setErrorEnvio(null);

    // `randomUUID` pide contexto seguro (https o localhost). Si no está, se
    // manda sin clave: se pierde la protección contra el duplicado, pero la
    // compra sigue andando. Romper el checkout sería peor que el problema.
    if (!claveIntento.current) {
      claveIntento.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : null;
    }

    try {
      const res = await fetch("/api/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: claveIntento.current ?? undefined,
          items: items.map((i) => ({ id: i.id, qty: i.qty })),
          contactoNombre: nombre,
          contactoTelefono: telefono,
          entregaTipo: entrega,
          entregaCiudad: entrega === "envio" ? ciudadEntrega : undefined,
          entregaDireccion: entrega === "envio" ? direccionEntrega : undefined,
          pagoMetodo: pagoElegido,
          notas,
          complementoFacturacion: complementoFacturacion ?? undefined,
        }),
      });

      const json = await res.json();

      if (res.status === 409 && json?.motivo === "facturacion_incompleta") {
        // Faltan datos de facturación (p. ej. cambiaron en Alegra): se abre el
        // modal con lo que falta, sin recotizar.
        setErrorEnvio(json.error ?? "Cargue sus datos de facturación para continuar.");
        setComplementoFacturacion(null);
        setFaltantes409(Array.isArray(json.faltantes) ? json.faltantes : facturacion.faltantes);
        setModalFacturacion(true);
        return;
      }
      if (res.status === 409 && json?.motivo === "facturacion_no_disponible") {
        setErrorEnvio(json.error);
        return;
      }
      if (res.status === 409) {
        // El servidor recotizó y algo cambió. Se refresca la vista para que el
        // cliente vea QUÉ cambió en vez de un error suelto.
        setErrorEnvio(json?.error ?? "El pedido cambió. Revíselo.");
        recotizar();
        return;
      }
      if (!res.ok) {
        setErrorEnvio(json?.error ?? "No pudimos registrar el pedido.");
        return;
      }

      // El pedido ya existe: el carrito se vacía para TODOS los medios de
      // pago, también Mercado Pago impago. Con sesión de Clerk el servidor ya
      // vació el suyo en la misma transacción que creó el pedido
      // (`crearPedido`); acá sólo se limpia el local. Un pedido de Mercado Pago
      // sin pagar se retoma desde Mis pedidos o volviendo al checkout (el
      // `useEffect` de arriba lo rescata), sin duplicarlo. Cancelarlo NO
      // vuelve a llenar el carrito (decisión 2026-09-24).
      setConfirmado({
        numero: json.numero,
        id: json.id,
        total: json.cotizacion?.total ?? cotizacion?.total ?? 0,
        cuotasMax: typeof json.cuotasMax === "number" ? json.cuotasMax : null,
      });
      vaciarTrasPedido();
    } catch {
      setErrorEnvio("No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  // ------------------------------------------------------- pedido creado, a pagar
  //
  // El pedido YA existe cuando se llega acá (recién creado o rescatado por el
  // useEffect que busca pendientes) y el carrito ya está vacío: esta pantalla
  // no depende de `items`. Si el cobro falla o el comprador se va, el
  // pendiente se reutiliza en vez de crear uno nuevo.
  async function cancelarYVolver() {
    if (!confirmado) return;
    setCancelando(true);
    setErrorCancelar(null);
    try {
      const res = await fetch(`/api/pedidos/${confirmado.id}/cancelar`, {
        method: "POST",
      });
      if (res.ok) {
        setConfirmado(null);
        // La `claveIntento` era del pedido cancelado: sin resetearla, el
        // próximo confirmar reutilizaría la clave y traería el pedido viejo.
        claveIntento.current = null;
        return;
      }
      // Un 409 dice por qué no se puede (pago en curso, ya pagado): se muestra.
      // El 404 no desglosa motivos a propósito, así que va el genérico.
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      setErrorCancelar(
        res.status === 409 && json?.error
          ? json.error
          : "No se pudo cancelar el pedido. Inténtelo de nuevo en un momento.",
      );
    } catch {
      setErrorCancelar("No pudimos conectarnos. Revise su conexión e inténtelo de nuevo.");
    } finally {
      setCancelando(false);
    }
  }

  if (confirmado && pagoElegido === "mercadopago" && !pagado) {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-5 px-4 py-10">
        <div className="text-center">
          <h1 className="font-display text-[clamp(30px,3.4vw,46px)] font-medium tracking-tight text-text">
            Pagá tu pedido
          </h1>
          <p className="mt-1 text-sm font-semibold text-text">{confirmado.numero}</p>
        </div>

        {/*
          Plan del pedido sobre su total real, recortado al máximo congelado:
          nunca se promete más de lo que el Brick y la ruta de pago aceptan.
        */}
        <CuotasResumen
          resumen={resumenCuotas(confirmado.total, oferta, { cuotasMax: confirmado.cuotasMax })}
          titulo={TEXTOS_CUOTAS.checkoutTitulo}
        />

        <PagoMercadoPago
          pedidoId={confirmado.id}
          numero={confirmado.numero}
          monto={confirmado.total}
          emailComprador={emailCliente}
          maxCuotas={confirmado.cuotasMax ?? undefined}
          onPagado={() => setPagado(true)}
        />

        <div className="flex flex-col items-center gap-2">
          <p className="text-center text-sm text-muted">{COPY_CARRITO.pagoPendiente}</p>
          <Link href="/mi-cuenta" className="text-sm text-muted underline">
            Prefiero pagarlo después
          </Link>
          <button
            type="button"
            onClick={cancelarYVolver}
            disabled={cancelando}
            className="text-sm text-muted underline disabled:opacity-50"
          >
            {cancelando ? "Cancelando…" : "Modificar el carrito y armar otro pedido"}
          </button>
          {errorCancelar && (
            <p role="alert" className="text-center text-sm text-danger">
              {errorCancelar}
            </p>
          )}
        </div>
      </main>
    );
  }

  // ------------------------------------------------------------------ éxito
  if (confirmado) {
    return (
      <main className="mx-auto flex max-w-lg flex-1 flex-col items-center gap-5 px-4 py-20">
        <div className="w-full rounded-[28px] border border-border bg-surface p-8 text-center">
          <span className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-success ${POP_EXITO}`}>
            <CheckCircleIcon />
          </span>
          <h1 className={`mt-4 text-2xl font-extrabold text-text ${ENTRADA_EXITO} delay-[120ms]`}>
            {pagado ? "¡Pago acreditado!" : "Pedido recibido"}
          </h1>
          <p className={`mt-2 text-sm font-semibold text-text ${ENTRADA_EXITO} delay-[180ms]`}>{confirmado.numero}</p>
          <p className={`mt-3 text-sm text-muted ${ENTRADA_EXITO} delay-[240ms]`}>
            {pagado ? (
              <>
                Ya cobramos tu pedido. Nos comunicamos con vos para coordinar el{" "}
                {entrega === "envio" ? "envío" : "retiro"}.
              </>
            ) : !pagosHabilitados ? (
              // Sin "el pago por …": no hay medio elegido que nombrar.
              <>
                Un asesor se comunicará con usted para coordinar el{" "}
                {entrega === "envio" ? "envío" : "retiro"} y el pago.
              </>
            ) : (
              <>
                Nos vamos a comunicar con vos para coordinar el{" "}
                {entrega === "envio" ? "envío" : "retiro"} y el pago por{" "}
                {PAGO_LABEL[pagoElegido].toLowerCase()}.
              </>
            )}
            {emailCliente &&
              (pagosHabilitados ? (
                <> Te mandamos el detalle a {emailCliente}.</>
              ) : (
                <> Le enviamos el detalle a {emailCliente}.</>
              ))}
          </p>
          <div className={`mt-6 flex justify-center gap-3 ${ENTRADA_EXITO} delay-[300ms]`}>
            <Link href="/mi-cuenta">
              <Button>Ver mis pedidos</Button>
            </Link>
            <Link href="/catalogo">
              <Button variant="secondary">Seguir comprando</Button>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ------------------------------------------ buscando un pedido para retomar
  if (ready && items.length === 0 && buscandoPendiente) {
    return (
      <main className="mx-auto flex max-w-contenido flex-1 flex-col items-center justify-center gap-4 px-4 py-20">
        <Spinner label="Buscando su pedido" />
      </main>
    );
  }

  // ---------------------------------------------------------- carrito vacío
  if (ready && items.length === 0) {
    return (
      <main className="mx-auto flex w-full max-w-contenido flex-1 flex-col items-center justify-center gap-4 px-4 py-20">
        <p className="text-2xl font-bold text-text">Tu carrito está vacío</p>
        <Link href="/catalogo">
          <Button>Ver catálogo</Button>
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-contenido flex-1 px-4 py-8">
      <nav className="mb-6 text-sm text-muted">
        <Link href="/carrito" className="hover:text-primary">Carrito</Link>
        {" / "}
        <span className="text-text">Finalizar pedido</span>
      </nav>

      <h1 className="mb-6 font-display text-[clamp(30px,3.4vw,46px)] font-medium tracking-tight text-text">
        Finalizar pedido
      </h1>

      {sugerirVincular && (
        <div className="mb-6">
          <AvisoVincular volver="/checkout" enCheckout />
        </div>
      )}

      {estadoFacturacion.aviso === "faltan_datos" && (
        <div className="mb-6 rounded-xl border border-warning/40 bg-warning/5 p-4">
          <p className="text-sm font-semibold text-text">
            Faltan sus datos de facturación
          </p>
          <p className="mt-1 text-sm text-muted">
            Los necesitamos para emitirle la factura de esta compra. Se cargan
            una sola vez.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3"
            aria-haspopup="dialog"
            onClick={() => setModalFacturacion(true)}
          >
            Cargar mis datos →
          </Button>
        </div>
      )}
      {estadoFacturacion.aviso === "no_disponible" && (
        <div className="mb-6 rounded-xl border border-warning/40 bg-warning/5 p-4">
          <p className="text-sm text-text">
            No pudimos obtener sus datos de facturación. Inténtelo de nuevo en unos minutos.
          </p>
        </div>
      )}
      <CompletarFacturacionDialog
        abierto={modalFacturacion}
        onOpenChange={(abrir) => {
          setModalFacturacion(abrir);
          // Guardado (o cerrado): la página se relee con los datos nuevos.
          if (!abrir) setFaltantes409(null);
        }}
        facturacion={facturacionVista}
        perfil={perfilFacturacion}
        nombreSugerido={nombreSugerido}
        onEnPedido={(c) => {
          setComplementoFacturacion(c);
          setErrorEnvio(null);
        }}
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
        {/* ------------------------------------------------------ formulario */}
        <div className="space-y-8">
          <section className="rounded-[20px] border border-border/50 bg-surface p-5">
            <h2 className="mb-4 font-display text-2xl font-medium text-text">Datos de contacto</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre y apellido">
                <Input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                />
              </Field>
              <Field
                label="Teléfono"
                hint={
                  facturacion.telefonoAlegra
                    ? "Es el de su cuenta. Puede cambiarlo sólo para esta compra."
                    : undefined
                }
              >
                <Input
                  type="tel"
                  placeholder="+54 376 4000000"
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                />
              </Field>
            </div>
          </section>

          <section className="rounded-[20px] border border-border/50 bg-surface p-5">
            <h2 className="mb-4 font-display text-2xl font-medium text-text">Entrega</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <RadioCard
                selected={entrega === "retiro"}
                onClick={() => setEntrega("retiro")}
                title="Retiro en local / a coordinar"
                description="Retirás en el local o coordinamos la entrega con vos"
              />
              {envioHabilitado && admiteEnvio && (
                <RadioCard
                  selected={entrega === "envio"}
                  onClick={() => setEntrega("envio")}
                  title="Envío a domicilio"
                  description={`Sin cargo a ${CIUDADES_ENVIO.join(" y ")}`}
                />
              )}
            </div>
            {envioHabilitado && !admiteEnvio && (
              <p className="mt-3 text-sm text-muted">
                El envío a domicilio solo está disponible para compradores de Argentina.
              </p>
            )}

            {entrega === "envio" && (
              <>
                {direccionesGuardadas.length > 0 && (
                  <SelectorDireccionEnvio
                    direcciones={direccionesGuardadas}
                    valor={eleccionDireccion}
                    onCambiar={setEleccionDireccion}
                  />
                )}
                {!guardada && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Ciudad">
                    <Select
                      options={CIUDADES_ENVIO.map((c) => ({ label: c, value: c }))}
                      // Siempre controlado: con `undefined` al principio React avisa que el
                      // Select pasa de no controlado a controlado al elegir. Radix muestra
                      // el placeholder igual con "" (lo que no admite "" son las opciones).
                      value={ciudad}
                      onValueChange={setCiudad}
                      placeholder="Seleccionar ciudad"
                      className="border-[1.5px] border-border-strong focus-visible:border-primary focus-visible:ring-0"
                    />
                  </Field>
                  <Field label="Dirección">
                    <Input
                      placeholder="Av. San Martín 1234"
                      value={direccion}
                      onChange={(e) => setDireccion(e.target.value)}
                    />
                  </Field>
                </div>
                )}

                {/* Con una guardada fuera de zona ya se ve el aviso del selector. */}
                {cotizacion && !envioDisponible && cotizacion.envio.motivo && !guardadaFueraDeZona && (
                  <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-xs text-text">
                    <span className="mt-px text-warning"><AlertIcon /></span>
                    {cotizacion.envio.motivo}
                  </p>
                )}
              </>
            )}
          </section>

          {!pagosHabilitados && (
            <section className="rounded-[20px] border border-border/50 bg-surface p-5">
              <h2 className="mb-2 font-display text-2xl font-medium text-text">Pago</h2>
              <p className="text-sm text-muted">{AVISO_PAGO_A_COORDINAR}</p>
            </section>
          )}

          {pagosHabilitados && (
          <section className="rounded-[20px] border border-border/50 bg-surface p-5">
            <h2 className="mb-4 font-display text-2xl font-medium text-text">Forma de pago</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {metodosPago.map((m) => (
                <RadioCard
                  key={m}
                  selected={pagoElegido === m}
                  onClick={() => setPago(m)}
                  title={PAGO_LABEL[m]}
                  description={DESCRIPCION_PAGO[m]}
                />
              ))}
            </div>
            {entrega === "envio" && (
              <p className="mt-3 text-xs text-muted">
                El pago en efectivo solo está disponible si retirás por el local.
              </p>
            )}
          </section>
          )}

          <section className="rounded-[20px] border border-border/50 bg-surface p-5">
            <h2 className="mb-4 font-display text-2xl font-medium text-text">
              Aclaraciones <span className="font-normal text-muted">(opcional)</span>
            </h2>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Horario de entrega, referencia del domicilio, etc."
              className="w-full rounded-sm border-[1.5px] border-border-strong bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:border-primary"
            />
          </section>
        </div>

        {/* --------------------------------------------------------- resumen */}
        <div className="h-fit rounded-[24px] border border-border bg-surface p-6 lg:sticky lg:top-24">
          <h2 className="mb-4 text-base font-bold text-text">Resumen</h2>

          {estado === "cargando" && !cotizacion && (
            <p className="mb-4 text-sm text-muted">Confirmando precios y stock…</p>
          )}

          {estado === "error" && (
            <div className="mb-4 rounded-lg bg-danger/5 p-3 text-xs">
              <p className="text-danger">{error}</p>
              <button onClick={recotizar} className="mt-1 font-semibold text-primary hover:underline">
                Reintentar
              </button>
            </div>
          )}

          <ul className="mb-4 space-y-3">
            {cotizacion?.lineas.map((linea) => (
              <li key={linea.id} className="flex justify-between gap-2 text-sm">
                <span className={linea.problema ? "text-danger" : "text-muted"}>
                  {linea.name}
                  <span className="ml-1 text-xs">x{linea.qty}</span>
                  {linea.problema && (
                    <span className="mt-0.5 block text-xs">{linea.detalle}</span>
                  )}
                </span>
                <span className="shrink-0 font-medium text-text">
                  {linea.problema ? "—" : fmtPrecio(linea.subtotal)}
                </span>
              </li>
            ))}
          </ul>

          <div className="space-y-2 border-t border-border pt-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Subtotal</span>
              <span className="font-medium">{fmtPrecio(cotizacion?.subtotal ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">IVA</span>
              <span className="font-medium">{fmtPrecio(cotizacion?.iva ?? 0)}</span>
            </div>
            {entrega === "envio" && (
              <div className="flex justify-between">
                <span className="text-muted">Envío</span>
                <span className="font-medium text-success">Sin cargo</span>
              </div>
            )}
            <div className="flex justify-between pt-2">
              <span className="font-bold text-text">Total</span>
              <span className="text-lg font-extrabold text-text">
                {fmtPrecio(cotizacion?.total ?? 0)}
              </span>
            </div>
            <p className="text-xs text-muted">
              Precio sin impuestos {fmtPrecio(cotizacion?.subtotal ?? 0)}
            </p>
          </div>

          {pagoElegido === "mercadopago" && estado === "ok" && cotizacion && (
            // Referencia sobre el total cotizado. El máximo definitivo se congela
            // al confirmar, sobre el total real del pedido.
            <CuotasResumen
              resumen={resumenCuotas(cotizacion.total, oferta, { cuotasMax: null })}
              titulo={TEXTOS_CUOTAS.checkoutTitulo}
              className="mt-4"
            />
          )}

          {errorEnvio && (
            <p className="mt-4 rounded-lg bg-danger/5 p-3 text-xs text-danger">{errorEnvio}</p>
          )}

          <Button className="mt-5 w-full" disabled={!puedeConfirmar} onClick={confirmar}>
            {enviando ? "Confirmando…" : "Confirmar pedido"}
          </Button>

          {!puedeConfirmar && !enviando && (
            <p className="mt-2 text-center text-xs text-muted">
              {!facturacionCompleta
                ? "Cargue sus datos de facturación para continuar."
                : cotizacion?.hayProblemas
                  ? "Revise los productos marcados en rojo."
                  : !datosCompletos
                    ? "Complete todos los campos para continuar."
                    : entrega === "envio" && !envioDisponible
                      ? "Revise la opción de envío."
                      : "Confirmando precios y stock…"}
            </p>
          )}

          <p className="mt-3 text-center text-xs text-muted">
            {pagosHabilitados
              ? "No se te cobra nada ahora. Coordinamos el pago al confirmar el pedido."
              : "No se le cobrará nada ahora. Un asesor coordinará el pago con usted."}
          </p>
        </div>
      </div>
    </main>
  );
}
