/**
 * Barrido del aviso de reingreso (change `aviso-reingreso`, S2). SOLO servidor. Lo dispara el aviso del CRM
 * de que cambió el catálogo (`api/internal/catalogo/revalidar`, tras webhooks de stock y la sync
 * diaria); `api/cron/aviso-reingreso` queda para correrlo a mano.
 *
 * Orden: purga de retención (corre siempre: la retención no depende del flag) → flag (apagado: sale sin
 * enviar ni marcar) → productos con avisos pendientes (sin pendientes no consulta stock) → cuáles
 * tienen disponible > 0 → por cada aviso, hasta `LOTE_MAX`: reclamar, enviar con `idempotencyKey` por
 * aviso, y recién con el envío confirmado marcar `avisado_at`. Un fallo en un aviso no corta los demás.
 * Sin datos personales en el log.
 */
import { getDb } from "@/db";
import { shopTenantId } from "@/lib/tenant";
import { enviarEmail, type EmailEnviado, type OpcionesEmail } from "./email";
import { avisoReingresoActivo } from "./aviso-reingreso-flag";
import { hayDisponible, nombreConOpcion, productosAvisables } from "./aviso-reingreso-disponibilidad";
import { armarMailAviso } from "./aviso-reingreso-mail";
import {
  listarPendientesDe,
  marcarAvisado,
  marcarError,
  pendientesAgrupados,
  purgar,
  reclamarAviso,
} from "./aviso-reingreso-repo";
import { LOTE_MAX } from "./aviso-reingreso-textos";
import { getMarca } from "./marca";
import { urlSitioMail } from "./mail-layout";
import { leerSucursalesYZonas } from "./sucursales-repo";
import { urlLogoMarca } from "./vinculacion-mail";

export interface ResultadoAvisos {
  /** El flag estaba apagado: no se envió ni se marcó nada. */
  omitido: boolean;
  revisados: number;
  enviados: number;
  errores: number;
  purgados: number;
}

/** Lo que el barrido toca fuera de la base de datos; los tests lo reemplazan. */
export interface DependenciasAvisos {
  db: ReturnType<typeof getDb>;
  tenantId: string;
  activo: () => Promise<boolean>;
  sucursales: () => Promise<Parameters<typeof hayDisponible>[1]["sucursales"]>;
  enviar: (o: OpcionesEmail) => Promise<EmailEnviado>;
  sitio: () => string | null;
  marca: () => Promise<{ nombre: string; logoUrl: string | null }>;
}

async function dependenciasPorDefecto(): Promise<DependenciasAvisos> {
  return {
    db: getDb(),
    tenantId: shopTenantId(),
    activo: avisoReingresoActivo,
    // Sin caché: las sucursales activas deciden qué es "disponible" y esto corre con cada cambio de stock.
    sucursales: async () => (await leerSucursalesYZonas()).sucursales,
    enviar: enviarEmail,
    sitio: () => urlSitioMail(),
    marca: async () => {
      const m = await getMarca();
      return { nombre: m.nombre, logoUrl: urlLogoMarca(m) };
    },
  };
}

export async function procesarAvisos(deps?: DependenciasAvisos): Promise<ResultadoAvisos> {
  const d = deps ?? (await dependenciasPorDefecto());
  const r: ResultadoAvisos = { omitido: false, revisados: 0, enviados: 0, errores: 0, purgados: 0 };

  try {
    r.purgados = await purgar(d.db, d.tenantId);
  } catch (err) {
    console.error("[aviso-reingreso] no se pudo purgar:", err instanceof Error ? err.message : err);
  }

  if (!(await d.activo())) return { ...r, omitido: true };

  const ids = await pendientesAgrupados(d.db, d.tenantId);
  if (ids.length === 0) return r;

  const disponibles = await hayDisponible(ids, { sucursales: await d.sucursales() }, d.db);
  if (disponibles.size === 0) return r;

  const productos = await productosAvisables([...disponibles], d.db);
  const avisables = [...productos.keys()];
  const avisos = await listarPendientesDe(d.db, d.tenantId, avisables, LOTE_MAX);
  if (avisos.length === 0) return r;

  // Sin la URL del sitio no hay enlace posible (ni a la ficha ni a la baja): no se envía nada.
  const sitio = d.sitio();
  if (!sitio) {
    console.error("[aviso-reingreso] falta NEXT_PUBLIC_SITE_URL: no se envió nada");
    return { ...r, revisados: avisos.length, errores: avisos.length };
  }
  const marca = await d.marca();

  for (const aviso of avisos) {
    r.revisados++;
    try {
      if (!(await reclamarAviso(d.db, d.tenantId, aviso.id))) continue; // otra corrida lo tiene o ya se resolvió
      const producto = productos.get(aviso.alegraId)!;
      const mail = armarMailAviso({
        nombreProducto: nombreConOpcion(producto),
        urlProducto: `${sitio}/producto/${encodeURIComponent(aviso.alegraId)}`,
        sitioUrl: sitio,
        tokenBaja: aviso.tokenBaja,
        comercio: marca.nombre,
        logoUrl: marca.logoUrl,
      });
      const envio = await d.enviar({
        to: aviso.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        headers: mail.headers,
        idempotencyKey: `aviso-reingreso-${aviso.id}`,
        tags: [{ name: "type", value: "aviso-reingreso" }],
      });
      if (envio.ok) {
        await marcarAvisado(d.db, d.tenantId, aviso.id);
        r.enviados++;
      } else {
        await marcarError(d.db, d.tenantId, aviso.id, envio.error ?? "No se pudo enviar el email", {
          devolverIntento: envio.noConfigurado === true,
        });
        r.errores++;
      }
    } catch (err) {
      r.errores++;
      console.error("[aviso-reingreso] falló un aviso:", err instanceof Error ? err.message : err);
      await marcarError(d.db, d.tenantId, aviso.id, "Error inesperado al enviar").catch(() => {});
    }
  }
  return r;
}
