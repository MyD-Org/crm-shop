"use client";

import { OpcionesCuotas } from "@/components/checkout/OpcionesCuotas";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Checkbox, Field, Input, Select, Spinner, Stepper } from "@myd-org/ui";
import { useCart } from "@/context/CartContext";
import { useCotizacion } from "@/hooks/useCotizacion";
import { pagoParaCotizar } from "@/lib/lista-medio";
import { contenidoDistinto, COPY_CARRITO, type CartItem } from "@/lib/carrito-cliente";
import { PagoMercadoPago } from "@/components/PagoMercadoPago";
import { PagoPayway } from "@/components/PagoPayway";
import { SelectorDireccionEnvio } from "@/components/SelectorDireccionEnvio";
import { PROVINCIAS_SELECTOR, type OpcionesCheckoutSucursales } from "@/lib/zona";
import { VincularClient } from "@/components/VincularClient";
import { OTRA_DIRECCION, entregaDesdeGuardada, entregaElegida, type DireccionEnvio } from "@/lib/direcciones-envio";
import {
  cuerpoDeSincronizacion,
  estadoInicialCheckout,
  sincronizarUbicacion,
  type EleccionInicialCheckout,
  type OpcionEntregaCheckout,
} from "@/lib/checkout-ubicacion";
import { fmtPrecio } from "@/lib/format";
import { CompletarFacturacionDialog } from "@/components/checkout/CompletarFacturacionDialog";
import { FacturacionForm, type PerfilFacturacionUI } from "@/components/FacturacionForm";
import {
  estadoFacturacionCheckout,
  hayTelefonoParaPedido,
  type CampoFacturacion,
  type Complemento,
} from "@/lib/contacto-alegra";
import type { DatosDelContactoPublico } from "@/lib/datos-del-contacto";
import { nombreConMarca } from "@/lib/formato-nombre";
import { formatMarca } from "@/lib/formato-rubro";
import {
  CONDICION_IVA_LABEL,
  TIPO_DOC_LABEL,
  domicilioEnLinea,
  formatearDoc,
  type CondicionIva,
  type DatosFacturacion,
  type TipoDoc,
} from "@/lib/facturacion";
import {
  ENTREGA_LABEL,
  evaluarEnvio,
  type ConfigEnvio,
  type EntregaTipo,
} from "@/lib/envio";
import { provinciaCanonica } from "@/lib/provincias";
import { useAlOcultar } from "@/lib/use-al-ocultar";
import { PedidoContacto } from "@/components/PedidoContacto";
import { ChipsMedioPago } from "@/components/checkout/ChipsMedioPago";
import type { ChipMedio } from "@/lib/medios-pago-chips";
import type { ContactoPedidoVista } from "@/lib/contacto-pedido";
import {
  SLUG_MERCADOPAGO,
  procesadorDeMedio,
  esPagoEnLinea,
  medioElegido,
  mediosParaModalidad,
  pieDelMedio,
  textoPagaConMedio,
  type MedioPago,
} from "@/lib/medios-pago";
import { DisponibilidadLineas, ListaLineas } from "@/components/producto/DisponibilidadLineas";
import { resumenEntregaPedido, type DisponibilidadVista } from "@/lib/disponibilidad-textos";
import { itemDe } from "@/lib/tracking/eventos";
import { track } from "@/lib/tracking/track";
import { InformarPago } from "@/components/mi-cuenta/cuenta-corriente/InformarPago";
import { TEXTO_PLAZO_COMPROBANTE_CHECKOUT } from "@/lib/comprobantes/pedido";
import { rutaIngreso } from "@/lib/ingreso";
import { CuentaTransferencia } from "@/components/CuentaTransferencia";
import { PasoNumerado } from "@/components/PasoNumerado";
import { useAvisarAlSalir } from "@/components/checkout/useAvisarAlSalir";
import { PIE_TRANSFERENCIA } from "@/lib/pie-pago-transferencia";
import { SLUG_TRANSFERENCIA, type CuentaPagoSnapshot } from "@/lib/cuentas-bancarias";
import { precargaDeEntrega, puedeCambiarMedioPago, type EntregaDelPedido } from "@/lib/cambiar-medio-pago";

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

type PasoCheckout = "datos" | "entrega" | "pago";

const PASOS_CHECKOUT: PasoCheckout[] = ["datos", "entrega", "pago"];

/** Facturación ya cargada, en lectura, dentro del paso "Sus datos". */
function ResumenFacturacion({ datos }: { datos: DatosDelContactoPublico["datos"] }) {
  const tipoDoc = datos.tipoDoc as TipoDoc | undefined;
  const filas = [
    { label: "Nombre o razón social", valor: datos.razonSocial },
    {
      label: tipoDoc ? (TIPO_DOC_LABEL[tipoDoc] ?? tipoDoc) : "Documento",
      valor: tipoDoc && datos.nroDoc ? formatearDoc(tipoDoc, datos.nroDoc) : datos.nroDoc,
    },
    {
      label: "Condición frente al IVA",
      valor: datos.condicionIva
        ? (CONDICION_IVA_LABEL[datos.condicionIva as CondicionIva] ?? datos.condicionIva)
        : undefined,
    },
    { label: "Domicilio fiscal", valor: domicilioEnLinea(datos) },
  ].filter((f) => f.valor);

  return (
    <div className="mb-6 border-b border-border pb-6">
      <h2 className="mb-4 font-display text-2xl font-medium text-text">Datos de facturación</h2>
      <dl className="grid gap-4 sm:grid-cols-2">
        {filas.map((f) => (
          <div key={f.label}>
            <dt className="text-xs uppercase tracking-wide text-muted">{f.label}</dt>
            <dd className="mt-0.5 text-sm font-medium text-text">{f.valor}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Volver / Continuar al pie de cada paso del checkout. */
function NavPaso({
  error,
  onVolver,
  onContinuar,
}: {
  error?: string | null;
  onVolver?: () => void;
  onContinuar?: () => void;
}) {
  return (
    <div className="mt-5">
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      <div className="flex items-center gap-3">
        {onVolver && (
          <Button variant="ghost" onClick={onVolver}>
            Volver
          </Button>
        )}
        {onContinuar && (
          <Button className="ml-auto" onClick={onContinuar}>
            Continuar
          </Button>
        )}
      </div>
    </div>
  );
}

function RadioCard({
  selected,
  onClick,
  title,
  description,
  chips,
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description?: string;
  /** Etiquetas del medio (las carga el admin): se muestran resaltadas bajo el título. */
  chips?: ChipMedio[];
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
        <ChipsMedioPago chips={chips} />
      </span>
    </button>
  );
}


/**
 * Datos de la cuenta para transferir en el paso Pago. `undefined` = todavía no llegó la cotización
 * (o no hay sesión): no se muestra nada hasta tenerla; `null` = sin cuenta aplicable.
 */
const TEXTO_SESION_VENCIDA = "Su sesión venció. Inicie sesión para confirmar el pedido.";

/**
 * Aviso del paso Pago cuando ningún medio aplica a la entrega elegida: el comprador tiene que saber
 * ANTES de confirmar que no va a pagar ahora ni elegir cómo.
 */
const AVISO_PAGO_A_COORDINAR =
  "El pago se coordina con un asesor después de confirmar su pedido.";

interface Props {
  /** Id del pedido cuyo pago se reintenta (`/checkout?pedido=`): se retoma ese, nunca se crea otro. */
  pedidoReintento?: string | null;
  /** Vuelve de pagar con su cuenta de Mercado Pago: se retoma en "Estamos confirmando su pago" (sondeo; el webhook registra el cobro). */
  retornoMercadoPago?: boolean;
  /** El `payment_id` de esa vuelta: el sondeo le pide al servidor que consulte ese pago si no lo conoce. */
  pagoMercadoPagoId?: string;
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
   * Configuración de envío del CRM resuelta en el server (cacheada: sólo para mostrar, el
   * servidor decide al cotizar y al pedir). Con el domicilio inactivo sólo se ofrece el retiro en
   * local, sin importar `admiteEnvio`. Si el envío es gratis o a coordinar lo dice `cotizacion.envio`.
   */
  configEnvio: ConfigEnvio;
  /**
   * Direcciones de envío guardadas en Mi cuenta (sólo con Clerk; la
   * predeterminada primero). Vacío = el checkout de siempre: anónimos no
   * llegan acá y la cookie del CRM sin Clerk no guarda direcciones.
   */
  direccionesGuardadas?: DireccionEnvio[];
  /**
   * El documento de facturación ya es de un cliente de Alegra y la cuenta no
   * está vinculada: se recomienda vincular antes de confirmar. Si
   * confirma igual, el pedido sale con `requiereRevision`.
   */
  sugerirVincular?: boolean;
  /**
   * Con el flag `sucursales` prendido (resuelto en el server): locales de retiro y zona vigente.
   * Habilita "Local de retiro" (retiro) y "Provincia de entrega" (envío). null = checkout de siempre.
   */
  sucursales?: OpcionesCheckoutSucursales | null;
  /**
   * Medios de pago del CRM que el Shop puede ofrecer (resueltos en el server: sin `mercadopago` si
   * faltan credenciales). El paso Pago muestra los activos que aplican a la modalidad; si no hay
   * ninguno el pedido sale "a_coordinar". `mercadopago` dispara el cobro en línea.
   */
  mediosPago?: MedioPago[];
  /**
   * El comprador tiene cuenta corriente (lo resuelve el server). Su único medio es el de audiencia
   * `cuenta_corriente`: sin elegir, sin cuotas ni cobro en línea; el pedido queda "a confirmar". El
   * servidor lo vuelve a validar en `POST /api/pedidos`.
   */
  esCuentaCorriente?: boolean;
  /**
   * Elección de «Enviar a» del visitante (ya validada en el server): el checkout arranca con esa
   * entrega, local y dirección. null = como siempre.
   */
  eleccionInicial?: EleccionInicialCheckout | null;
}

/** Respuesta de `/api/pedidos/pendiente`. */
type PedidoRescatado = {
  id: string;
  numero: string;
  total: number;
  cuotas: number | null;
  pagoMetodo?: string;
  lineas?: { id: string; qty: number }[];
  /** Ya hay un cobro enviado al procesador y sin resolver: se retoma en "Estamos confirmando su pago". */
  pagoEnCurso?: boolean;
  /** Vino de `?pedido=`: se retoma siempre, sin compararlo con el carrito ni cancelarlo. */
  explicito?: boolean;
};

export function CheckoutClient({
  nombreSugerido,
  telefonoSugerido = "",
  emailCliente,
  facturacion,
  perfilFacturacion = null,
  admiteEnvio,
  configEnvio,
  direccionesGuardadas = [],
  sugerirVincular = false,
  sucursales = null,
  mediosPago = [],
  esCuentaCorriente = false,
  eleccionInicial = null,
  pedidoReintento = null,
  retornoMercadoPago = false,
  pagoMercadoPagoId,
}: Props) {
  const { items, vaciarTrasPedido, ready, addItems } = useCart();

  // Inicio de checkout: una vez por visita, cuando el carrito ya cargó con algo.
  const checkoutMedido = useRef(false);
  useEffect(() => {
    if (!ready || items.length === 0 || checkoutMedido.current) return;
    checkoutMedido.current = true;
    track({ tipo: "iniciar_checkout", items: items.map((i) => itemDe(i, i.qty)) });
  }, [ready, items]);

  // Slug del medio del CRM que eligió el comprador ("" = el primero que aplique).
  const [medioSlug, setMedioSlug] = useState("");
  // Dos opciones: retiro en local o envío a domicilio. El "envío a coordinar" aparte se fusionó
  // con el domicilio: si el envío no es gratis, su costo se coordina después (src/lib/envio.ts).
  // Los valores iniciales salen de la elección de «Enviar a» (cookie ya validada en el server).
  const [inicial] = useState(() =>
    estadoInicialCheckout({
      eleccion: eleccionInicial,
      direcciones: direccionesGuardadas,
      envioOfrecido: configEnvio.domicilioActivo && admiteEnvio,
      locales: sucursales?.locales.map((l) => l.slug) ?? [],
      localInicial: sucursales?.localInicial ?? null,
      provinciaInicial: sucursales?.provinciaInicial ?? null,
    }),
  );
  const [opcionEntrega, setOpcionEntrega] = useState<OpcionEntregaCheckout>(inicial.opcionEntrega);
  const entrega: EntregaTipo = opcionEntrega === "retiro" ? "retiro" : "envio";
  const aDomicilio = opcionEntrega === "domicilio";
  const envioOfrecido = configEnvio.domicilioActivo && admiteEnvio;
  const [localRetiro, setLocalRetiro] = useState(inicial.localRetiro);
  // Provincia de "otra dirección": la de la zona vigente si la hay. Con una dirección guardada o el
  // domicilio fiscal, la provincia sale de ellos (ver `provinciaEntrega` más abajo).
  const [provinciaManual, setProvinciaManual] = useState(inicial.provinciaManual);
  const [ciudad, setCiudad] = useState("");
  const [direccion, setDireccion] = useState("");
  // Envío a domicilio arranca con la predeterminada. `ciudad` y `direccion`
  // quedan para "otra dirección para esta compra", que no toca las guardadas.
  const [eleccionDireccion, setEleccionDireccion] = useState(inicial.eleccionDireccion);
  // Ciudad y dirección que viajan a la cotización y al pedido. Si el envío es gratis o a
  // coordinar lo decide `evaluarEnvio` (src/lib/envio.ts) con la provincia de la dirección.
  const {
    ciudad: ciudadElegida,
    direccion: direccionElegida,
    guardada,
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
  // Sin cuenta de Alegra, los datos de facturación son el primer paso del
  // checkout: siempre el mismo formulario, precargado si ya los tiene y vacío
  // si no. Al vinculado se los da Alegra: resumen en lectura (+ modal para los
  // que falten).
  const seccionFacturacion = !facturacion.vinculado;
  const router = useRouter();

  // Envío al domicilio fiscal: con el envío a domicilio activo, sin direcciones guardadas
  // y con el domicilio fiscal dentro de la zona, se ofrece por defecto y se
  // pregunta si va a otra dirección. El domicilio es el que se está cargando
  // (primera vez) o el de la facturación ya cargada.
  const [fiscalEnCurso, setFiscalEnCurso] = useState<DatosFacturacion | null>(null);
  const fiscalCalle = (
    seccionFacturacion ? fiscalEnCurso?.domicilioCalle : facturacion.datos.domicilioCalle
  )?.trim();
  const fiscalCiudad = (
    seccionFacturacion ? fiscalEnCurso?.domicilioCiudad : facturacion.datos.domicilioCiudad
  )?.trim();
  const fiscalProvincia = provinciaCanonica(
    seccionFacturacion ? fiscalEnCurso?.domicilioProvincia : facturacion.datos.domicilioProvincia,
  );
  const ofrecerFiscal =
    envioOfrecido &&
    direccionesGuardadas.length === 0 &&
    !!fiscalCalle &&
    !!fiscalCiudad &&
    !!fiscalProvincia;
  const [aOtraDireccion, setAOtraDireccion] = useState(false);
  const usarFiscal = aDomicilio && ofrecerFiscal && !aOtraDireccion;
  const ciudadEntrega = usarFiscal && fiscalCiudad ? fiscalCiudad : ciudadElegida;
  const direccionEntrega = usarFiscal && fiscalCalle ? fiscalCalle : direccionElegida;
  // Provincia de entrega: la del domicilio fiscal o de la dirección guardada elegida; si no, la que
  // se carga en "otra dirección". Es un dato derivado de la dirección, no una regla que el cliente elija.
  const provinciaEntrega = usarFiscal
    ? (fiscalProvincia ?? "")
    : guardada
      ? (provinciaCanonica(guardada.provincia) ?? "")
      : (provinciaCanonica(provinciaManual) ?? "");

  // Mantiene la elección de «Enviar a» al día: sin esperar, sin avisar de errores y sin refrescar la
  // página (el encabezado se pone al día en la próxima navegación). Lo que cuenta para el pedido es
  // el estado de este formulario, no la cookie.
  const cuerpoSync = cuerpoDeSincronizacion({
    opcionEntrega,
    localRetiro,
    eleccionDireccion,
    direcciones: direccionesGuardadas,
    conSucursales: !!sucursales && sucursales.locales.length > 0,
    usarFiscal,
  });
  const claveSync = cuerpoSync ? JSON.stringify(cuerpoSync) : null;
  const ultimaSync = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    // La primera pasada es el estado inicial: ya es la elección vigente, no hay nada que escribir.
    if (ultimaSync.current === undefined) {
      ultimaSync.current = claveSync;
      return;
    }
    if (!claveSync || claveSync === ultimaSync.current) return;
    const t = setTimeout(() => {
      ultimaSync.current = claveSync;
      void sincronizarUbicacion(fetch, JSON.parse(claveSync));
    }, 400);
    return () => clearTimeout(t);
  }, [claveSync]);

  // Pasos del checkout: Sus datos (facturación o contacto) → Entrega (con el
  // domicilio fiscal si se está cargando) → Pago.
  const [pasoActual, setPasoActual] = useState<PasoCheckout>("datos");
  const [vinculando, setVinculando] = useState(false);
  const [errorPaso, setErrorPaso] = useState<string | null>(null);
  const refPasos = useRef<HTMLDivElement>(null);
  function irAPaso(p: PasoCheckout) {
    setErrorPaso(null);
    setPasoActual(p);
    refPasos.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  /**
   * El pedido ya existe en la base. Se guarda el total además del número porque
   * el brick necesita un monto para mostrar, y traer los pedidos completos por
   * cada render sería innecesario.
   */
  /** "Pedido recibido" por transferencia: el comprador ya informó el comprobante en esta pantalla. */
  const [comprobanteInformado, setComprobanteInformado] = useState(false);
  const [confirmado, setConfirmado] = useState<{
    numero: string;
    id: string;
    total: number;
    /** Cuotas sin interés congeladas en el pedido (1 = un pago). null = sin cuotas elegidas (flag apagado o anterior). */
    cuotas: number | null;
    /** El pedido se paga en línea: salta al cobro. */
    pagoEnLinea?: boolean;
    /** Procesador que cobra el pedido (id del registro de pagos); elige el componente de pago. */
    procesador?: string | null;
    /** Plazo y WhatsApp de la sucursal. */
    contacto?: ContactoPedidoVista | null;
    /** Cuenta congelada en el pedido (transferencia); null = sin cuenta aplicable. */
    cuentaPago?: CuentaPagoSnapshot | null;
  } | null>(null);
  const [pagado, setPagado] = useState(false);
  /** Pedido pendiente al que se le está cambiando el medio de pago: "Confirmar" lo actualiza en vez de crear otro. */
  const [pedidoACambiar, setPedidoACambiar] = useState<typeof confirmado>(null);
  /** El pedido salió de este formulario (entrega, medio y cuotas siguen cargados): "Cambiar medio de pago" cae en el paso Pago. */
  const [estadoCargado, setEstadoCargado] = useState(false);
  /** El carrito es el de este pedido y todavía no se envió ningún cobro: recién ahí se vacía. */
  const [carritoDelPedido, setCarritoDelPedido] = useState(false);
  /** El procesador todavía no confirmó el cobro: no se ofrece cancelar, sólo volver a la tienda. */
  const [pagoEnConfirmacion, setPagoEnConfirmacion] = useState(false);
  /** El formulario de pago tiene un cobro en vuelo (enviando o validación del banco): sin salidas laterales. */
  const [cobroEnCurso, setCobroEnCurso] = useState(false);
  const alAgotarConfirmacion = useCallback(() => setPagoEnConfirmacion(false), []);
  const [cancelando, setCancelando] = useState(false);
  const [errorCancelar, setErrorCancelar] = useState<string | null>(null);
  /**
   * Mientras se busca un pedido pendiente para retomar. Quien vuelve a pagar un
   * pedido anterior a este cambio (o desde otro dispositivo) puede llegar con el
   * carrito vacío: sin esta espera vería "carrito vacío" un instante antes de la
   * pantalla de pago.
   */
  const [buscandoPendiente, setBuscandoPendiente] = useState(true);
  /** Pedido pendiente encontrado al montar, a decidir cuando cargue el carrito. */
  const [rescate, setRescate] = useState<PedidoRescatado | null>(null);
  /** El pedido a reintentar ya no se puede cobrar: se explica y se ofrece volver a comprar. */
  const [errorReintento, setErrorReintento] = useState<string | null>(null);
  /**
   * Al montar, se chequea si hay un pedido pendiente reciente de este comprador
   * (ver `pedidoPendienteMasReciente` en pedidos.ts). Sin este atajo, quien
   * vuelve al checkout después de abandonar el pago crearía un pedido-fantasma
   * nuevo. Solo se dispara una vez; mientras carga, el checkout con productos
   * se ve normal y el carrito vacío espera (ver `buscandoPendiente`).
   */
  useEffect(() => {
    // El servidor contesta `{ pedido: null }` sin credenciales de Mercado Pago, y rescata el pedido
    // aunque el medio se haya desactivado en el CRM: el pedido ya existe.
    let cancelado = false;
    const url = pedidoReintento
      ? `/api/pedidos/pendiente?pedido=${encodeURIComponent(pedidoReintento)}`
      : "/api/pedidos/pendiente";
    fetch(url)
      .then(async (r) => {
        if (r.ok) return r.json();
        if (pedidoReintento && (r.status === 404 || r.status === 409)) {
          const j = (await r.json().catch(() => null)) as {
            error?: string;
            motivo?: string;
            pedido?: { id: string; numero: string; total: number };
          } | null;
          // Ya pagado (lo común al volver de Mercado Pago: el webhook llega antes que el comprador).
          if (j?.motivo === "pagado" && j.pedido) return { yaPagado: j.pedido };
          return { falla: j?.error ?? "Este pedido ya no se puede pagar." };
        }
        return null;
      })
      .then((data) => {
        if (cancelado) return;
        if (data?.yaPagado) {
          setConfirmado({ ...data.yaPagado, cuotas: null, pagoEnLinea: true, procesador: SLUG_MERCADOPAGO });
          setPagado(true);
          if (retornoMercadoPago) vaciarTrasPedido();
          setBuscandoPendiente(false);
        } else if (data?.falla) {
          setErrorReintento(data.falla);
          setBuscandoPendiente(false);
        } else if (data?.pedido) setRescate(pedidoReintento ? { ...data.pedido, explicito: true } : data.pedido);
        else setBuscandoPendiente(false);
      })
      .catch(() => {
        // Silencioso: fallar en la detección solo lleva al flujo normal, no
        // rompe nada.
        if (!cancelado) setBuscandoPendiente(false);
      });
    return () => {
      cancelado = true;
    };
    // `retornoMercadoPago` es fijo (viene de la URL) y `vaciarTrasPedido` es estable: no la vuelven a disparar.
  }, [pedidoReintento, retornoMercadoPago, vaciarTrasPedido]);

  /**
   * Con el carrito cargado se decide qué hacer con el pendiente. El carrito sigue
   * lleno hasta el cobro: si es el mismo (o está vacío), se retoma el pago; si
   * cambió, el pendiente ya no es esta compra y se cancela (libera la reserva)
   * para seguir con el checkout normal. Si no se puede cancelar (pago en curso),
   * se retoma.
   */
  const rescateDistinto =
    rescate !== null &&
    // Un reintento explícito nunca cancela el pedido aunque el carrito sea otro.
    !rescate.explicito &&
    ready &&
    items.length > 0 &&
    Array.isArray(rescate.lineas) &&
    contenidoDistinto(items, rescate.lineas);
  function retomarRescate(pedido: PedidoRescatado) {
    setRescate(null);
    setBuscandoPendiente(false);
    setConfirmado({
      numero: pedido.numero,
      id: pedido.id,
      total: pedido.total,
      cuotas: typeof pedido.cuotas === "number" ? pedido.cuotas : null,
      pagoEnLinea: true,
      // El servidor manda el medio del pedido; sin él (respuesta anterior) era Mercado Pago.
      procesador: procesadorDeMedio(pedido.pagoMetodo ?? SLUG_MERCADOPAGO),
    });
    setPagoEnConfirmacion(Boolean(pedido.pagoEnCurso) || (retornoMercadoPago && pedido.id === pedidoReintento));
    setCarritoDelPedido(false);
    setEstadoCargado(false);
  }
  // Mismo carrito (o vacío): se retoma en el render, sin un frame del formulario.
  if (rescate && ready && !rescateDistinto) retomarRescate(rescate);
  const rescateACancelar = rescateDistinto ? rescate : null;
  useEffect(() => {
    if (!rescateACancelar) return;
    let vigente = true;
    fetch(`/api/pedidos/${rescateACancelar.id}/cancelar`, { method: "POST" })
      .then((r) => {
        if (!vigente) return;
        // 409 = no se puede cancelar (pago en curso o informado): se retoma. Cancelado o ya
        // inexistente (404): sigue el checkout normal.
        if (r.status === 409) return retomarRescate(rescateACancelar);
        setRescate(null);
        setBuscandoPendiente(false);
      })
      .catch(() => {
        if (vigente) retomarRescate(rescateACancelar);
      });
    return () => {
      vigente = false;
    };
  }, [rescateACancelar]);

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

  /**
   * Al salir del checkout con un pedido ya creado, se vuelve al estado del
   * primer render: sin esto, `<Activity>` (Cache Components) mostraría la
   * confirmación vieja al volver. Un pedido de Mercado Pago sin pagar lo
   * rescata de nuevo el efecto de `/api/pedidos/pendiente`, que corre otra vez
   * al volver a mostrarse. Un formulario a medio llenar se conserva.
   */
  useAlOcultar(() => {
    setModalFacturacion(false);
    if (!confirmado) return;
    setConfirmado(null);
    setPedidoACambiar(null);
    setPagado(false);
    setPagoEnConfirmacion(false);
    setComprobanteInformado(false);
    setErrorCancelar(null);
    setErrorEnvio(null);
    setPasoActual("datos");
    setBuscandoPendiente(true);
    claveIntento.current = null;
  });

  // El paso Pago ofrece los medios activos del CRM que aplican a la modalidad (`mediosPago` ya viene
  // sin Mercado Pago si faltan credenciales) y el pedido guarda el slug. Si ninguno aplica, el
  // pedido sale "a_coordinar": un asesor coordina el pago. Si el medio elegido deja de aplicar (pasó
  // de retiro a envío), se corrige DERIVÁNDOLO en el render, sin efecto: sin un frame con una opción
  // que el servidor rechazaría.
  const opcionesMedios = { esCuentaCorriente };
  const mediosParaElegir = mediosParaModalidad(mediosPago, entrega, opcionesMedios);
  /** Formas de pago (crédito, débito, cuenta de Mercado Pago) que el admin habilitó para el medio del procesador. */
  const opcionesCobroDe = (procesador: string | null | undefined) =>
    mediosPago.find((m) => procesador && procesadorDeMedio(m.slug) === procesador)?.opcionesCobro;
  const medioSel = medioElegido(mediosPago, entrega, medioSlug, opcionesMedios);
  const pagoParaEnviar: string = medioSel?.slug ?? "a_coordinar";
  const pagaEnLinea = esPagoEnLinea(pagoParaEnviar);
  // Cuotas sin interés: el medio de cobro en línea con condiciones las pide al servidor, que sólo
  // devuelve opciones con el flag `cuotas-cobro` prendido. Sin opciones no hay selector ni cuotas.
  const pideCuotas = Boolean(medioSel?.cobroOnline && (medioSel.condicionesCuotas?.length ?? 0) > 0);

  // Transferencia: el servidor devuelve la cuenta que corresponde a la entrega, el local y el total.
  const conCuenta = pagoParaEnviar === SLUG_TRANSFERENCIA;
  // Los avisos del pedido por transferencia salen al irse de su pantalla (ver `useAvisarAlSalir`).
  const omitirAvisoAlSalir = useAvisarAlSalir(confirmado && !pagado && conCuenta ? confirmado.id : null);
  const localParaCuenta = sucursales && entrega === "retiro" && localRetiro ? localRetiro : undefined;

  // La elección se valida contra las opciones vigentes (derivado en el render, sin efecto): si la
  // cantidad elegida deja de existir se vuelve a un pago.
  const [cuotasSel, setCuotasSel] = useState(1);

  const { cotizacion, estado, error, recotizar, ultimasCuotasOpciones } = useCotizacion({
    entregaTipo: entrega,
    ciudad: aDomicilio ? ciudadEntrega : undefined,
    // La provincia de entrega define si el envío es gratis y, con el flag de sucursales, la zona:
    // cambiarla (o la modalidad) recotiza.
    provincia: aDomicilio && provinciaEntrega ? provinciaEntrega : undefined,
    // Con Transferencia también pide la cuenta; cambiar el local de retiro la recalcula.
    conCuenta,
    sucursalRetiro: localParaCuenta,
    // El precio depende del medio (lista de precios enlazada): cambiar a un medio con otra lista
    // recotiza; entre medios sin lista o con la misma lista no se pide nada.
    ...(() => {
      // Cuenta corriente: ni lista ni cuotas por medio (el servidor tampoco las aplica).
      const base = pagoParaCotizar(mediosPago, entrega, esCuentaCorriente ? null : medioSel);
      // Con cuotas la cotización depende también de la cantidad: el slug viaja siempre y la clave de
      // refetch incluye la lista (o el medio, si no tiene lista de pago único).
      return pideCuotas && medioSel ? { listaKey: base.listaKey || medioSel.slug, pagoMetodo: medioSel.slug } : base;
    })(),
    cuotas: pideCuotas ? cuotasSel : 1,
    conCuotas: pideCuotas,
    // Una vez confirmado el carrito queda vacío: no tiene sentido recotizar.
    activo: !confirmado,
  });

  const opcionesCuotas = pideCuotas ? (cotizacion?.cuotasOpciones ?? ultimasCuotasOpciones ?? []) : [];
  const cuotasElegidas = opcionesCuotas.some((o) => o.cuotas === cuotasSel) ? cuotasSel : 1;

  // Flag `disponibilidad-sucursal`: de la disponibilidad por modalidad que devolvió la cotización,
  // sólo lo de la modalidad elegida (el envío, o el local de retiro seleccionado).
  const disponibilidadElegida = (id: string): DisponibilidadVista | null => {
    const d = cotizacion?.disponibilidad?.productos[id];
    if (!d) return null;
    if (entrega === "envio") return { ...d, retiro: null };
    const local = d.retiro?.[localRetiro];
    return local ? { ...d, envio: null, retiro: { [localRetiro]: local } } : null;
  };

  // Un solo mensaje de entrega para todo el pedido (el producto más lento) debajo de los productos;
  // por producto sólo queda el aviso de los que no se pueden entregar en la modalidad elegida.
  const entregaPedido = resumenEntregaPedido(
    (cotizacion?.lineas ?? []).flatMap((l) => {
      const disp = l.problema ? null : disponibilidadElegida(l.id);
      return disp ? [{ id: l.id, disp }] : [];
    }),
    cotizacion?.disponibilidad?.locales ?? [],
    { conEnvio: configEnvio.domicilioActivo },
  );

  const envioDisponible = cotizacion?.envio.disponible ?? false;
  const contactoCompleto =
    nombre.trim() !== "" && hayTelefonoParaPedido(telefono, facturacion.telefonoAlegra);
  const entregaCompleta =
    !aDomicilio ||
    (ciudadEntrega.trim() !== "" && direccionEntrega.trim() !== "" && provinciaEntrega !== "");
  const datosCompletos = contactoCompleto && entregaCompleta;

  function continuarDesdeContacto() {
    if (!contactoCompleto) {
      setErrorPaso("Ingrese su nombre y un teléfono para continuar.");
      return;
    }
    irAPaso("entrega");
  }

  function validarEntrega(): boolean {
    if (!entregaCompleta) {
      setErrorPaso("Indique la provincia, la ciudad y la dirección de entrega.");
      return false;
    }
    if (aDomicilio && cotizacion && !envioDisponible) {
      setErrorPaso("El envío a domicilio no está disponible. Elija retiro en el local.");
      return false;
    }
    setErrorPaso(null);
    return true;
  }

  function continuarDesdeEntrega() {
    if (validarEntrega()) irAPaso("pago");
  }

  const puedeConfirmar =
    estado === "ok" &&
    !!cotizacion &&
    !cotizacion.hayProblemas &&
    cotizacion.lineas.length > 0 &&
    // Al cambiarle el medio a un pedido que ya existe, el servidor usa sus datos y su entrega: sólo
    // cuentan el medio y las cuotas (ver `lib/cambiar-medio-pago.ts`).
    (pedidoACambiar !== null || (datosCompletos && facturacionCompleta && (!aDomicilio || envioDisponible))) &&
    pasoActual === "pago" &&
    !enviando;

  /** El pedido ya existe: se le cambia el medio (y cuotas) y sigue el flujo normal con ese mismo número. */
  async function confirmarCambioDeMedio(previo: NonNullable<typeof confirmado>) {
    try {
      const res = await fetch(`/api/pedidos/${previo.id}/medio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pagoMetodo: pagoParaEnviar,
          cuotas: pideCuotas && opcionesCuotas.length > 0 ? cuotasElegidas : undefined,
          totalVisto: cotizacion?.total,
        }),
      });
      if (res.status === 401) {
        setErrorEnvio(TEXTO_SESION_VENCIDA);
        recotizar();
        return;
      }
      const json = await res.json().catch(() => null);
      if (res.ok && json) {
        const enLinea = esPagoEnLinea(pagoParaEnviar);
        setPedidoACambiar(null);
        setCarritoDelPedido(enLinea);
        setEstadoCargado(true);
        setConfirmado({
          numero: json.numero,
          id: json.id,
          total: json.total ?? json.cotizacion?.total ?? cotizacion?.total ?? 0,
          cuotas: typeof json.cuotas === "number" ? json.cuotas : null,
          pagoEnLinea: enLinea,
          procesador: procesadorDeMedio(pagoParaEnviar),
          contacto: json.contacto ?? null,
          cuentaPago: json.cuentaPago ?? null,
        });
        // Sin cobro en línea es una compra (el servidor ya vació su carrito): se limpia el local.
        if (!enLinea) vaciarTrasPedido();
        return;
      }
      const motivo = json?.motivo as string | undefined;
      if (res.status === 404 || motivo === "pagado" || motivo === "pago_en_curso" || motivo === "pago_informado" || motivo === "no_cambia") {
        // Ya no se puede cambiar: se vuelve a la pantalla del pedido con el motivo.
        setPedidoACambiar(null);
        setConfirmado(previo);
        setErrorCancelar(json?.error ?? "No se pudo cambiar el medio de pago.");
        return;
      }
      if (res.status === 409 || res.status === 422) {
        setErrorEnvio(json?.error ?? "El pedido cambió. Revíselo.");
        recotizar();
        return;
      }
      setErrorEnvio(json?.error ?? "No pudimos cambiar el medio de pago.");
    } catch {
      setErrorEnvio("No pudimos conectarnos. Revise su conexión e inténtelo de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

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

    if (pedidoACambiar) {
      await confirmarCambioDeMedio(pedidoACambiar);
      return;
    }

    try {
      const res = await fetch("/api/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: claveIntento.current ?? undefined,
          totalVisto: cotizacion?.total,
          items: items.map((i) => ({ id: i.id, qty: i.qty })),
          contactoNombre: nombre,
          contactoTelefono: telefono,
          entregaTipo: entrega,
          entregaCiudad: aDomicilio ? ciudadEntrega : undefined,
          entregaDireccion: aDomicilio ? direccionEntrega : undefined,
          pagoMetodo: pagoParaEnviar,
          // Sólo si el servidor ofreció cuotas: la cantidad elegida (1 = un pago). El monto no viaja.
          cuotas: pideCuotas && opcionesCuotas.length > 0 ? cuotasElegidas : undefined,
          notas,
          complementoFacturacion: complementoFacturacion ?? undefined,
          // Sólo con el flag `sucursales` (props presentes): local de retiro y provincia de entrega.
          sucursalRetiro: sucursales && entrega === "retiro" && localRetiro ? localRetiro : undefined,
          entregaProvincia: aDomicilio && provinciaEntrega ? provinciaEntrega : undefined,
        }),
      });

      if (res.status === 401) {
        // Sesión vencida: se recotiza para que el resumen muestre el enlace de ingreso.
        setErrorEnvio(TEXTO_SESION_VENCIDA);
        recotizar();
        return;
      }

      const json = await res.json();

      if (res.status === 409 && json?.motivo === "facturacion_incompleta") {
        // Faltan datos de facturación (p. ej. cambiaron en Alegra): se abre el
        // modal con lo que falta, sin recotizar.
        setErrorEnvio(json.error ?? "Cargue sus datos de facturación para continuar.");
        setComplementoFacturacion(null);
        setFaltantes409(Array.isArray(json.faltantes) ? json.faltantes : facturacion.faltantes);
        if (facturacion.vinculado) setModalFacturacion(true);
        else irAPaso("datos");
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

      // El pedido ya existe. Sin pago en línea es una compra: el carrito se
      // vacía (con sesión de Clerk el servidor ya vació el suyo en la misma
      // transacción, `crearPedido`; acá sólo se limpia el local). Con pago en
      // línea el carrito sigue lleno hasta que el cobro se envía al procesador
      // (`alQuedarPendiente` / `onPagado` acá y `registrarCobroTx` en el servidor): quien vuelve sin pagar lo encuentra
      // igual. Volviendo al checkout el `useEffect` de arriba retoma el pedido,
      // sin duplicarlo, o lo cancela si el carrito cambió.
      const total = json.cotizacion?.total ?? cotizacion?.total ?? 0;
      setCarritoDelPedido(esPagoEnLinea(pagoParaEnviar));
      setEstadoCargado(true);
      setConfirmado({
        numero: json.numero,
        id: json.id,
        total,
        cuotas: typeof json.cuotas === "number" ? json.cuotas : null,
        pagoEnLinea: esPagoEnLinea(pagoParaEnviar),
        procesador: procesadorDeMedio(pagoParaEnviar),
        contacto: json.contacto ?? null,
        cuentaPago: json.cuentaPago ?? null,
      });
      // Conversión: al crear el pedido, también con Mercado Pago todavía impago.
      track({
        tipo: "pedido_confirmado",
        pedidoId: String(json.id),
        numero: json.numero,
        total,
        items: items.map((i) => itemDe(i, i.qty)),
      });
      if (!esPagoEnLinea(pagoParaEnviar)) vaciarTrasPedido();
    } catch {
      setErrorEnvio("No pudimos conectarnos. Revise su conexión e inténtelo de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  // ------------------------------------------------------- pedido creado, a pagar
  //
  // El pedido YA existe cuando se llega acá (recién creado o rescatado por el
  // useEffect que busca pendientes) y el carrito sigue lleno hasta el cobro:
  // esta pantalla no depende de `items`. Si el cobro falla o el comprador se va, el
  // pendiente se reutiliza en vez de crear uno nuevo.
  async function cancelarYVolver() {
    if (!confirmado) return;
    setCancelando(true);
    setErrorCancelar(null);
    try {
      const res = await fetch(`/api/pedidos/${confirmado.id}/cancelar`, {
        method: "POST",
      });
      // 404: el pedido ya no está pendiente (lo canceló otra pestaña o ya se
      // cobró). No hay nada que cancelar: se vuelve al carrito sin error.
      if (res.ok || res.status === 404) {
        // El carrito sigue lleno hasta el cobro. Vacío (pedido creado antes de este
        // cambio, o retomado desde otro dispositivo): vuelven las líneas del pedido.
        const json = (await res.json().catch(() => null)) as { items?: CartItem[] } | null;
        const lineas = Array.isArray(json?.items) ? json.items : [];
        if (items.length === 0 && lineas.length > 0) addItems(lineas.map(({ qty, ...item }) => ({ item, qty })));
        setConfirmado(null);
        // La `claveIntento` era del pedido cancelado: sin resetearla, el
        // próximo confirmar reutilizaría la clave y traería el pedido viejo.
        claveIntento.current = null;
        router.push("/carrito");
        return;
      }
      // Un 409 dice por qué no se puede (pago en curso, ya pagado): se muestra.
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

  /**
   * "Cambiar medio de pago": se vuelve SIEMPRE al paso Pago y el pedido pendiente queda anotado en
   * `pedidoACambiar`. Nada se cancela ni se crea: al confirmar, `POST /api/pedidos/:id/medio` le cambia
   * el medio al MISMO pedido (mismo número). Con un pedido retomado (sin el formulario cargado) se traen
   * su entrega y su contacto para precargarlo, y con el carrito vacío (el cobro ya lo había vaciado),
   * sus líneas para poder cotizar. Ver `lib/cambiar-medio-pago.ts`.
   */
  function precargarDelPedido(entrega: EntregaDelPedido, contacto?: { nombre?: string; telefono?: string }) {
    const p = precargaDeEntrega(
      entrega,
      direccionesGuardadas.map((d) => ({ id: d.id, ...entregaDesdeGuardada(d) })),
      sucursales?.locales.map((l) => l.slug) ?? [],
    );
    setOpcionEntrega(p.opcion);
    if (p.local) setLocalRetiro(p.local);
    if (p.opcion === "domicilio") {
      setAOtraDireccion(true);
      setEleccionDireccion(p.direccionGuardada ?? OTRA_DIRECCION);
      if (!p.direccionGuardada) {
        setCiudad(p.tipeada.ciudad);
        setDireccion(p.tipeada.direccion);
      }
    }
    if (contacto?.nombre && !nombre.trim()) setNombre(contacto.nombre);
    if (contacto?.telefono && !telefono.trim()) setTelefono(contacto.telefono);
  }

  async function cambiarMedio() {
    if (!confirmado) return;
    setCancelando(true);
    setErrorCancelar(null);
    try {
      if (items.length === 0 || !estadoCargado) {
        const res = await fetch(`/api/pedidos/${confirmado.id}/medio`);
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as { error?: string } | null;
          setErrorCancelar(json?.error ?? "No se pudo cambiar el medio de pago. Inténtelo de nuevo en un momento.");
          return;
        }
        const json = (await res.json().catch(() => null)) as {
          items?: CartItem[];
          entrega?: EntregaDelPedido;
          contacto?: { nombre?: string; telefono?: string };
        } | null;
        const lineas = Array.isArray(json?.items) ? json.items : [];
        if (items.length === 0 && lineas.length > 0) addItems(lineas.map(({ qty, ...item }) => ({ item, qty })));
        if (!estadoCargado && json?.entrega) precargarDelPedido(json.entrega, json.contacto);
      }
      setPedidoACambiar(confirmado);
      setConfirmado(null);
      setPagado(false);
      setPagoEnConfirmacion(false);
      setCarritoDelPedido(false);
      setErrorEnvio(null);
      irAPaso("pago");
    } catch {
      setErrorCancelar("No pudimos conectarnos. Revise su conexión e inténtelo de nuevo.");
    } finally {
      setCancelando(false);
    }
  }

  /** Cobro aprobado: el servidor ya vació su carrito (`registrarCobroTx`); acá se limpia el local. */
  function alPagar() {
    setPagado(true);
    vaciarTrasPedido();
  }

  /**
   * El cobro ya está en manos del procesador y todavía no responde: la compra está hecha, así que el
   * carrito se vacía (el servidor ya vació el suyo al registrar el intento). Si se rechaza, el reintento
   * es sobre este mismo pedido y "Volver al carrito" devuelve sus líneas.
   */
  function alQuedarPendiente() {
    setPagoEnConfirmacion(true);
    // Sólo con el carrito de ESTE pedido y en su primer cobro: tras un rechazo o con un pedido retomado
    // el comprador pudo armar otro carrito, y no se le borra (igual que el servidor).
    if (carritoDelPedido) vaciarTrasPedido();
    setCarritoDelPedido(false);
  }

  if (confirmado && confirmado.pagoEnLinea && !pagado) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 lg:flex-row lg:items-start">
        <section className="min-w-0 flex-1 rounded-[28px] border border-border bg-surface p-5 sm:p-8">
          <h1 className="font-display text-[clamp(28px,3vw,36px)] font-medium tracking-tight text-text">Pague su pedido</h1>
          <p className="mt-1 mb-6 text-sm text-muted">Pedido {confirmado.numero}</p>

          {/* Un componente de pago por procesador: sumar otro es un caso más acá. */}
          {confirmado.procesador === "payway" ? (
            <PagoPayway
              pedidoId={confirmado.id}
              numero={confirmado.numero}
              monto={confirmado.total}
              cuotas={confirmado.cuotas ?? undefined}
              opcionesCobro={opcionesCobroDe(confirmado.procesador)}
              onCobroEnCurso={setCobroEnCurso}
              onConfirmacionAgotada={alAgotarConfirmacion}
              onPagado={alPagar}
              onPendiente={alQuedarPendiente}
              onRechazado={() => {
                setPagoEnConfirmacion(false);
                setCarritoDelPedido(false);
              }}
              iniciarEnConfirmacion={pagoEnConfirmacion}
            />
          ) : confirmado.procesador === "mercadopago" ? (
            <PagoMercadoPago
              pedidoId={confirmado.id}
              numero={confirmado.numero}
              monto={confirmado.total}
              emailComprador={emailCliente}
              maxCuotas={confirmado.cuotas ?? undefined}
              opcionesCobro={opcionesCobroDe(confirmado.procesador)}
              pagoMercadoPagoId={pagoMercadoPagoId}
              onCobroEnCurso={setCobroEnCurso}
              onConfirmacionAgotada={alAgotarConfirmacion}
              onPagado={alPagar}
              onPendiente={alQuedarPendiente}
              onRechazado={() => {
                setPagoEnConfirmacion(false);
                setCarritoDelPedido(false);
              }}
              iniciarEnConfirmacion={pagoEnConfirmacion}
            />
          ) : (
            <p role="alert" className="text-center text-sm text-danger">
              Este medio de pago no está disponible en este momento. Vuelva al carrito y elija otro.
            </p>
          )}
        </section>

        <aside className="flex flex-col gap-4 rounded-[28px] border border-border bg-surface p-6 lg:sticky lg:top-24 lg:w-80 lg:shrink-0">
          <h2 className="font-display text-lg font-medium text-text">Resumen</h2>
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-4">
            <span className="font-semibold text-text">Total</span>
            <span className="font-display text-2xl font-medium tracking-tight text-text">{fmtPrecio(confirmado.total)}</span>
          </div>
          {confirmado.cuotas !== null && confirmado.cuotas > 1 && (
            <p className="rounded-md bg-success-soft px-3 py-2 text-sm font-semibold text-success">
              {confirmado.cuotas} cuotas sin interés de {fmtPrecio(confirmado.total / confirmado.cuotas)}
            </p>
          )}
          <div className="flex flex-col items-stretch gap-2 border-t border-border pt-4">
            {/* Sin cobro aprobado ni en vuelo se puede elegir otro medio o cuotas; el servidor lo vuelve a validar.
                En vuelo cuenta también el envío y la validación del banco (`cobroEnCurso`). */}
            {puedeCambiarMedioPago({ pagado, pagoEnConfirmacion: pagoEnConfirmacion || cobroEnCurso }) && !esCuentaCorriente && (
              <Button variant="outline" onClick={cambiarMedio} disabled={cancelando}>
                {cancelando ? "Un momento…" : "Cambiar medio de pago"}
              </Button>
            )}
            {pagoEnConfirmacion || cobroEnCurso ? (
              // Con el cobro en confirmación no se cancela (el pago puede acreditarse) ni se cambia el
              // medio. Si se rechaza, vuelve el formulario y reaparecen las dos opciones.
              <Link href="/" className="self-center py-2 text-sm text-muted underline">
                Volver a la tienda
              </Link>
            ) : (
              <button
                type="button"
                onClick={cancelarYVolver}
                disabled={cancelando}
                className="self-center py-2 text-sm text-muted underline disabled:opacity-50"
              >
                {cancelando ? "Cancelando…" : "Volver al carrito"}
              </button>
            )}
            {errorCancelar && (
              <p role="alert" className="text-center text-sm text-danger">
                {errorCancelar}
              </p>
            )}
          </div>
        </aside>
      </main>
    );
  }

  // ------------------------------------- transferencia: los datos para transferir y el comprobante
  if (confirmado && !pagado && conCuenta) {
    const cuenta = confirmado.cuentaPago ?? null;
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-10 lg:flex-row lg:items-start">
        <section className="min-w-0 flex-1 rounded-[28px] border border-border bg-surface p-5 sm:p-8">
          <h1 className="font-display text-[clamp(28px,3vw,36px)] font-medium tracking-tight text-text">
            {comprobanteInformado ? "Estamos revisando su pago" : "Transfiera para confirmar su pedido"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Pedido {confirmado.numero} · Lo preparamos cuando registremos el pago.
          </p>
          <ol className="mt-8 flex flex-col gap-8">
            <PasoNumerado numero={1} titulo="Transfiera el importe exacto">
              <CuentaTransferencia cuenta={cuenta} importe={confirmado.total} />
            </PasoNumerado>
            {/* Sin cuenta todavía no hay a dónde transferir: el comprobante se pide recién con los datos. */}
            {cuenta && (
              <PasoNumerado numero={2} titulo="Envíenos el comprobante" hecho={comprobanteInformado}>
                {comprobanteInformado ? (
                  <Alert tone="success">Recibimos su comprobante. Le avisaremos cuando registremos el pago.</Alert>
                ) : (
                  <div className="flex flex-col items-stretch gap-3">
                    <InformarPago
                      ultimos={[]}
                      pedido={{ id: confirmado.id, numero: confirmado.numero, total: confirmado.total }}
                      onInformado={() => setComprobanteInformado(true)}
                    />
                    <p className="text-sm text-muted">{TEXTO_PLAZO_COMPROBANTE_CHECKOUT}</p>
                  </div>
                )}
              </PasoNumerado>
            )}
            <PasoNumerado numero={cuenta ? 3 : 2} titulo="Le avisamos">
              <p className="text-sm text-muted">
                Cuando registremos el pago le escribimos{emailCliente ? ` a ${emailCliente}` : ""} y preparamos su
                pedido.
              </p>
            </PasoNumerado>
          </ol>
        </section>

        <aside className="flex flex-col gap-4 rounded-[28px] border border-border bg-surface p-6 lg:sticky lg:top-24 lg:w-80 lg:shrink-0">
          <h2 className="font-display text-lg font-medium text-text">Resumen</h2>
          <dl className="flex flex-col gap-2 border-t border-border pt-4 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Medio de pago</dt>
              <dd className="font-semibold text-text">Transferencia</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 pt-2">
              <dt className="text-base font-semibold text-text">Total</dt>
              <dd className="font-display text-2xl font-medium tracking-tight text-text">{fmtPrecio(confirmado.total)}</dd>
            </div>
          </dl>
          <div className="flex flex-col items-stretch gap-2 border-t border-border pt-4">
            <Button variant="outline" href="/mi-cuenta">
              Ver mis pedidos
            </Button>
            {/* Antes de informar el comprobante puede pasar a otro medio (el servidor lo vuelve a validar). */}
            {!comprobanteInformado && (
              <Button
                variant="ghost"
                onClick={() => {
                  omitirAvisoAlSalir();
                  void cambiarMedio();
                }}
                disabled={cancelando}
              >
                {cancelando ? "Un momento…" : "Cambiar medio de pago"}
              </Button>
            )}
            <Link href="/catalogo" className="self-center py-2 text-sm text-muted underline">
              Seguir comprando
            </Link>
            {errorCancelar && (
              <p role="alert" className="text-center text-sm text-danger">
                {errorCancelar}
              </p>
            )}
          </div>
          {confirmado.contacto && (
            <PedidoContacto contacto={confirmado.contacto} centrado enlaceChico mostrarPlazo={false} />
          )}
        </aside>
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
          <p className={`mx-auto mt-3 max-w-md text-sm text-muted ${ENTRADA_EXITO} delay-[240ms]`}>
            {pagado ? (
              <>
                Ya cobramos su pedido. Nos comunicaremos con usted para coordinar el{" "}
                {entrega === "envio" ? "envío" : "retiro"}.
              </>
            ) : medioSel && esCuentaCorriente ? (
              <>
                Su pedido quedó a confirmar; todavía no se realizó ningún cobro. {textoPagaConMedio(medioSel.nombre)}
              </>
            ) : !medioSel ? (
              // Sin medio elegido: ningún medio aplicaba a la entrega.
              <>
                Un asesor se comunicará con usted para coordinar el{" "}
                {entrega === "envio" ? "envío" : "retiro"} y el pago.
              </>
            ) : null}
            {emailCliente && (
              <>
                {(pagado || esCuentaCorriente || !medioSel) && " "}Le enviamos el detalle a {emailCliente}.
              </>
            )}
          </p>
          <div className={`mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center ${ENTRADA_EXITO} delay-[300ms]`}>
            <Link href="/mi-cuenta" className="flex flex-col sm:block">
              <Button variant="outline">Ver mis pedidos</Button>
            </Link>
            <Link href="/catalogo" className="flex flex-col sm:block">
              <Button variant="ghost">Seguir comprando</Button>
            </Link>
          </div>
          {!pagado && confirmado.contacto && (
            <PedidoContacto
              contacto={confirmado.contacto}
              centrado
              enlaceChico
              className={`mt-5 ${ENTRADA_EXITO} delay-[330ms]`}
            />
          )}
        </div>
      </main>
    );
  }

  // ------------------------- el pedido a reintentar ya no se puede cobrar
  if (errorReintento) {
    return (
      <main className="mx-auto flex w-full max-w-contenido flex-1 flex-col items-center justify-center gap-4 px-4 py-20 text-center">
        <p role="alert" className="text-lg font-semibold text-text">{errorReintento}</p>
        <div className="flex flex-wrap justify-center gap-3">
          {pedidoReintento && (
            <Link href={`/mi-cuenta/pedidos/${pedidoReintento}`}>
              <Button>Volver a comprar</Button>
            </Link>
          )}
          <Link href="/catalogo">
            <Button variant="outline">Ver catálogo</Button>
          </Link>
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
        <p className="text-2xl font-bold text-text">El carrito está vacío</p>
        <Link href="/catalogo">
          <Button>Ver catálogo</Button>
        </Link>
      </main>
    );
  }

  const etiquetaPaso: Record<PasoCheckout, string> = {
    datos: "Sus datos",
    entrega: seccionFacturacion ? "Domicilio y entrega" : "Entrega",
    pago: "Pago",
  };

  // Los pasos van dentro de la primera card de cada paso, arriba del título:
  // afuera quedaban flotando lejos del formulario que ordenan.
  const cabeceraPasos = (
    <div className="-mx-5 mb-5 border-b border-border/60 px-5 pb-5">
      <Stepper
        ariaLabel="Pasos del pedido"
        size="sm"
        steps={PASOS_CHECKOUT.map((p, i) => {
          const actual = PASOS_CHECKOUT.indexOf(pasoActual);
          return {
            label: etiquetaPaso[p],
            state: i < actual ? "done" : i === actual ? "current" : "pending",
          };
        })}
        stateLabels={{ done: "completo", current: "paso actual", pending: "pendiente" }}
      />
    </div>
  );

  // Subtexto de "Envío a domicilio": lo evalúa el servidor (cotización con la provincia de entrega);
  // sin cotización todavía se evalúa acá con la config mostrada, sin el monto.
  const descripcionEnvio = cotizacion
    ? cotizacion.envio.gratis
      ? "Gratis"
      : "Costo de envío a coordinar"
    : evaluarEnvio(Number.POSITIVE_INFINITY, provinciaEntrega || null, configEnvio).gratis
      ? "Gratis según el monto de su compra"
      : "Costo de envío a coordinar";

  /** Opciones de entrega: en su sección o dentro del paso del domicilio fiscal. */
  const bloqueEntrega = (
    <>
            <div
              className={`grid gap-3 ${envioOfrecido ? "sm:grid-cols-2" : ""}`}
            >
              <RadioCard
                selected={opcionEntrega === "retiro"}
                onClick={() => setOpcionEntrega("retiro")}
                title={ENTREGA_LABEL.retiro}
                description="Retire su pedido en el local que elija"
              />
              {envioOfrecido && (
                <RadioCard
                  selected={aDomicilio}
                  onClick={() => setOpcionEntrega("domicilio")}
                  title={ENTREGA_LABEL.envio}
                  description={descripcionEnvio}
                />
              )}
            </div>
            {sucursales && entrega === "retiro" && sucursales.locales.length > 0 && (
              <div className="mt-4">
                <Field label="Local de retiro">
                  <Select
                    options={sucursales.locales.map((l) => ({
                      label: `${l.nombre} · ${l.direccion}`,
                      value: l.slug,
                    }))}
                    value={localRetiro}
                    onValueChange={setLocalRetiro}
                    placeholder="Seleccionar local"
                  />
                </Field>
              </div>
            )}
            {configEnvio.domicilioActivo && !admiteEnvio && (
              <p className="mt-3 text-sm text-muted">
                El envío a domicilio solo está disponible para compradores de Argentina.
              </p>
            )}

            {aDomicilio && (
              <>
                {ofrecerFiscal && (
                  <div className="mt-4 rounded-lg bg-bg p-3 text-sm">
                    {!aOtraDireccion && (
                      <p className="mb-2 text-text">
                        Se envía a su domicilio fiscal: {fiscalCalle}, {fiscalCiudad}, {fiscalProvincia}.
                      </p>
                    )}
                    <label className="flex items-center gap-2 text-text">
                      <Checkbox
                        checked={aOtraDireccion}
                        onCheckedChange={(c) => setAOtraDireccion(c)}
                      />
                      La dirección de envío es distinta de la de facturación
                    </label>
                  </div>
                )}
                {!usarFiscal && direccionesGuardadas.length > 0 && (
                  <SelectorDireccionEnvio
                    direcciones={direccionesGuardadas}
                    valor={eleccionDireccion}
                    onCambiar={setEleccionDireccion}
                  />
                )}
                {!guardada && !usarFiscal && (
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <Field label="Provincia">
                    <Select
                      options={PROVINCIAS_SELECTOR.map((p) => ({ label: p.nombre, value: p.clave }))}
                      // Siempre controlado: con `undefined` al principio React avisa que el
                      // Select pasa de no controlado a controlado al elegir. Radix muestra
                      // el placeholder igual con "" (lo que no admite "" son las opciones).
                      value={provinciaManual}
                      onValueChange={setProvinciaManual}
                      placeholder="Seleccionar provincia"
                    />
                  </Field>
                  <Field label="Ciudad">
                    <Input
                      placeholder="Posadas"
                      value={ciudad}
                      onChange={(e) => setCiudad(e.target.value)}
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

                {(usarFiscal || guardada) && provinciaEntrega === "" && (
                  <p className="mt-3 text-xs text-muted">
                    Esta dirección no tiene una provincia válida. Elija otra dirección o cárguela de nuevo.
                  </p>
                )}
                {cotizacion && !envioDisponible && (
                  <p className="mt-3 flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-xs text-text">
                    <span className="mt-px text-warning"><AlertIcon /></span>
                    El envío a domicilio no está disponible. Elija retiro en el local.
                  </p>
                )}
              </>
            )}
      {errorPaso && <p className="mt-4 text-sm text-danger">{errorPaso}</p>}
    </>
  );

  return (
    <main className="mx-auto w-full max-w-contenido flex-1 px-4 py-8">
      <nav className="mb-6 text-sm text-muted">
        <Link href="/carrito" className="hover:text-primary">Carrito</Link>
        {" / "}
        <span className="text-text">Finalizar pedido</span>
      </nav>

      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="font-display text-[clamp(30px,3.4vw,46px)] font-medium tracking-tight text-text">
          Finalizar pedido
        </h1>
        <Link href="/catalogo" className="text-sm text-muted hover:text-primary">
          ← Seguir comprando
        </Link>
      </div>


      {estadoFacturacion.aviso === "faltan_datos" && !seccionFacturacion && (
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
        <div ref={refPasos} className="scroll-mt-24 space-y-6">

          {/*
            Su documento ya es de un cliente de Alegra y no vinculó: se vincula
            acá mismo (código al email de Alegra), sin salir del checkout. Al
            terminar, la página se relee ya vinculada (precios y datos de su
            cuenta).
          */}
          {sugerirVincular && pasoActual === "datos" && (
            <section className="rounded-[20px] border border-border/50 bg-surface px-5 py-3">
              {vinculando ? (
                <div>
                  <VincularClient
                    embebido
                    enviarAlAbrir
                    documentoSugerido={perfilFacturacion?.nroDoc ?? ""}
                    onVinculado={() => {
                      setVinculando(false);
                      router.refresh();
                      recotizar();
                    }}
                  />
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <p className="text-sm text-muted">
                    Su documento figura como cliente. Vincule su cuenta para registrar esta compra en ella.
                  </p>
                  <Button size="sm" onClick={() => setVinculando(true)}>
                    Vincular mi cuenta
                  </Button>
                </div>
              )}
            </section>
          )}

          {seccionFacturacion && (pasoActual === "datos" || pasoActual === "entrega") && (
            <section className="rounded-[20px] border border-border/50 bg-surface p-5">
              {cabeceraPasos}
              <h2 className="font-display text-2xl font-medium text-text">
                {pasoActual === "datos" ? "Datos de facturación" : "Domicilio y entrega"}
              </h2>
              <p className="mb-5 mt-1 text-sm text-muted">
                {pasoActual === "entrega"
                  ? "El domicilio fiscal va en la factura."
                  : facturacion.completo
                    ? "Revise que sus datos estén correctos."
                    : "Los necesitamos para emitirle la factura. Se cargan una sola vez."}
              </p>
              <FacturacionForm
                pasos
                pasoInicial={pasoActual === "entrega" ? 1 : 0}
                perfil={perfilFacturacion}
                nombreSugerido={nombreSugerido}
                onPaso={(i) => irAPaso(i === 0 ? "datos" : "entrega")}
                onCambio={setFiscalEnCurso}
                extraDomicilio={
                  <div className="mt-2 border-t border-border pt-5">
                    <h3 className="mb-3 text-base font-semibold text-text">Entrega</h3>
                    {bloqueEntrega}
                  </div>
                }
                antesDeGuardar={validarEntrega}
                onGuardado={(d) => {
                  // Lo cargado acá precarga los datos de contacto del pedido.
                  if (d.condicionIva === "consumidor_final") setNombre(d.razonSocial);
                  if (d.telefono) setTelefono(d.telefono);
                  setFaltantes409(null);
                  setErrorEnvio(null);
                  irAPaso("pago");
                  router.refresh();
                }}
              />
            </section>
          )}

          {/* Con la sección de facturación, nombre y teléfono se piden ahí. */}
          {!seccionFacturacion && pasoActual === "datos" && (
          <section className="rounded-[20px] border border-border/50 bg-surface p-5">
            {cabeceraPasos}
            {/* Vinculado: los datos vienen de Alegra y no se editan desde la tienda. */}
            {facturacionCompleta && <ResumenFacturacion datos={facturacion.datos} />}
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
            <NavPaso error={errorPaso} onContinuar={continuarDesdeContacto} />
          </section>
          )}

          {!seccionFacturacion && pasoActual === "entrega" && (
          <section className="rounded-[20px] border border-border/50 bg-surface p-5">
            {cabeceraPasos}
            <h2 className="mb-4 font-display text-2xl font-medium text-text">Entrega</h2>
            {bloqueEntrega}
            <NavPaso
              onVolver={() => irAPaso("datos")}
              onContinuar={continuarDesdeEntrega}
            />
          </section>
          )}

          {pasoActual === "pago" && (
          <>
          <section className="rounded-[20px] border border-border/50 bg-surface p-5">
            {cabeceraPasos}
            {medioSel ? (
              <>
                <h2 className="mb-4 font-display text-2xl font-medium text-text">Medio de pago</h2>
                {esCuentaCorriente ? (
                  // Cuenta corriente: un único medio, sin elección.
                  <p className="text-sm font-semibold text-text">{textoPagaConMedio(medioSel.nombre)}</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {mediosParaElegir.map((m) => (
                      <RadioCard
                        key={m.slug}
                        selected={medioSel.slug === m.slug}
                        onClick={() => setMedioSlug(m.slug)}
                        title={m.nombre}
                        chips={m.chips}
                      />
                    ))}
                  </div>
                )}
                {medioSel.instrucciones.trim() && (
                  <p className="mt-3 whitespace-pre-line text-sm text-text">{medioSel.instrucciones.trim()}</p>
                )}
                {pagaEnLinea && opcionesCuotas.length > 1 && (
                  <OpcionesCuotas
                    opciones={opcionesCuotas}
                    elegida={cuotasElegidas}
                    onElegir={setCuotasSel}
                    deshabilitado={estado === "cargando"}
                    progreso={cotizacion?.progresoCuotas}
                  />
                )}
              </>
            ) : (
              <>
                <h2 className="mb-2 font-display text-2xl font-medium text-text">Pago</h2>
                <p className="text-sm text-muted">{AVISO_PAGO_A_COORDINAR}</p>
              </>
            )}
          </section>

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
            <NavPaso onVolver={() => irAPaso("entrega")} />
          </section>
          </>
          )}
        </div>

        {/* --------------------------------------------------------- resumen */}
        <div className="h-fit rounded-[24px] border border-border bg-surface p-6 lg:sticky lg:top-24">
          <h2 className="mb-4 text-base font-bold text-text">Resumen</h2>

          {estado === "cargando" && !cotizacion && (
            <p className="mb-4 text-sm text-muted">Confirmando precios y stock…</p>
          )}

          {estado === "no_auth" && (
            <div className="mb-4 rounded-lg bg-danger/5 p-3 text-xs">
              <p className="text-danger">{TEXTO_SESION_VENCIDA}</p>
              <Link href={rutaIngreso("/checkout")} className="mt-1 inline-block font-semibold text-primary hover:underline">
                Iniciar sesión
              </Link>
            </div>
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
                  {nombreConMarca(linea.name, linea.brand ? formatMarca(linea.brand) : undefined).nombre}
                  <span className="ml-1 text-xs">x{linea.qty}</span>
                  {linea.problema && (
                    <span className="mt-0.5 block text-xs">{linea.detalle}</span>
                  )}
                  {/* Flag `disponibilidad-sucursal`: aviso sólo si ESTE producto no se puede entregar
                      en la modalidad elegida; el estado del pedido va una vez, debajo de la lista. */}
                  {!linea.problema && disponibilidadElegida(linea.id) && entregaPedido.sinEntrega.includes(linea.id) && (
                    <DisponibilidadLineas
                      disponibilidad={disponibilidadElegida(linea.id)!}
                      locales={cotizacion?.disponibilidad?.locales ?? []}
                      envio={configEnvio.domicilioActivo}
                      className="mt-1"
                    />
                  )}
                </span>
                <span className="shrink-0 font-medium text-text">
                  {linea.problema ? "—" : fmtPrecio(linea.subtotal)}
                </span>
              </li>
            ))}
          </ul>

          {entregaPedido.resumen && (
            <div className="mb-4">
              <ListaLineas lineas={[entregaPedido.resumen]} />
              {entregaPedido.aclaracion && (
                <p className="mt-1 text-xs text-muted">{entregaPedido.aclaracion}</p>
              )}
            </div>
          )}

          <div className="space-y-2 border-t border-border pt-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Subtotal</span>
              <span className="font-medium">{fmtPrecio(cotizacion?.subtotal ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Impuestos</span>
              <span className="font-medium">{fmtPrecio(cotizacion?.iva ?? 0)}</span>
            </div>
            {entrega === "envio" && (
              <div className="flex justify-between">
                <span className="text-muted">Envío</span>
                {cotizacion?.envio.gratis ? (
                  <span className="font-medium text-success">Sin cargo</span>
                ) : (
                  <span className="font-medium text-muted">A coordinar</span>
                )}
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

          {errorEnvio && estado !== "no_auth" && (
            <p className="mt-4 rounded-lg bg-danger/5 p-3 text-xs text-danger">{errorEnvio}</p>
          )}

          <Button className="mt-5 w-full" disabled={!puedeConfirmar} onClick={confirmar}>
            {enviando ? "Confirmando…" : "Confirmar pedido"}
          </Button>

          {!puedeConfirmar && !enviando && (
            <p className="mt-2 text-center text-xs text-muted">
              {estado === "no_auth"
                ? "Inicie sesión para confirmar el pedido."
                : !facturacionCompleta
                ? "Cargue sus datos de facturación para continuar."
                : pasoActual !== "pago"
                  ? "Complete los pasos para confirmar el pedido."
                : cotizacion?.hayProblemas
                  ? "Revise los productos marcados en rojo."
                  : !datosCompletos
                    ? "Complete todos los campos para continuar."
                    : aDomicilio && !envioDisponible
                      ? "Elija retiro en el local: el envío no está disponible."
                      : "Confirmando precios y stock…"}
            </p>
          )}

          <p className="mt-3 text-center text-xs text-muted">
            {conCuenta ? PIE_TRANSFERENCIA : pieDelMedio(medioSel)}
          </p>
        </div>
      </div>
    </main>
  );
}
