# Dominios múltiples del Shop (un código, dos proyectos de Vercel)

Change `dominios-clerk-por-host`. Runbook para servir **la misma tienda** desde dos dominios y, más
adelante, cambiar cuál es el principal. Dominios de ejemplo (reservados `.example`):

- `cliente.example`: el dominio actual (proyecto A). Hoy es el principal.
- `tienda-b.example`: el dominio nuevo (proyecto B). Hoy es el secundario; el destino es que pase a
  ser el principal.

## 1. Qué es y cómo funciona

- El mismo código (`apps/clientes`) corre como **dos proyectos de Vercel** del mismo repo: A y B.
  Misma base Postgres, mismo tenant (`SHOP_TENANT_ID`), mismo catálogo, mismos pedidos.
- Cada proyecto tiene **su propia app de Clerk en producción**. El plan gratuito permite un solo
  dominio por app, así que las sesiones y los clientes de Clerk quedan **separados por dominio**: una
  persona registrada en `cliente.example` no existe en `tienda-b.example` (se registra de nuevo). Los
  carritos tampoco se comparten entre dominios.
- La base es una sola, por lo que pedidos, catálogo, listas de precio y stock son los mismos en los
  dos.
- **CRM (`apps/admin`)**: `tenants.shop_url` es el Shop principal. Los demás van en
  `tenants.shop_destinos_extra` (jsonb, migración 0099): lista de `{ etiqueta, url, urlInterna? }`,
  hasta 4. El ping de revalidación (catálogo, sucursales, marca) sale a **todos** los destinos en
  paralelo, 5 s de timeout por destino. Cada extra usa **su propio secreto**,
  `SHOP_CRM_SECRET_<TENANT>__<ETIQUETA>` (mayúsculas, `-` pasa a `_`); el principal usa
  `SHOP_CRM_SECRET_<TENANT>` (o el histórico sin sufijo). Un extra sin secreto se **omite**: nunca
  presta el de otro. El resultado es `{ propagado, fallidos? }`; `propagado` es `true` solo si todos
  respondieron OK y ninguno quedó omitido. El endpoint del Shop no cambia.
- **SEO**: el secundario define `NEXT_PUBLIC_CANONICAL_URL` apuntando al principal. Con eso
  canonical, `metadataBase` y JSON-LD salen con la base del principal, el sitemap devuelve vacío y
  `robots` no lleva línea `Sitemap:` (`src/lib/sitio-url.ts`). Sin esa variable todo funciona como
  siempre.
- **Mails**: `shop.orders.sitio_origen` (migración 0044) guarda el `NEXT_PUBLIC_SITE_URL` del
  despliegue donde se creó el pedido. Los mails del Shop enlazan a ese sitio. Los mails del CRM
  (estado, factura) usan la URL configurada del principal o del extra que coincida con
  `sitio_origen`; si no hay coincidencia, el principal.

## 2. Fase 1: B entra como destino extra, A sigue siendo el principal

Los pasos se numeran como en el plan (U2 a U8, U14). Nada de esto cambia el comportamiento de A.

### U2. Crear el proyecto B en Vercel

1. Nuevo proyecto desde el **mismo repo**, Root Directory `apps/clientes`, mismo framework y mismo
   comando de build que A.
2. `apps/clientes/vercel.json` ya trae `git.deploymentEnabled` (solo `main` y `staging`) y un
   `ignoreCommand` que evita builds cuando no cambió nada bajo `apps/clientes`. Como el archivo es
   del código, B lo hereda; no hay que configurarlo a mano.
3. Agregar el dominio `tienda-b.example` al proyecto B (en Vercel) y verificar.

### U3. App de Clerk en producción para B

1. Crear una app de Clerk **de producción nueva** con el dominio `tienda-b.example`.
2. Cargar en el DNS de `tienda-b.example` los CNAME que indica Clerk (frontend API, cuentas, correo
   y DKIM) y esperar a que Clerk los marque como verificados.
3. **Google OAuth propio**: crear un cliente OAuth de Google exclusivo para B (origen autorizado y
   redirect de `tienda-b.example` / el dominio de Clerk de la app nueva) y cargarlo en la app de
   Clerk de B. No reutilizar el de A.
4. **Webhook**: en la app de Clerk de B, endpoint `https://tienda-b.example/api/webhooks/clerk`
   con los mismos eventos que A. Su signing secret es `CLERK_WEBHOOK_SIGNING_SECRET` de B.

### U4. Variables de entorno de B

La tabla sale de las `process.env.*` que lee `apps/clientes/src`. "Propia" = valor distinto al de A;
"Compartida" = mismo valor en A y B. Las de Clerk que no figuran en el código
(`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) las lee el SDK de Clerk directamente.

| Variable | B | Nota |
|----------|---|------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Propia | De la app de Clerk de B. El host de Clerk que se autoriza en la CSP **se deriva de esta clave**: no hay que tocar la CSP. |
| `CLERK_SECRET_KEY` | Propia | De la app de Clerk de B. |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Propia | Del webhook de U3. |
| `SHOP_CRM_SECRET` | Propia | Secreto nuevo para B; el mismo valor se carga en el admin como `SHOP_CRM_SECRET_<TENANT>__<ETIQUETA>` (U7). |
| `NEXT_PUBLIC_SITE_URL` | Propia | `https://tienda-b.example`. |
| `NEXT_PUBLIC_CANONICAL_URL` | Propia (solo en el secundario) | Mientras A es el principal, B apunta a `https://cliente.example`. En la Fase 2 se invierte (ver sección 4). |
| `COOKIE_DOMAIN` | Propia | Si A la define, B necesita la suya con su dominio; si A no la define, tampoco B. |
| `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `MIGRATE_DATABASE_URL` | Compartida | Misma base. Solo migra quien corre `db:migrate`; los deploys no migran. |
| `SHOP_TENANT_ID` | Compartida | Mismo tenant. |
| `REDIS_URL`, `UPSTASH_REDIS_REST_REDIS_URL` | Compartida | Rate limit. |
| `ALEGRA_BASE_URL`, `ALEGRA_EMAIL`, `ALEGRA_TOKEN` | Compartida | Las mismas cuentas de Alegra. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Compartida | Ver U8 para el dominio remitente. |
| `SESSION_SECRET`, `OTP_SECRET` | Compartida o propia | Si se comparten, las sesiones propias del Shop valen en ambos hosts; si no, quedan separadas. Cualquiera de las dos sirve, pero que sea una decisión consciente. |
| `CRON_SECRET` | Compartida | Mismo valor que el secreto `CLIENTES_CRON_SECRET` de GitHub si el workflow apunta a B. |
| `CRM_ADMIN_URL`, `JEV_API_KEY`, `GEOCODE_CONTACT_EMAIL` | Compartida | |
| `HOSTS_IMAGENES`, `SHOP_MEDIA_HOSTS`, `NEXT_PUBLIC_SHOP_MARCA_NOMBRE` | Compartida | |
| `FACEBOOK_DOMAIN_VERIFICATION` | Propia | Meta verifica por dominio (U8). |
| `GOOGLE_SITE_VERIFICATION` | Propia (opcional) | Search Console por etiqueta HTML cuando el DNS del dominio no está a mano. |
| `POSTHOG_REGION`, `DEBUG_SQL`, `SITE_AUTH_USER`, `SITE_AUTH_PASSWORD` | Según el caso | El gate "Próximamente" y el debug, solo si B los necesita. |

Mercado Pago: la `notification_url` se arma con el origin del request, así que cada proyecto
notifica a su propio host sin configuración adicional.

### U5. Vercel Flags en B

Conectar el proyecto B al mismo conjunto de flags que A (Flags en el dashboard de Vercel, proyecto B
conectado al almacén de flags del equipo). Verificar que los flags que gobiernan el checkout y los
pagos devuelvan lo mismo en B que en A antes de abrir al público.

### U6. Webhooks y conciliación de pagos

- **Mercado Pago**: no hay nada que configurar por proyecto en código (ver nota de U4). En el panel
  de MP, la notificación de cada cuenta sigue llegando al host desde el que se creó la preferencia.
- **Conciliación** (`.github/workflows/clientes-pagos-reconciliar.yml`): el secret
  `CLIENTES_BASE_URL` apunta a **un solo** proyecto. Recomendado: el **principal** (hoy A; al
  cambiar el principal, se actualiza el secret). Es seguro porque la base es compartida: la
  conciliación revisa los pedidos pendientes de la base, sin importar en qué dominio se crearon.
  Si el workflow se apunta a B, `CRON_SECRET` de B debe coincidir con `CLIENTES_CRON_SECRET`.

### U7. CRM: destino extra, secreto y redeploy

1. Elegir la etiqueta de B, p. ej. `tienda-b` (minúsculas, dígitos y `-`, hasta 24 caracteres;
   `principal` está reservada).
2. En el admin (producción **y** staging) crear la env `SHOP_CRM_SECRET_<TENANT>__TIENDA_B` con el
   mismo valor que `SHOP_CRM_SECRET` de B. Sin esa env, el destino se omite.
3. Cargar el destino con el script (por defecto simula; `--aplicar` escribe):

   ```bash
   cd apps/admin
   npx tsx scripts/shop-destinos-extra.ts          # dry-run
   npx tsx scripts/shop-destinos-extra.ts --aplicar
   ```

   El resultado en la columna es `[{ "etiqueta": "tienda-b", "url": "https://tienda-b.example" }]`
   (`urlInterna` solo si el ping debe ir a otro origin).
4. Redeploy del admin para que tome la env nueva.
5. Probar: guardar algo del catálogo y verificar `propagado: true` sin `fallidos`.

### U8. Analítica, Search Console, remitente y Meta

- **Analítica**: agregar `tienda-b.example` como dominio en el tracking (PostHog, GA4, Pixel). Los
  proyectos comparten la misma propiedad; verificar que los eventos lleguen con el host correcto.
- **Search Console**: alta de la propiedad de `tienda-b.example`. Mientras B es secundario, no se
  envía sitemap (devuelve vacío) y las páginas declaran canonical al principal.
- **Resend**: si el remitente de los mails debe salir del dominio nuevo, verificar el dominio en
  Resend (SPF/DKIM) y ajustar `EMAIL_FROM` de B.
- **Meta**: verificar el dominio `tienda-b.example` en el Business Manager y cargar el valor en
  `FACEBOOK_DOMAIN_VERIFICATION` de B.

### U14. Prueba punta a punta (checklist)

- [ ] `https://tienda-b.example` carga la home, el catálogo y una ficha.
- [ ] El `<link rel="canonical">` de B apunta a `cliente.example`; `/sitemap.xml` de B está vacío y
      `/robots.txt` no tiene `Sitemap:`.
- [ ] Registro e ingreso con email y con Google en B (cliente nuevo, separado de A).
- [ ] El webhook de Clerk de B crea el vínculo (log del webhook sin errores).
- [ ] Carrito, checkout y pedido en B: queda `shop.orders.sitio_origen = 'https://tienda-b.example'`.
- [ ] Pago de prueba en B vuelve al host de B y el webhook de MP actualiza el pedido.
- [ ] El mail del pedido (Shop) enlaza a `tienda-b.example`.
- [ ] Desde el CRM, cambiar el estado o vincular factura: el mail enlaza al sitio de origen.
- [ ] Guardar algo del catálogo en el CRM: `propagado: true`, y el cambio se ve en A y en B.
- [ ] Un pedido hecho en A sigue enlazando a A (regresión).

## 3. U15. Completar `sitio_origen` de los pedidos anteriores

Los pedidos creados antes de la migración 0044 tienen `sitio_origen` en `NULL` y el CRM los trata
como del principal. Si el principal va a cambiar (Fase 2), conviene fijar el origen real **antes**,
para que sus mails sigan enlazando al dominio donde se hicieron.

Correr **solo después** de que el código de 0044 esté desplegado en producción de A (si no, un
pedido nuevo de A podría entrar con `NULL` después del UPDATE):

```sql
UPDATE shop.orders
SET sitio_origen = 'https://cliente.example'
WHERE sitio_origen IS NULL
  AND tenant_id = '<tenant>';
```

Verificar:

```sql
SELECT sitio_origen, count(*)
FROM shop.orders
WHERE tenant_id = '<tenant>'
GROUP BY 1
ORDER BY 2 DESC;
```

No debería quedar ninguna fila con `sitio_origen IS NULL`. Es un UPDATE acotado por tenant; si se
corre contra producción, confirmar primero a qué base se está conectado.

## 4. Fase 2 / U16: cambiar el principal (B pasa a principal)

Hacerlo con U15 ya aplicado y U14 verde.

1. **Base**: en `tenants`, `shop_url` pasa a `https://tienda-b.example` (y `shop_internal_url`,
   si estaba definido, al de B); A pasa a `shop_destinos_extra` con una etiqueta propia, p. ej.
   `cliente`:

   ```sql
   UPDATE tenants
   SET shop_url = 'https://tienda-b.example',
       shop_destinos_extra = '[{"etiqueta":"cliente","url":"https://cliente.example"}]'::jsonb
   WHERE id = '<tenant>';
   ```

2. **Secretos del admin (prod y staging)**: se **intercambian**.
   - `SHOP_CRM_SECRET_<TENANT>` (principal) pasa a tener el valor del secreto de B.
   - `SHOP_CRM_SECRET_<TENANT>__CLIENTE` (extra) toma el valor del secreto de A.
   - Borrar `SHOP_CRM_SECRET_<TENANT>__TIENDA_B`, que ya no se usa.
3. **Redeploy del admin**. Entre el UPDATE y el redeploy hay una ventana corta en la que el ping
   sale con `propagado: false` (secretos cruzados); es esperable y se resuelve sola con el redeploy.
   Hacer el UPDATE y el cambio de envs seguidos.
4. **SEO**: en el proyecto A, `NEXT_PUBLIC_CANONICAL_URL=https://tienda-b.example` y redeploy. En B,
   **borrar** `NEXT_PUBLIC_CANONICAL_URL` (ya es el principal) y redeploy: vuelven el sitemap y la
   línea `Sitemap:` de robots.
5. Search Console: enviar el sitemap de B. Actualizar `CLIENTES_BASE_URL` (U6) a B.
6. Verificar con U14, invertido: `propagado: true`, canonical de A hacia B, mails del CRM de
   pedidos nuevos hacia B y de pedidos viejos hacia A (por `sitio_origen`).

## 5. Rollback por fase

| Fase | Cómo se vuelve atrás |
|------|----------------------|
| U2 a U8 (B existe, sin tráfico real) | Pausar o borrar el proyecto B. A no se tocó. |
| U7 (destino extra) | `shop_destinos_extra = '[]'` (script o SQL) y borrar la env. El ping vuelve a salir solo al principal. Redeploy del admin. |
| U15 (backfill) | `UPDATE shop.orders SET sitio_origen = NULL WHERE sitio_origen = 'https://cliente.example' AND tenant_id = '<tenant>';` solo si hay certeza de que ninguno es posterior al despliegue de 0044. |
| U16 (cambio de principal) | Revertir el UPDATE de `tenants` (`shop_url` de vuelta a A, B de nuevo como extra), volver a intercambiar los secretos, redeploy del admin, y revertir `NEXT_PUBLIC_CANONICAL_URL` en A y B con redeploy. |

## 6. Limitaciones conocidas

- Los clientes son **distintos por dominio** (una app de Clerk por dominio): el mismo email tiene que
  registrarse en cada uno y los carritos y favoritos no se comparten entre dominios.
- El barrido de **avisos de reingreso** se dispara con el ping de catálogo, y el ping ahora llega a
  cada proyecto: corre una vez por proyecto, y los enlaces de esos mails salen con el sitio del
  entorno que los envía, no con el del cliente. Revisar que dos barridos seguidos no dupliquen mails
  antes de abrir B al público.
- El cron de conciliación apunta a un solo proyecto (U6).
- El plan gratuito de Clerk limita a un dominio por app; si el plan cambia, se podría unificar y
  retirar este esquema.
- Un destino extra sin secreto o con URL inválida no avisa a nadie: aparece como `fallidos` y en el
  log del admin con la etiqueta (nunca la URL ni el secreto).
