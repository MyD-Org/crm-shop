/**
 * Entorno de navegador para el SDK oficial de Payway (`decidir.js`): carga el script bajo demanda y
 * arma el formulario efímero que el SDK lee. Sólo se importa desde componentes cliente.
 *
 * El script se pide la primera vez que el comprador toca "Pagar" con tarjeta (no antes), así sólo la
 * pantalla de pago lo descarga; y se pide una sola vez por carga de página.
 */

import { URL_SDK_PAYWAY, type ConstructorDecidir, type EntornoSdk } from "./payway-token";

declare global {
  interface Window {
    Decidir?: ConstructorDecidir;
  }
}

const ESPERA_SCRIPT_MS = 10_000;
let carga: Promise<ConstructorDecidir | null> | null = null;

function cargarSdk(): Promise<ConstructorDecidir | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.Decidir) return Promise.resolve(window.Decidir);
  if (carga) return carga;

  carga = new Promise<ConstructorDecidir | null>((resolver) => {
    const script = document.createElement("script");
    script.src = URL_SDK_PAYWAY;
    script.async = true;
    // Si Payway no responde se sigue con el respaldo, sin dejar al comprador esperando.
    const timer = window.setTimeout(() => fallo(), ESPERA_SCRIPT_MS);
    function fallo() {
      window.clearTimeout(timer);
      script.remove();
      carga = null; // permite reintentar en el próximo "Pagar"
      resolver(null);
    }
    script.onload = () => {
      window.clearTimeout(timer);
      if (window.Decidir) resolver(window.Decidir);
      else fallo();
    };
    script.onerror = fallo;
    document.head.appendChild(script);
  });
  return carga;
}

/**
 * Formulario oculto con un campo `data-decidir` por dato (lo que lee `createToken`). Existe sólo
 * durante la tokenización: `desmontar` borra los valores y lo saca del documento.
 */
function montarFormulario(campos: Record<string, string>): { form: unknown; desmontar(): void } {
  const form = document.createElement("form");
  form.hidden = true;
  form.autocomplete = "off";
  form.setAttribute("aria-hidden", "true");
  const inputs: HTMLInputElement[] = [];
  for (const [nombre, valor] of Object.entries(campos)) {
    const input = document.createElement("input");
    input.type = "text";
    input.name = nombre;
    input.autocomplete = "off";
    input.setAttribute("data-decidir", nombre);
    input.value = valor;
    form.appendChild(input);
    inputs.push(input);
  }
  document.body.appendChild(form);
  return {
    form,
    desmontar() {
      for (const i of inputs) i.value = "";
      form.remove();
    },
  };
}

export const entornoSdkNavegador: EntornoSdk = { cargarSdk, montarFormulario };
