# Staging

`main` es producción. `staging` es una rama fija que Vercel despliega en el entorno **Preview** de
los dos proyectos (admin y Shop). El resto de las ramas no despliega (`git.deploymentEnabled` en
`apps/*/vercel.json`), para no gastar el tope diario del plan.

| | Producción | Staging |
|---|---|---|
| Rama | `main` | `staging` |
| Entorno de Vercel | Production | Preview (variables con rama `staging`) |
| Base | Neon, branch principal | Neon, branch `staging` (copia de prod) |
| Mercado Pago, Payway, Clerk | credenciales reales | credenciales de prueba |
| URL | dominio propio | `*.vercel.app` (Shop con la puerta de usuario y clave; admin con su login) |

Los crons de `apps/admin/vercel.json` corren solo en producción. El `ignoreCommand` nunca saltea `staging`: cada push o Redeploy de staging compila (en `main` sigue salteando la app que no cambió).

## Puesta en marcha (una vez)

1. **Neon:** crear la branch `staging` desde la principal. Copiar su cadena de conexión directa
   (para migrar) y la del pooler (para la app).
2. **Vercel, en cada proyecto:** Settings → Environment Variables → entorno **Preview**, rama
   `staging`. Cargar ahí los valores de staging de las variables de abajo. Las que no cambian
   pueden quedar compartidas con Production.
3. **Vercel, Deployment Protection:** dejar Vercel Authentication **apagado**. Bloquea los
   webhooks (Mercado Pago, Clerk) y las llamadas entre apps. Staging no queda pública: el Shop
   tiene la puerta de `SITE_AUTH_USER`/`SITE_AUTH_PASSWORD` (`proxy.ts`, que deja pasar los
   webhooks) y el admin su login.
4. **Crear la rama:** `git push origin origin/main:refs/heads/staging`.
5. **Webhooks de prueba:** Mercado Pago no necesita nada (cada pago manda la `notification_url`
   del entorno que lo creó). Clerk (instancia de desarrollo): webhook a
   `<URL de staging del Shop>/api/webhooks/clerk` con `user.created`, `user.updated` y
   `user.deleted`; su signing secret va en `CLERK_WEBHOOK_SIGNING_SECRET` (Preview, `staging`).
6. Cuando staging ande, pasar Production a las credenciales reales.

### Variables que cambian en staging

- **Shop (`apps/clientes`):** `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`,
  `MIGRATE_DATABASE_URL`, `NEXT_PUBLIC_SITE_URL`, `CRM_ADMIN_URL`, las credenciales de pago
  **por sucursal** (ver abajo), `PAYWAY_BASE_URL` (sandbox, compartida), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` y
  `CLERK_SECRET_KEY` (instancia de desarrollo), `CLERK_WEBHOOK_SIGNING_SECRET`,
  `NEXT_PUBLIC_CLERK_PROXY_URL` (vacía en staging), `COOKIE_DOMAIN` (vacía en staging).
- **Credenciales de pago del Shop, una cuenta por sucursal.** Cada variable lleva el sufijo `_<SLUG>`
  (slug de la sucursal en mayúsculas, `-` -> `_`): `MP_ACCESS_TOKEN_<S>`, `MP_PUBLIC_KEY_<S>`,
  `MP_WEBHOOK_SECRET_<S>`, `PAYWAY_API_PRIVATE_KEY_<S>` y `PAYWAY_API_PUBLIC_KEY_<S>`, con
  credenciales de prueba. Se cargan con `vercel env add MP_ACCESS_TOKEN_IGZ preview staging` (y
  análogas para `_MDP`) y hay que redesplegar (la CSP se arma en el build). Ya no existen las
  variables sin sufijo ni `NEXT_PUBLIC_MP_PUBLIC_KEY`.
- **Admin (`apps/admin`):** `DATABASE_URL`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_SHOP_URL`,
  `SHOP_INTERNAL_URL`, `SHOP_REDIRECT_ORIGIN`, `MP_PUBLIC_KEY` (la de prueba), `COOKIE_DOMAIN`
  (vacía en staging), `SENTRY_ENVIRONMENT` y `NEXT_PUBLIC_SENTRY_ENVIRONMENT` (`staging`).
- **Alegra:** si staging usa la misma cuenta que producción, los pedidos de prueba que se facturen
  quedan en la cuenta real. No facturar desde staging salvo que se use una cuenta de prueba.

### Checklist de despliegue: cuentas de cobro por sucursal

Change `cuentas-procesador-por-sucursal` (detalle y rollback en
`apps/clientes/docs/pagos-cuentas-por-sucursal.md`). En este orden:

1. **U1** Copiar los valores actuales a las variables `_IGZ` en Preview `staging` y en Production
   (`MP_ACCESS_TOKEN` -> `MP_ACCESS_TOKEN_IGZ`, `NEXT_PUBLIC_MP_PUBLIC_KEY` -> `MP_PUBLIC_KEY_IGZ`,
   `MP_WEBHOOK_SECRET` -> `MP_WEBHOOK_SECRET_IGZ`, `PAYWAY_API_PRIVATE_KEY` y `PAYWAY_API_PUBLIC_KEY`
   -> `..._IGZ`) y redesplegar, **antes** de mergear R1 (#527). Las variables sin sufijo se conservan.
2. Mergear R1 a `staging` y probar el cobro.
3. **U3** Aplicar la migración 0035 del Shop en la base de staging **antes** de mergear R2.
4. Mergear R2 a `staging`; después R3 (#528).
5. **U4/U5** Cargar `_MDP` (staging y producción) y registrar la URL del webhook de Mercado Pago y el
   secreto en la aplicación de MDP (la misma URL que en la de IGZ).
6. **U6** Aplicar la migración 0035 en producción **antes** de mergear el PR `staging` -> `main`.
   R1 y R2 viajan juntos a `main`.
7. **U9** Una semana sin incidentes en producción: borrar las variables sin sufijo (Production y
   Preview `staging`).

## Uso diario

**Flujo de PRs: primero `staging`, después `main`.**

1. **Cada cambio** se abre como PR con base `staging` (`gh pr create --base staging`), desde una rama
   que parte de `origin/staging`. Al mergearlo, Vercel despliega en Preview y ahí se prueba. Las
   ramas de PR no tienen Preview propia: sólo se despliegan `main` y `staging`.
2. **Promoción:** cuando Preview está bien, un PR aparte `staging` → `main`. Se mergea con **merge
   commit, no squash**: con squash `staging` queda divergente de `main`. Lleva todo lo que haya en
   `staging`; si algo no está listo, se saca antes.
3. **Después de cada merge a `main`** (o si `main` recibe un cambio directo, como un hotfix), traer
   `main` a `staging`: `git switch staging && git merge origin/main && git push`. Nunca `push --force`.
- **Migraciones:** primero contra la branch `staging` de Neon, se prueba, y recién después contra
  producción (siempre antes de abrir el PR de promoción).
- **Volver a alinear:** `git switch staging && git merge origin/main && git push`. Si staging
  acumuló ramas descartadas, borrar la rama en GitHub y crearla de nuevo desde `main` (paso 4 de la
  puesta en marcha).
- No apilar PRs sobre otras ramas de cambio: cada uno parte de `staging`.
