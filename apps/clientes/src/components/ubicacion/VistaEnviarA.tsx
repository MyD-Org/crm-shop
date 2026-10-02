"use client";

import type { ReactNode } from "react";
import { Alert, Button, RadioGroup, Skeleton } from "@myd-org/ui";
import type { DireccionEnvio } from "@/lib/direcciones-envio";
import {
  opcionesDirecciones,
  opcionesLocales,
  puedeAgregarDireccion,
  type CargaDirecciones,
  type OpcionesRetiro,
} from "@/lib/enviar-a";
import { TEXTOS_UBICACION as T } from "@/lib/ubicacion";

export interface VistaEnviarAProps {
  /** null = cargando. */
  direcciones: CargaDirecciones | null;
  /** undefined = cargando; null = no se pudieron leer. */
  locales: OpcionesRetiro | null | undefined;
  /** Opción de la elección vigente (badge "Actual"). */
  vigente: string | undefined;
  /** Opción marcada ahora (controlado). */
  valor: string;
  onValor: (v: string) => void;
  onEditar: (d: DireccionEnvio) => void;
  onAgregar: () => void;
  onReintentar: () => void;
  /** Sin sesión, o con sesión y sin direcciones: búsqueda de localidad + código postal. */
  formularioLocalidad: ReactNode;
  error: string | null;
  enviando: boolean;
  onConfirmar: () => void;
  conUbicacion: boolean;
  onQuitar: () => void;
}

/**
 * Vista "elegir" del modal "Seleccione dónde recibir su compra": direcciones guardadas (con
 * "Editar"), "Agregar nueva dirección", locales de retiro y, sin sesión, el formulario de
 * localidad + código postal. Presentacional: el estado y la red viven en `ModalEnviarA`.
 * Todo con componentes del DS (RadioGroup, Button, Alert), sin pisar sus estilos.
 */
export function VistaEnviarA(p: VistaEnviarAProps) {
  if (p.direcciones === null) {
    return (
      <div className="space-y-2" aria-busy="true">
        <p className="sr-only" role="status">
          {T.cargando}
        </p>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  const vigenteId = p.vigente?.startsWith("dir:") ? p.vigente.slice(4) : undefined;
  const dirs = p.direcciones.estado === "ok" ? p.direcciones.direcciones : [];
  const opcionesRetiro = p.locales ? opcionesLocales(p.locales) : [];

  return (
    <div className="space-y-5">
      {p.direcciones.estado === "ok" && (
        <div className="space-y-3">
          {dirs.length > 0 && (
            <RadioGroup
              legend={T.legendDirecciones}
              name="enviar-a-direccion"
              options={opcionesDirecciones(dirs, vigenteId, p.onEditar)}
              value={p.valor}
              onValueChange={p.onValor}
              disabled={p.enviando}
            />
          )}
          {puedeAgregarDireccion(dirs) ? (
            <Button type="button" variant="outline" onClick={p.onAgregar} disabled={p.enviando}>
              {T.agregarDireccion}
            </Button>
          ) : (
            <p className="text-sm text-muted">{T.limiteDirecciones}</p>
          )}
        </div>
      )}

      {p.direcciones.estado === "error" && (
        <div className="space-y-2">
          <Alert tone="danger">{T.errorCarga}</Alert>
          <Button type="button" variant="outline" size="sm" onClick={p.onReintentar}>
            {T.reintentar}
          </Button>
        </div>
      )}

      {(p.direcciones.estado === "sinSesion" || (p.direcciones.estado === "ok" && dirs.length === 0)) &&
        p.formularioLocalidad}

      {p.locales === null && <p className="text-sm text-muted">{T.errorLocales}</p>}
      {opcionesRetiro.length > 0 && (
        <RadioGroup
          legend={T.legendLocales}
          name="enviar-a-local"
          options={opcionesRetiro}
          value={p.valor}
          onValueChange={p.onValor}
          disabled={p.enviando}
        />
      )}

      <div aria-live="polite">{p.error && <Alert tone="danger">{p.error}</Alert>}</div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {p.conUbicacion ? (
          <Button type="button" variant="link" size="inline" onClick={p.onQuitar} disabled={p.enviando}>
            {T.quitar}
          </Button>
        ) : (
          <span />
        )}
        <Button type="button" onClick={p.onConfirmar} loading={p.enviando} disabled={!p.valor || p.enviando}>
          {T.confirmar}
        </Button>
      </div>
    </div>
  );
}

