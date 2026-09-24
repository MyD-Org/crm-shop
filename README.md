# crm-shop

Monorepo con dos aplicaciones Next.js independientes:

| Carpeta | Qué es |
|---|---|
| `apps/admin` | CRM: backoffice, portal de clientes (empresas sin tienda) y API para agentes |
| `apps/clientes` | Shop: tienda online |
| `packages/` | Reservado para código compartido (todavía vacío) |

No hay `package.json` ni lockfile en la raíz: cada app se instala y se corre **parada en su carpeta**.

Las dos apps comparten **una** base Postgres: el esquema `public` es del CRM (sus migraciones viven en `apps/admin/drizzle`) y el esquema `shop` es del Shop (`apps/clientes/drizzle`). El Shop lee y escribe en `public` sólo lo que le concede una migración del CRM, con permisos mínimos por tabla o por columna (ver `apps/clientes/docs/una-base-esquema-shop.md`).

El portal de clientes del CRM queda para las empresas sin tienda. La cuenta corriente del cliente de la tienda (facturas, saldo, pagos, presupuestos, condiciones, avisos) vive en **Mi cuenta** del Shop, que no enlaza al portal.

    cd apps/admin && npm ci && npm run dev
    cd apps/clientes && npm ci && npm run dev

Los workflows viven en `.github/workflows/` con prefijo por app (`admin-*`, `clientes-*`) y filtros `paths:`.

**Este repo es público.** Nunca se commitean planillas, archivos `.env*`, datos reales ni URLs de producción: `scripts/repo-guard.sh` y el workflow `guard` lo verifican. Nunca usar `git add -A`.

## Operación

**Deploy por app**

Cada app tiene su propio proyecto de Vercel, con Root Directory apuntando a su carpeta (`apps/admin` o `apps/clientes`). El Ignored Build Step evita un redeploy cuando el cambio no toca esa carpeta. Ante la duda, la regla de omisión construye: si no puede determinar con certeza que la carpeta no cambió, dispara el build. Es la falla segura.

**Secrets**

Los secrets de Actions llevan prefijo `ADMIN_` o `CLIENTES_` según la app. Los carga una sola persona, para evitar valores desalineados entre ambos prefijos.

**Registro privado (`@myd-org/ui`)**

El acceso vigente es el permiso de lectura que se le dio a este repo en la configuración del paquete `@myd-org/ui` (Manage Actions access). Con eso alcanza el token automático de Actions, sin ningún secret adicional. El plan B —secrets `ADMIN_NPM_TOKEN` y `CLIENTES_NPM_TOKEN`, un PAT classic con único scope `read:packages`, con su vencimiento anotado y rotación programada— existe pero no está en uso.

Síntoma cuando el acceso automático falla: un error `E403` con `read_package` durante la instalación de dependencias. Para restablecerlo, se revisa el permiso de Actions sobre el paquete (en la configuración del paquete, no del repo) y, si eso no alcanza, se activa el plan B cargando los dos PAT como secrets, sin modificar los workflows.

**Instalación local sin configuración global**

No se toca la configuración global de npm. Cada instalación local usa un userconfig efímero: la variable `NPM_CONFIG_USERCONFIG` apunta a un archivo que referencia `${GITHUB_TOKEN}` en forma literal, no un valor pegado. El token real lo resuelve el entorno de quien instala.

**Tareas programadas**

Las dos sincronizaciones contra Alegra (`admin-alegra-sync` y `clientes-catalogo-sync`) comparten el grupo de concurrencia `alegra-cuenta`, porque pegan contra la misma cuenta y el mismo límite de requests. `clientes-pagos-reconciliar` no forma parte de ese grupo. Si ese grupo tiene una corrida pendiente, no se dispara una manual: se espera a que termine. Un traspaso o una reversión de cron se hacen en el mismo paso: deshabilitar en un lado y habilitar en el otro, nunca por separado.

Los dominios reales no se escriben en el repo: en código, tests y docs se usan `cliente.example` y `plataforma.example`; las URLs reales van en variables de entorno o secrets.

**Variables que exige el código y no están en el repo**

- `apps/clientes`: `GEOCODE_CONTACT_EMAIL`.
- `apps/admin`: `R2_ALLOWED_ORIGIN`, solo al correr a mano `scripts/r2-setup.ts`.

## Si el repo pasa a privado

Un repo privado de organización cambia varias cosas que hoy no aplican:

- Actions deja de ser gratuito y pasa a cuota facturable por minuto. El workflow `clientes-pagos-reconciliar` corre cada 15 minutos (unas 2.900 corridas por mes) y es el que más pesa en esa cuenta.
- Hace falta un plan de Vercel que admita conectar repos privados de una organización de GitHub; el plan actual puede no alcanzar.
- El secret scanning y el push protection nativos de GitHub pueden dejar de estar disponibles según el plan. El workflow `guard` de este repo sigue corriendo igual, sea cual sea el plan.
- Antes de cambiar la visibilidad, conviene verificar que no existan forks del repo: un fork de un repo público sigue siendo público aunque el original pase a privado.

El cambio de visibilidad en sí queda fuera del alcance de este trabajo.
