/** Tiempo breve que deja terminar una ráfaga de cambios de filtros. */
export const DEMORA_NAVEGACION_CATALOGO_MS = 220;

type Temporizador = ReturnType<typeof setTimeout>;

/** Dependencias chicas para poder probar el coordinador sin DOM ni Next. */
export interface DependenciasNavegacionCatalogo {
  /** Pide al router los datos del href que ya quedó en la barra de direcciones. */
  actualizar: (href: string) => void;
  /** Crea el único paso de historial de una interacción continuada. */
  push: (href: string) => void;
  /** Mantiene ese mismo paso mientras la persona sigue ajustando filtros. */
  replace: (href: string) => void;
  demoraMs?: number;
}

/**
 * Actualiza la URL de inmediato y difiere la carga de datos hasta que la
 * persona deja de cambiar filtros. La primera modificación conserva un paso
 * de historial; las siguientes de la misma ráfaga lo reemplazan. Así el
 * navegador vuelve al estado anterior con un solo "Atrás" y sólo se consulta
 * el catálogo final.
 */
export class NavegacionCatalogo {
  private temporizador: Temporizador | undefined;
  private hayEntradaPendiente = false;
  private readonly demoraMs: number;

  constructor(private readonly deps: DependenciasNavegacionCatalogo) {
    this.demoraMs = deps.demoraMs ?? DEMORA_NAVEGACION_CATALOGO_MS;
  }

  programar(href: string) {
    if (this.hayEntradaPendiente) this.deps.replace(href);
    else {
      this.deps.push(href);
      this.hayEntradaPendiente = true;
    }

    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => {
      this.temporizador = undefined;
      this.hayEntradaPendiente = false;
      this.deps.actualizar(href);
    }, this.demoraMs);
  }

  cancelar() {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = undefined;
    this.hayEntradaPendiente = false;
  }
}
