# Runbook: una base, esquema `shop`

> Mueve las tablas del Shop de tablas sueltas en `public` a un esquema propio
> `shop`, con una única migración base (baseline) que ya incluye el tenant, la
> auditoría de cambios de estado y el motivo de cancelación. Los Slices 2 y 3
> no necesitan ninguna otra migración.
>
> Este documento no contiene datos reales: use siempre los placeholders
> (`<OWNER_ROLE>`, `<PASSWORD_SHOP_APP>`, `<HOST_DIRECTO>`, `<HOST_POOLED>`,
> `<DB>`, `<TENANT_SLUG>`) y nunca pegue valores reales en el repo, en un PR ni
> en un issue.
>
> Estos pasos los ejecuta una persona, no un agente: implican acceso a bases
> de datos y a los paneles de Neon, Vercel y GitHub.

## Antes de empezar

- El entorno local del Shop (`apps/clientes/.env.local`) apunta hoy a
  **producción**. El Paso 0 lo repuntea a una rama de Neon antes de tocar
  cualquier otra cosa.
- `npm run db:migrate` (parado en `apps/clientes`) ejecuta
  `tsx --env-file-if-exists=.env.local src/db/migrate.ts`. Lee **solo**
  `MIGRATE_DATABASE_URL` (de `.env.local` o de la shell). Antes de aplicar
  imprime:
  ```
  [db:migrate] destino → host=<host> base=<base> rol=<rol> esquema=shop tabla=shop.__drizzle_migrations
  ```
  y al terminar:
  ```
  [db:migrate] listo: shop.__drizzle_migrations tiene 1 fila(s)
  ```
  Falla enseguida (sin tocar nada) si falta la variable, si el host contiene
  `-pooler`, o si el rol es `shop_app`. Correrlo de nuevo es seguro
  (idempotente).
- En tiempo de ejecución (la app corriendo) se lee **solo** `DATABASE_URL`.
  `SHOP_TENANT_ID` es obligatoria: sin ella el Shop no arranca
  (`src/instrumentation.ts`). Ese chequeo se salta durante `next build`, así
  que un build sin la variable compila igual — la falta recién se nota al
  levantar el servidor.

## Paso 0 — Repuntar el entorno local

**Dónde:** consola de Neon + terminal local, parado en `apps/clientes`.

1. En Neon, cree una rama `ensayo-shop` a partir de la base del admin (la
   misma que hoy usa el CRM).
2. Edite **a mano** `apps/clientes/.env.local` (los agentes nunca leen
   `.env*`, así que este paso es enteramente suyo):
   - Elimine cualquier `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING` y el
     `DATABASE_URL` viejo.
   - Agregue:
     ```
     DATABASE_URL=postgres://shop_app:<PASSWORD_SHOP_APP>@<HOST_POOLED_RAMA>/<DB>?sslmode=require
     MIGRATE_DATABASE_URL=postgres://<OWNER_ROLE>:<PASSWORD_OWNER>@<HOST_DIRECTO_RAMA>/<DB>?sslmode=require
     SHOP_TENANT_ID=<TENANT_SLUG>
     ```
     `<TENANT_SLUG>` debe ser un valor existente en `public.tenants.id`.
   - El flag `pagos` (Vercel Flags) queda apagado.

**Verificación:** abra el archivo y confirme que no queda ningún
`POSTGRES_URL*` ni un `DATABASE_URL` apuntando a producción.

## Paso 1 — Rol y esquema en la rama de Neon

**Dónde:** editor SQL de Neon, conectado a la rama `ensayo-shop`, como
`<OWNER_ROLE>`.

Ejecute:

```sql
CREATE SCHEMA IF NOT EXISTS shop AUTHORIZATION <OWNER_ROLE>;
CREATE ROLE shop_app LOGIN PASSWORD '<PASSWORD_SHOP_APP>';
GRANT USAGE ON SCHEMA shop TO shop_app;
ALTER DEFAULT PRIVILEGES FOR ROLE <OWNER_ROLE> IN SCHEMA shop GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO shop_app;
ALTER DEFAULT PRIVILEGES FOR ROLE <OWNER_ROLE> IN SCHEMA shop GRANT USAGE, SELECT ON SEQUENCES TO shop_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM shop_app;
ALTER ROLE shop_app SET search_path = shop, public;   -- red de seguridad; nada del código depende de esto
SELECT extname, extnamespace::regnamespace FROM pg_extension WHERE extname = 'unaccent';  -- esperado: public
```

`<OWNER_ROLE>` tiene que ser el mismo rol usado en `MIGRATE_DATABASE_URL`: los
`DEFAULT PRIVILEGES` solo aplican a los objetos que cree ese rol.

**Verificación:** la última consulta devuelve `unaccent` en el esquema
`public`.

## Paso 2 — Ensayo en la rama

**Dónde:** terminal local, parado en `apps/clientes`; SQL en Neon (rama
`ensayo-shop`).

1. `cd apps/clientes && npm run db:migrate`
2. **Lea el banner**: el `host=` tiene que ser el de la rama `ensayo-shop`,
   nunca producción. Al final debe imprimir
   `[db:migrate] listo: shop.__drizzle_migrations tiene 1 fila(s)`.
3. Como `<OWNER_ROLE>`, en Neon:
   ```sql
   SELECT count(*) FROM shop.__drizzle_migrations;                            -- 1
   SELECT count(*) FROM information_schema.tables WHERE table_schema='shop';  -- 16 (15 tablas + bookkeeping)
   SELECT max(created_at) FROM drizzle.__drizzle_migrations;                  -- igual que antes (bookkeeping del admin intacto)
   REVOKE ALL ON shop.__drizzle_migrations FROM shop_app;                     -- el runtime no debe poder tocar el bookkeeping
   ```
4. Como `shop_app` (conéctese con esa credencial):
   ```sql
   SELECT 1 FROM public.tenants LIMIT 1;        -- DEBE fallar (permission denied)
   SELECT 1 FROM drizzle.__drizzle_migrations;  -- DEBE fallar (permission denied)
   SELECT count(*) FROM shop.orders;            -- 0
   SELECT shop.immutable_unaccent('Cónico');    -- Conico
   ```
5. Chequeos negativos (no deberían tocar la base):
   - Sacar `MIGRATE_DATABASE_URL` del entorno y correr `npm run db:migrate` →
     falla con el mensaje explícito de la variable faltante.
   - Sacar `SHOP_TENANT_ID` y levantar `npm run dev` → el servidor se niega a
     arrancar.
6. Con la app arriba (`npm run dev`): corra `npm run sync:catalogo`, dispare
   desde el admin la sync de overlay y de cuotas (apuntando a la rama si es
   posible), busque en el catálogo con acentos, arme un pedido de prueba y
   confirme que la fila queda con `tenant_id=<TENANT_SLUG>` y aparece en "Mis
   compras".
7. Repita la búsqueda con acentos una vez más después de
   `ALTER ROLE shop_app RESET search_path;` (reconectando), para probar que
   nada depende de esa red de seguridad — y vuelva a fijarlo después.
8. Adicional (verificaciones de diseño pendientes de confirmar en una base
   real): confirme que el `CHECK` de `estado` rechaza un valor fuera de la
   lista de 6; corra
   `SELECT has_schema_privilege('shop_app','public','CREATE');` y decida si
   hace falta reforzar permisos sobre `public` según el resultado; y confirme
   que el rol del admin puede `select 1 from shop.orders` (el admin usa el rol
   dueño, así que ya alcanza `shop.*` sin ningún grant adicional).

**Esto es el gate de merge**: si algo de este paso falla, el problema se
corrige en la implementación antes de seguir — no se avanza con el resto del
runbook.

## Paso 3 — Base de producción (con el PR todavía sin mergear)

**Dónde:** editor SQL de Neon (base real, no la rama) + terminal local.

1. Corra el SQL del Paso 1 contra la base real del admin (producción).
2. Apunte **solo** `MIGRATE_DATABASE_URL` (en `.env.local`, de forma
   temporal) a la conexión directa del owner en producción — no toque
   `DATABASE_URL` ni `SHOP_TENANT_ID`, que siguen contra la rama.
3. `npm run db:migrate`, lea el banner (el `host=` ahora es el de
   producción) y confirme el mensaje final.
4. Corra la verificación SQL del Paso 2.3 y el `REVOKE` contra producción.
5. Vuelva a apuntar `MIGRATE_DATABASE_URL` a la rama `ensayo-shop`.

**Verificación:** los mismos chequeos del Paso 2.3, esta vez contra la base
real.

## Paso 4 — Vercel (proyecto Shop)

**Dónde:** panel de Vercel, proyecto del Shop, en cada environment en uso
(Production y Preview).

1. Configure `DATABASE_URL` = URL pooled de `shop_app` (producción).
2. Configure `SHOP_TENANT_ID`.
3. Borre cualquier `POSTGRES_URL*` y desconecte la integración vieja de Neon
   (si sigue conectada, puede reinyectar esas variables en el próximo
   deploy).
4. **No redespliegue todavía** — alcanza con confirmar que el preview del PR
   compila (eso valida que `next build` no necesita `SHOP_TENANT_ID`).

**Verificación:** el build del preview del PR queda en verde.

## Paso 5 — Secrets de GitHub

**Dónde:** Settings → Secrets and variables → Actions, en la raíz del repo.

1. Cree o actualice `CLIENTES_DATABASE_URL` con la URL directa (sin pooler)
   de `shop_app` de la base nueva.
2. Borre `CLIENTES_POSTGRES_URL_NON_POOLING` (ya no se usa).

**Verificación:** `CLIENTES_POSTGRES_URL_NON_POOLING` ya no aparece en la
lista de secrets.

## Paso 6 — Mergear y desplegar

Haga los Pasos 4, 5 y 6 **en una sola sesión**: el código nuevo y la base
vieja son incompatibles entre sí, en cualquiera de los dos sentidos.

1. Mergee el PR de este cambio.
2. Espere el deploy a producción.

## Paso 7 — Después del deploy

**Dónde:** GitHub Actions (workflow `clientes-catalogo-sync`) + Shop en
producción.

1. Dispare el workflow `clientes-catalogo-sync` a mano (`workflow_dispatch`)
   y confirme que termina en verde.
2. Dispare desde el admin la sync de overlay y la de cuotas.
   Qué lee el Shop del overlay y cuándo encender su filtro de visibilidad:
   `docs/catalogo-overlay.md`.
3. Humo: catálogo visible, búsqueda con acentos funciona, un pedido de
   prueba se puede armar, "Mis compras" lo muestra. Los perfiles de
   facturación y los vínculos de cliente arrancan vacíos — es esperado, no
   hay datos que rescatar de la base vieja.

## Después: limpieza

- Deje la base vieja del Shop intacta: es el respaldo de rollback. Se da de
  baja en un cambio aparte, más adelante.
- Borre la rama `ensayo-shop` de Neon cuando ya no la necesite.

## Rollback

Revierta el PR y restaure el entorno de Vercel más el secret de GitHub
**juntos, en la misma operación**: el código nuevo con la base vieja (o el
código viejo con la base nueva) no funcionan. La base vieja del Shop no se
tocó en ningún momento, así que no hay pérdida de datos.

Si además quiere limpiar el esquema nuevo:

```sql
DROP SCHEMA shop CASCADE;
DROP ROLE shop_app;
```

(no toca `public` ni `drizzle`).

## Nota para el Slice 2 (flag `pagos`)

No necesita ningún paso de base de datos. Se despliega con los pagos
apagados desde el arranque (flag `pagos` apagado). Para habilitarlos
más adelante: prenda el flag `pagos` en Vercel Flags (sin redeploy). Para
volver atrás: apague el flag o revierta el PR — los pedidos
`a_coordinar` que ya se generaron quedan válidos igual.

## Nota para el Slice 3 (admin "Pedidos")

No agrega ninguna migración: usa las tablas de este baseline. **No se puede
mergear antes de que este Slice 1 esté desplegado en producción** — el
código del admin espera columnas que recién existen después del Paso 6. Al
desplegarlo, pruebe como operador y como admin: listar pedidos, filtrar, ver
el detalle, pasar un pedido de "pendiente" a "confirmado", cancelar con
motivo, y confirmar que el cliente ve el nuevo estado en "Mis compras".

## Migraciones posteriores a la baseline

La baseline ya está aplicada en producción: todo cambio de esquema del Shop se
suma como una migración incremental (`ALTER`), nunca regenerando la baseline.
`src/db/baseline.test.ts` controla que cada `.sql` tenga su entrada en el
journal, que ninguna migración posterior recree tablas de la baseline y que
toda tabla nueva viva en el esquema `shop` (nunca en `public`).

| Migración | Qué hace | Cuándo aplicarla |
|---|---|---|
| `0001_telefono_contacto` | `billing_profiles.telefono` (teléfono de contacto que el checkout precarga) | **Antes** de desplegar el código que la usa: el Shop selecciona la columna al leer el perfil y sin ella cae el checkout y Mis datos. |
| `0002_favoritos` | `shop.favorites` (favoritos de Mi cuenta: tenant, usuario de Clerk e ítem, con unique por los tres) | **Antes** de mergear y desplegar la rebanada de favoritos: el Shop la lee en el resumen de Mi cuenta, en `/mi-cuenta/favoritos` y en la API del corazón (catálogo, home y ficha). |
| `0003_direcciones_envio` | `shop.direcciones_envio` (direcciones de envío de Mi cuenta: tenant, usuario de Clerk, etiqueta, calle, ciudad, provincia, CP, referencias y `predeterminada`), índice por (tenant, usuario) e índice único **parcial** por (tenant, usuario) `WHERE predeterminada` | **Antes** de mergear y desplegar la rebanada de direcciones: el Shop la lee en `/mi-cuenta/direcciones`, en su API y en el checkout (con Clerk). El checkout tolera que falte (lista vacía y lo registra en el log), Mi cuenta no. |

El comando es el mismo (`npm run db:migrate` parado en `apps/clientes`, con
`MIGRATE_DATABASE_URL` apuntando a la base directa). Al terminar,
`shop.__drizzle_migrations` tiene una fila más.

Rollback de `0002_favoritos` (sólo si hay que retroceder la base; revertir el
código alcanza, la tabla sin lectores es inofensiva): a mano y dejándolo
registrado, `DROP TABLE "shop"."favorites";` y borrar la fila de
`0002_favoritos` en `shop.__drizzle_migrations` (la de `created_at` más
reciente), para que un próximo `db:migrate` la vuelva a aplicar.

Rollback de `0003_direcciones_envio` (mismo criterio): `DROP TABLE
"shop"."direcciones_envio";` (arrastra sus dos índices) y borrar la fila de
`0003_direcciones_envio` en `shop.__drizzle_migrations`.

Verificación de `0003` después de aplicarla, como `<OWNER_ROLE>`:

```sql
SELECT count(*) FROM shop.__drizzle_migrations;          -- 4
SELECT indexname, indexdef FROM pg_indexes
 WHERE schemaname = 'shop' AND tablename = 'direcciones_envio';
-- direcciones_envio_pkey, dir_envio_tenant_usuario y
-- dir_envio_una_predeterminada (... WHERE predeterminada)
```

El rol `shop_app` recibe `SELECT, INSERT, UPDATE, DELETE` sobre la tabla
nueva por los `DEFAULT PRIVILEGES` del Paso 1 (la crea `<OWNER_ROLE>`).

Las tablas que suma Mi cuenta (favoritos y direcciones de envío) y cómo las usan sus rutas están en
[`docs/mi-cuenta.md`](./mi-cuenta.md).

## Lectura directa del catálogo del CRM

El Shop lee el catálogo comercial (categorías propias y overlay) directo de
las tablas del CRM, sin copia. Como el Paso 1 le quita a `shop_app` todo
permiso sobre `public`, hay que dárselo explícito, sólo de lectura y sólo
sobre esas dos tablas.

**Dónde:** editor SQL de Neon, en la base de producción (y en cada rama donde
corra el Shop), como `<OWNER_ROLE>`.

```sql
GRANT USAGE ON SCHEMA public TO shop_app;
GRANT SELECT ON public.shop_categories, public.catalog_overlay TO shop_app;
```

**Verificación**, como `shop_app`:

```sql
SELECT count(*) FROM public.shop_categories;   -- responde (no permission denied)
SELECT count(*) FROM public.catalog_overlay;   -- responde
SELECT alegra_token FROM public.tenants LIMIT 1;  -- sigue fallando (permission denied)
```

(Con la migración 0032 del CRM, `shop_app` puede leer CUATRO columnas de
`public.tenants`; ver la sección siguiente. Las credenciales siguen vedadas.)

Sin este paso, el catálogo, las facetas y el menú fallan con
`permission denied for table catalog_overlay`.

## Cuenta corriente: lectura/escritura en public

La cuenta corriente del cliente de la tienda (Facturas y saldo, Pagos,
Presupuestos, Condiciones, Avisos, Informar pago) vive en Mi cuenta del Shop
(change `portal-al-shop`). Lee y escribe tablas del CRM en `public`, con
permisos mínimos y por columna. **Todos** los concede la migración
`apps/admin/drizzle/0032_shop_cuenta_corriente.sql` (dueño del DDL: el CRM),
dentro de un bloque que sólo corre si el rol `shop_app` existe.

| Objeto | Permiso | Para qué | Reversa |
|---|---|---|---|
| esquema `public` | `USAGE` | llegar a las tablas | (se comparte con el catálogo: no revocar) |
| vista `alegra_contacts_shop` (20 columnas) | `SELECT` | razón social, CUIT, tipo de cuenta, plazo, vendedor, límite | `REVOKE SELECT ON public.alegra_contacts_shop FROM shop_app;` |
| `tenants` (`id`, `name`, `whatsapp_number`, `receipts_email`) | `SELECT` por columna | WhatsApp de la empresa y mail de comprobantes | `REVOKE SELECT ON public.tenants FROM shop_app;` |
| `client_commercial_conditions` | `SELECT` | descuentos, transporte, contacto del vendedor | `REVOKE SELECT ON public.client_commercial_conditions FROM shop_app;` |
| `notification_log` | `SELECT`, `UPDATE (read_at)` | avisos y "marcar como leído" | `REVOKE SELECT, UPDATE ON public.notification_log FROM shop_app;` |
| `payment_receipts` | `SELECT`, `INSERT` | informar pago, Mis comprobantes | `REVOKE SELECT, INSERT ON public.payment_receipts FROM shop_app;` |
| `payment_receipts` | `UPDATE (status, processing_started_at, reject_reason, file_key, file_mime, file_size, file_sha256, converted_from, email_status, email_error, email_sent_at, email_attempts, email_last_attempt_at, submitted_at, updated_at)` | confirmar/rechazar el comprobante y registrar el mail | `REVOKE UPDATE ON public.payment_receipts FROM shop_app;` |

Nunca: `DELETE` en ninguna tabla de `public`; `UPDATE` de `loaded_*`,
`alegra_payment_*`, `declared_*`, `amount` ni `codigocliente`; `SELECT` de
la tabla `alegra_contacts` (tiene `raw` y teléfonos) ni de otras columnas de
`tenants` (credenciales de Alegra y de la ai-api).

Lo que el Shop declara de estas tablas está en `src/db/crm.ts` y el contrato
de columnas en `src/db/__fixtures__/crm-contrato.json`
(`src/db/crm-contrato.test.ts`).

**Orden de despliegue:** la 0032 se aplica a mano contra la base de producción
(`npm run db:migrate` en `apps/admin`, confirmando antes la URL) **antes** de
mergear cualquier código del Shop que lea estas tablas: el Shop declara la
vista con 20 columnas, y sin la 0032 toda consulta a la vista falla.

**Si `shop_app` se crea después de la 0032** (rama nueva, base recreada), el
bloque condicional no concedió nada: córralo a mano como `<OWNER_ROLE>`,
copiándolo del final de `0032_shop_cuenta_corriente.sql` (el `DO $$ … $$`).

**Verificación**, conectado como `shop_app` a la base del runtime del Shop:

```sql
SELECT tipo_cuenta, seller_name, payment_term_name, payment_term_days, credit_limit
  FROM public.alegra_contacts_shop LIMIT 1;                     -- responde
SELECT raw FROM public.alegra_contacts LIMIT 1;                 -- permission denied
SELECT name, whatsapp_number, receipts_email FROM public.tenants LIMIT 1;  -- responde
SELECT * FROM public.tenants LIMIT 1;                           -- permission denied
SELECT alegra_token FROM public.tenants LIMIT 1;                -- permission denied
SELECT count(*) FROM public.client_commercial_conditions;       -- responde
SELECT count(*) FROM public.notification_log;                   -- responde
BEGIN; UPDATE public.notification_log SET read_at = read_at WHERE false; ROLLBACK;  -- responde
BEGIN; UPDATE public.notification_log SET status = status WHERE false; ROLLBACK;    -- permission denied
BEGIN; DELETE FROM public.payment_receipts WHERE false; ROLLBACK;                   -- permission denied
BEGIN; UPDATE public.payment_receipts SET amount = amount WHERE false; ROLLBACK;    -- permission denied
```

**Rollback completo:** revertir primero el código del Shop que usa estas
tablas; después, los `REVOKE` de la tabla (también están en el encabezado de
la 0032). Volver la vista a 16 columnas es una migración nueva del CRM
(`DROP VIEW` + `CREATE VIEW` + `GRANT`), nunca editar la 0032.

## Lectura directa de contactos del CRM

Change `espejo-contactos-alegra`, rebanada 3. La vinculación de la cuenta, el
perfil de facturación, el tipo de cuenta y la lista de precios del cliente
leen el **espejo de contactos** del CRM por la vista
`public.alegra_contacts_shop` (la misma de la sección anterior), en vez de
consultar `/contacts` de Alegra en vivo. `/contacts` admite ~5 requests por
minuto por cuenta y lo comparten el CRM, el bot y el Shop.

| Lectura (`src/lib/contactos-espejo.ts`) | Filtro en la vista | Sin fila activa |
|---|---|---|
| `contactosPorEmail` (vinculación automática) | `emails_norm @> [email]` y `types @> ['client']` | 1 búsqueda en vivo `email=` antes de grabar `sin_coincidencia` |
| `contactoPorDocumento` (vinculación por OTP) | `identification_norm = dígitos`; desempate: cliente, id numérico menor | 1 búsqueda en vivo por documento (la de siempre) |
| `contactoPorDocumento` (perfil de facturación) | ídem | ninguno: `coincide_con_alegra = null` |
| `vinculablePorId` (confirmar el OTP) | `alegra_id` | sólo se usa si Alegra en vivo falla |
| `comercialEspejo` (tipo de cuenta y lista del cliente) | `alegra_id` | snapshot de `shop.client_links` |

Todas filtran `tenant_id = SHOP_TENANT_ID`, `alegra_account = 'principal'` y
`status = 'active'`. La lista de precios que usan el carrito y el pedido sale
del espejo (si la lista está dada de baja, la principal); sin fila, del
snapshot del vínculo; sin nada, la principal. 0 requests a Alegra, y sin
control en vivo al confirmar: la tienda respeta sus propios precios.

**Permisos:** los mismos de la sección anterior (`SELECT` sobre la vista, que
conceden las migraciones 0031/0032 del CRM si `shop_app` ya existía). Nada nuevo.

**Verificación antes de mergear** (M3.1), conectado como `shop_app` a la base a
la que apunta el **runtime** del Shop (`DATABASE_URL`, no
`MIGRATE_DATABASE_URL`: pueden ser ramas distintas de Neon):

```sql
SELECT count(*) FROM public.alegra_contacts_shop;   -- responde, con el conteo de la sync
```

Si da `permission denied` (42501), correr como `<OWNER_ROLE>`:

```sql
GRANT USAGE ON SCHEMA public TO shop_app;
GRANT SELECT ON public.alegra_contacts_shop TO shop_app;
```

Si la vista no responde en runtime, nada se cae: la vinculación vuelve a la
búsqueda en vivo, el perfil de facturación guarda `coincide_con_alegra = null`
y el tipo de cuenta y la lista salen del snapshot del vínculo (queda un
`console.error` con el código de Postgres, nunca datos del contacto).

**Backfill después del deploy** (M3.4), como `<OWNER_ROLE>`, con
`<TENANT_SLUG>` = el valor de `SHOP_TENANT_ID` (no escribirlo en el repo):

```sql
UPDATE shop.client_links cl SET tipo_cuenta = ac.tipo_cuenta
FROM public.alegra_contacts ac
WHERE cl.tipo_cuenta IS NULL AND cl.estado = 'activa'
  AND ac.tenant_id = '<TENANT_SLUG>' AND ac.alegra_account = 'principal'
  AND ac.alegra_id = cl.alegra_contact_id;

-- Los que siguen sin tipo (sin fila en el espejo):
SELECT count(*) FROM shop.client_links WHERE estado = 'activa' AND tipo_cuenta IS NULL;
```

No es imprescindible (el Shop ya prefiere el espejo al snapshot), pero deja el
snapshot útil para cuando la vista no responda.

**Rollback:** revertir el PR; el Shop vuelve a buscar en vivo. La vista y su
`GRANT` pueden quedar (los usa también Mi cuenta). Sólo si se revierte además
la cuenta corriente: `REVOKE SELECT ON public.alegra_contacts_shop FROM shop_app;`.

## Stock y precio desde el espejo del CRM

Change `webhooks-stock-alegra`, rebanada 4. El CRM mantiene su espejo de
productos (`public.catalog_products`) con la sync diaria y, además, con los
webhooks de stock de Alegra: una factura o una compra re-leen sus ítems en
minutos. El Shop lee de ahí stock, precios y estado por la vista angosta
`public.catalog_products_shop` (migración 0035 del CRM; declarada en
`src/db/crm.ts` como `crmStock`):

| Columna | Qué es |
|---|---|
| `tenant_id`, `alegra_id` | clave; el Shop filtra por `SHOP_TENANT_ID` en el join |
| `stock` | inventario total del ítem (null = no inventariable) |
| `precios_alegra` | `raw->'price'` tal cual lo manda Alegra; el Shop lo normaliza con `mapPrecios` (misma forma que su espejo, con `main`) |
| `activo` | visto en la última sync del CRM y no inactivo en Alegra |
| `alegra_leido_at` | cuándo se le pidió el dato a Alegra (null = todavía no pasó una sync ni un webhook) |

**Regla: por fila, la leída más tarde gana** (`src/lib/stock-disponible.ts`).
Si `alegra_leido_at` del CRM es posterior al `synced_at` de
`shop.catalog_products`, stock, precios y estado salen del CRM; si no (o si el
CRM no tiene la fila), del espejo del Shop. Aplica igual al catálogo, las
facetas, el menú, la ficha, el carrito y `POST /api/pedidos` (que valida y
calcula con una sola cotización). Nombre, descripción, marca, categoría e IVA
siguen saliendo del espejo del Shop, y la sync diaria del Shop sigue corriendo:
es el respaldo de las filas que el CRM no tiene más frescas.

**Permisos:** `SELECT` sobre la vista, que concede la 0035 si `shop_app` ya
existía. A diferencia de la vista de contactos, **no hay plan B**: sin permiso
fallan el catálogo, la ficha y la cotización. Verificación, como `shop_app`,
contra la base del **runtime** (`DATABASE_URL`):

```sql
SELECT count(*) FROM public.catalog_products_shop;    -- responde
SELECT 1 FROM public.catalog_products LIMIT 1;        -- falla (permission denied)
```

Si la primera da `permission denied` (42501), correr como `<OWNER_ROLE>`:

```sql
GRANT USAGE ON SCHEMA public TO shop_app;
GRANT SELECT ON public.catalog_products_shop TO shop_app;
```

**Comparación entre espejos** (como `<OWNER_ROLE>`, `<TENANT_SLUG>` = el valor
de `SHOP_TENANT_ID`, no escribirlo en el repo). Sólo ids y conteos:

```sql
SELECT count(*) FILTER (WHERE c.alegra_id IS NULL)                          AS sin_fila_crm,
       count(*) FILTER (WHERE c.stock IS DISTINCT FROM cp.stock)            AS stock_distinto,
       count(*) FILTER (WHERE c.alegra_leido_at > cp.synced_at)             AS crm_mas_fresco,
       count(*) FILTER (WHERE c.alegra_leido_at > cp.synced_at
                          AND c.activo IS DISTINCT FROM (cp.status = 'active')) AS cambia_estado
FROM shop.catalog_products cp
LEFT JOIN public.catalog_products_shop c
  ON c.alegra_id = cp.alegra_id AND c.tenant_id = '<TENANT_SLUG>';
```

`crm_mas_fresco` es cuántas filas toman hoy el dato del CRM; `cambia_estado`,
cuántas de ésas se muestran u ocultan distinto que con el espejo del Shop solo.

**Rollback:** revertir el PR; el Shop vuelve a leer sólo `shop.catalog_products`.
Recién después, si se quiere, la reversa de la 0035 (ver su encabezado).

## Facturación del vinculado desde el espejo (write-through)

Change `contacto-fuente-unica`. Para el comprador **vinculado** (Clerk con
vínculo o cookie del CRM) los datos de facturación salen del espejo de
contactos, no del perfil: `src/lib/datos-del-contacto.ts` es la lectura única
que usan el checkout, `POST /api/pedidos`, `PUT /api/mi-cuenta/facturacion` y
Mis datos. El no vinculado sigue con `shop.billing_profiles`.

| Pieza | Dónde | Qué hace |
|---|---|---|
| 7 columnas de facturación en la vista (27 en total) | migración **0034** del CRM | `iva_condition`, `identification_type/number`, `address_street/city/province/postal_code`, generadas desde `raw` (vacío ⇒ NULL) |
| `public.shop_contacto_write_through(text, text, text, jsonb)` | 0034 del CRM, `SECURITY DEFINER` | después de un PUT del Shop a Alegra deja la fila del espejo al día; sólo llena vacíos (D1 también en la base); `'ok' \| 'sin_fila' \| 'rechazado'` |
| 3 teléfonos en la vista (30 en total): `phone_primary`, `phone_secondary`, `mobile` | migración **0036** del CRM | el checkout precarga el de Alegra (celular > principal > secundario) y no lo vuelve a pedir; Mis datos los muestra en lectura |
| fila "sólo teléfono" en `shop.billing_profiles` | migración **0009** del Shop | documento, razón social y condición admiten NULL: el vinculado guarda su teléfono aunque no tenga perfil |
| `shop.orders.motivo_revision` | migración **0010** del Shop | por qué el pedido requiere revisión (el más importante): `documento_incompatible` > `condicion_iva_desconocida` > `facturacion_en_pedido` > `otra_lista_precios`; el admin del CRM muestra un texto por motivo |

**Permisos de `shop_app`:** `SELECT` sobre la vista y `EXECUTE` sobre la
función, los concede el bloque `DO $$ … $$` del final de la 0034 del CRM
(correrlo de nuevo si `shop_app` se crea después). Sigue sin `UPDATE` sobre
`public.alegra_contacts`.

**Reglas:** el Shop sólo completa campos VACÍOS en Alegra (nunca cambia un
valor presente); el perfil complementa al espejo sólo con el mismo documento;
si Alegra falla (tope de `/contacts` como 400 `{"code":429}`, timeout de 8 s)
la compra sigue: lo cargado va al perfil (Clerk) o con el pedido (cookie),
marcado para revisión. La provincia es opcional y se elige de la lista oficial
(`src/lib/provincias.ts`, 24 jurisdicciones con el nombre que usa Alegra).

**Teléfono del vinculado:** sale del espejo (0036 del CRM). Si Alegra no tiene
ninguno, se pide en el checkout como siempre; lo tipeado va al pedido, al
perfil (con Clerk) y, en `after()`, a Alegra como `phonePrimary` SÓLO si el
contacto fresco (GET en vivo) sigue sin ningún teléfono. La función
`shop_contacto_write_through` no mira teléfonos: esa guarda la hace el Shop, y
las columnas de teléfono del espejo se ponen al día con el webhook o la sync.
**Orden de despliegue:** este código selecciona las columnas de la 0036; la
0036 tiene que estar aplicada en prod ANTES de mergear el PR del Shop.

**Motivo de revisión (0010):** `src/lib/motivo-revision.ts` decide. Comprar a
la lista general NO es motivo: un no vinculado cuyo documento es de un
contacto de Alegra se marca (`otra_lista_precios`) sólo si ese contacto tiene
una lista usable distinta de la general (la `main` de los precios del espejo
de productos). Sin CHECK en la base. Pedidos anteriores: `motivo_revision`
NULL y el CRM muestra el texto genérico. **Orden:** el CRM y el Shop
seleccionan la columna; la 0010 va aplicada en prod ANTES del merge.

**Tipo CUIL:** cuando Alegra no tiene tipo de documento, un consumidor final
con 11 dígitos que empiezan en 20/23/24/27 se deduce CUIL. No está verificado
que Alegra acepte `"CUIL"` en el PUT: si lo rechaza, pasar
`ESCRIBIR_CUIL_EN_ALEGRA` a `false` en `src/lib/contacto-alegra.ts`.

**Verificación después de aplicar la 0009** (como `<OWNER_ROLE>`, sólo conteos):

```sql
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_schema = 'shop' AND table_name = 'billing_profiles'
  AND column_name IN ('tipo_doc', 'nro_doc', 'razon_social', 'condicion_iva');  -- las 4 en YES
```

**Verificación después de aplicar la 0010** (como `<OWNER_ROLE>`, sólo agregados):

```sql
SELECT count(*) FROM shop.__drizzle_migrations;                          -- 11
SELECT count(*) FROM information_schema.columns
WHERE table_schema = 'shop' AND table_name = 'orders' AND column_name = 'motivo_revision';  -- 1
SELECT has_column_privilege('shop_app', 'shop.orders', 'motivo_revision', 'SELECT');         -- true
```

**Rollback:** revertir el PR del Shop primero (la 0009 y la 0010 pueden
quedar: afloja NOT NULL / columna nullable). Las reversas están en sus cabeceras.

## Nota sobre el ambiente local de tests (`crm_test`)

Si en algún momento se regenera el baseline (`drizzle/0000_baseline.sql`)
antes de mergear este cambio, un `crm_test` local que ya tenía el esquema
`shop` aplicado queda con la forma vieja: el migrador solo compara la fecha
de la migración, no su contenido. Corra una vez
`DROP SCHEMA shop CASCADE;` sobre ese `crm_test` local para que la próxima
corrida de tests lo vuelva a crear desde cero.
