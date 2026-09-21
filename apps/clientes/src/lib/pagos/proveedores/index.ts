/**
 * Registro de adaptadores de cuotas. SOLO servidor.
 * Sumar un proveedor = implementar `ProveedorCuotas` y agregarlo acá.
 */
import { cuotasMercadoPago } from "./mercadopago";
import type { ProveedorCuotas } from "./tipos";

export const PROVEEDORES_CUOTAS: ProveedorCuotas[] = [cuotasMercadoPago];

export type { ProveedorCuotas, ResultadoPlanesMedio } from "./tipos";
