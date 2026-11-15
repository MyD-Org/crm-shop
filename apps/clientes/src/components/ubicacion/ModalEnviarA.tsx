"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@myd-org/ui";
import { DireccionForm } from "@/components/mi-cuenta/DireccionForm";
import type { CampoDireccion, DireccionEnvio } from "@/lib/direcciones-envio";
import {
  FORMULARIO_VACIO,
  formularioDesde,
  interpretarRespuesta,
  type FormularioDireccion,
} from "@/lib/direcciones-envio-cliente";
import {
  cargarDirecciones,
  cargarLocales,
  cuerpoDeOpcion,
  cuerpoLocalidad,
  guardarEleccion,
  idNuevo,
  type CalleElegida,
  type CargaDirecciones,
  type CuerpoEleccion,
  type OpcionesRetiro,
} from "@/lib/enviar-a";
import { TEXTOS_UBICACION as T } from "@/lib/ubicacion";
import { FormularioLocalidad, type LocalidadElegida, type UbicacionDetectada } from "./FormularioLocalidad";
import { VistaEnviarA } from "./VistaEnviarA";

/**
 * Modal "Seleccione dónde recibir su compra". Se descarga recién al primer click (ver
 * `SelectorUbicacion`) y al abrirse pide las direcciones guardadas (401 = sin sesión) y los locales
 * de retiro; al cerrarse aborta lo que esté en vuelo. Confirmar manda UN payload a
 * `POST /api/ubicacion` (el servidor valida y arma la cookie), cierra y refresca la ruta.
 *
 * "Agregar nueva dirección" y "Editar" abren `DireccionForm` embebida en el mismo modal (sin
 * navegar). Una dirección nueva queda elegida al guardarse; editar la vigente no cambia el id, así
 * que alcanza con refrescar para que el header muestre los datos nuevos.
 */
const API_DIRECCIONES = "/api/mi-cuenta/direcciones";
/** Valor del radio virtual "localidad + CP" (sin sesión). */
const LOCALIDAD = "localidad";

type Vista = { tipo: "elegir" } | { tipo: "agregar" } | { tipo: "editar"; d: DireccionEnvio };

export default function ModalEnviarA({
  abierto,
  onOpenChange,
  vigente,
  localidadActual,
  conUbicacion,
}: {
  abierto: boolean;
  onOpenChange: (abierto: boolean) => void;
  vigente: string | undefined;
  localidadActual?: LocalidadElegida & { cp?: string };
  conUbicacion: boolean;
}) {
  const router = useRouter();
  const [vista, setVista] = useState<Vista>({ tipo: "elegir" });
  const [direcciones, setDirecciones] = useState<CargaDirecciones | null>(null);
  const [locales, setLocales] = useState<OpcionesRetiro | null | undefined>(undefined);
  const [recarga, setRecarga] = useState(0);
  // La localidad vigente (si vino de Georef) arranca cargada y marcada: así figura como opción
  // aunque no haya direcciones guardadas, como "Ubicación actual" en otras tiendas.
  const [valor, setValor] = useState(vigente ?? (localidadActual ? LOCALIDAD : ""));
  const [localidad, setLocalidad] = useState<LocalidadElegida | null>(
    localidadActual ? { id: localidadActual.id, etiqueta: localidadActual.etiqueta } : null,
  );
  const [errorLocalidad, setErrorLocalidad] = useState<string | null>(null);
  // Calle y altura (opcional, envío por zona): sólo vale una sugerencia elegida, con su token.
  const [calle, setCalle] = useState<CalleElegida | null>(null);
  const [textoCalle, setTextoCalle] = useState("");
  const [errorCalle, setErrorCalle] = useState<string | null>(null);
  // «Usar mi ubicación» ya guardó la elección: si no se cambia nada, «Confirmar» sólo cierra.
  const [detectada, setDetectada] = useState<UbicacionDetectada | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [erroresForm, setErroresForm] = useState<Partial<Record<CampoDireccion, string>>>({});

  // Carga lazy al abrir; abort al cerrar (o al reintentar). Cada apertura monta un modal nuevo
  // (key en SelectorUbicacion): el estado arranca limpio, con la elección vigente marcada.
  useEffect(() => {
    if (!abierto) return;
    const ctrl = new AbortController();
    cargarDirecciones(fetch, ctrl.signal).then((r) => {
      if (r) setDirecciones(r);
    });
    cargarLocales(fetch, ctrl.signal).then((r) => {
      if (!ctrl.signal.aborted) setLocales(r);
    });
    return () => ctrl.abort();
  }, [abierto, recarga]);

  function elegirValor(v: string) {
    setValor(v);
    setError(null);
  }

  async function aplicar(cuerpo: CuerpoEleccion): Promise<boolean> {
    setEnviando(true);
    setError(null);
    const r = await guardarEleccion(fetch, cuerpo);
    setEnviando(false);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    onOpenChange(false);
    router.refresh();
    return true;
  }

  async function confirmar() {
    if (valor === LOCALIDAD && detectada) {
      onOpenChange(false);
      router.refresh();
      return;
    }
    if (valor === LOCALIDAD) {
      // Escribió una calle pero no eligió ninguna sugerencia: no se descarta en silencio.
      if (textoCalle.trim() && !calle) {
        setErrorCalle(T.elegirCalle);
        return;
      }
      const c = cuerpoLocalidad(localidad?.id ?? null, calle);
      setErrorLocalidad(c.ok ? null : c.error);
      if (!c.ok) return;
      await aplicar(c.cuerpo);
      return;
    }
    const cuerpo = cuerpoDeOpcion(valor);
    if (!cuerpo) {
      setError(T.elegirOpcion);
      return;
    }
    await aplicar(cuerpo);
  }

  async function quitar() {
    setEnviando(true);
    await fetch("/api/ubicacion", { method: "DELETE" }).catch(() => null);
    setEnviando(false);
    onOpenChange(false);
    router.refresh();
  }

  async function guardarDireccion(form: FormularioDireccion) {
    const editando = vista.tipo === "editar" ? vista.d : null;
    const antes = direcciones?.estado === "ok" ? direcciones.direcciones : [];
    setGuardando(true);
    setErrorForm(null);
    setErroresForm({});
    let r;
    try {
      const res = await fetch(editando ? `${API_DIRECCIONES}/${editando.id}` : API_DIRECCIONES, {
        method: editando ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      r = interpretarRespuesta(res.status, await res.json().catch(() => null));
    } catch {
      r = { ok: false as const, error: T.errorGuardar, errores: {} };
    }
    setGuardando(false);
    if (!r.ok) {
      setErrorForm(r.error);
      setErroresForm(r.errores);
      return;
    }
    setDirecciones({ estado: "ok", direcciones: r.direcciones });
    if (editando) {
      // El id no cambia: si era la vigente, el header toma los datos nuevos al refrescar.
      setVista({ tipo: "elegir" });
      if (vigente === `dir:${editando.id}`) router.refresh();
      return;
    }
    const nueva = idNuevo(antes, r.direcciones);
    setVista({ tipo: "elegir" });
    if (nueva) await aplicar({ direccionId: nueva });
  }

  const enFormulario = vista.tipo !== "elegir";

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => {
        if (!enviando && !guardando) onOpenChange(v);
      }}
      title={vista.tipo === "agregar" ? T.tituloAgregar : vista.tipo === "editar" ? T.tituloEditar : T.tituloModal}
      description={enFormulario ? undefined : T.descripcionModal}
      size="md"
    >
      {enFormulario ? (
        <DireccionForm
          key={vista.tipo === "editar" ? vista.d.id : "nueva"}
          variante="embebida"
          titulo={vista.tipo === "editar" ? T.tituloEditar : T.tituloAgregar}
          inicial={vista.tipo === "editar" ? formularioDesde(vista.d) : FORMULARIO_VACIO}
          facturacion={null}
          ofrecerFacturacion={false}
          esPredeterminada={vista.tipo === "editar" && vista.d.predeterminada}
          guardando={guardando}
          error={errorForm}
          errores={erroresForm}
          onGuardar={guardarDireccion}
          onCancelar={() => {
            setVista({ tipo: "elegir" });
            setErrorForm(null);
            setErroresForm({});
          }}
        />
      ) : (
        <VistaEnviarA
          direcciones={direcciones}
          locales={locales}
          vigente={vigente}
          valor={valor}
          onValor={(v) => {
            elegirValor(v);
            setErrorLocalidad(null);
          }}
          onEditar={(d) => setVista({ tipo: "editar", d })}
          onAgregar={() => setVista({ tipo: "agregar" })}
          onReintentar={() => {
            setDirecciones(null);
            setLocales(undefined);
            setRecarga((n) => n + 1);
          }}
          formularioLocalidad={
            <FormularioLocalidad
              elegida={localidad}
              onElegir={(l) => {
                setDetectada(null);
                setLocalidad(l);
                setCalle(null);
                setTextoCalle("");
                setErrorCalle(null);
                elegirValor(LOCALIDAD);
                setErrorLocalidad(null);
              }}
              conCalle={Boolean(locales?.direccionExacta)}
              calle={calle}
              onCalle={(c, texto) => {
                setDetectada(null);
                setCalle(c);
                setTextoCalle(texto);
                setErrorCalle(null);
                if (c) elegirValor(LOCALIDAD);
              }}
              errorCalle={errorCalle}
              errorLocalidad={errorLocalidad}
              onGeolocalizada={(d) => {
                setDetectada(d);
                setLocalidad(d.localidad);
                setCalle(null);
                setTextoCalle(d.calle ?? "");
                setErrorCalle(null);
                setErrorLocalidad(null);
                elegirValor(LOCALIDAD);
                // El header y la ficha ya muestran lo detectado detrás del modal.
                router.refresh();
              }}
              deshabilitado={enviando}
            />
          }
          error={error}
          enviando={enviando}
          onConfirmar={confirmar}
          conUbicacion={conUbicacion}
          onQuitar={quitar}
        />
      )}
    </Dialog>
  );
}
