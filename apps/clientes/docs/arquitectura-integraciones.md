# Arquitectura de integraciones — Shop, CRM y Alegra

> Decisión de arquitectura. Define de dónde sale cada dato y quién es dueño de
> cada concepto. Leer antes de conectar el shop con cualquier sistema externo.

_Última actualización: 2026-07-27_

## Los tres sistemas

| Sistema | Propiedad | Rol |
|---|---|---|
| **Alegra** | Externo (SaaS) | **Sistema de record**: clientes, productos, precios, stock, facturas, contabilidad. Reemplazó a Flexxus. Solo se toca por su **API REST**. |
| **CRM** | Propio (repo aparte, **DB propia**) | Relación con el cliente: crédito, estado de cuenta, reglas de negocio, seguimiento. |
| **Shop** | Propio (**este repo**, **DB propia**) | Catálogo + armado de pedido. Guarda solo su "delta" (carrito, fotos web, borradores, OTP). |

Los tres tienen **bases de datos separadas**. La integración es **siempre por API
(contrato), nunca por DB compartida** — ni siquiera entre CRM y Shop, aunque
ambos sean propios. Compartir DB los acopla para siempre; separarlos hoy es
barato, desacoplarlos después es caro.

El Shop y el CRM ya comparten la **sesión** vía cookie en `.cliente.example`
(ver `src/lib/session.ts`). Eso es SSO por cookie, no acceso a datos.

## Regla de ruteo

> Se rutea a través del CRM cuando el CRM **aporta lógica propia**.
> Se va **directo a Alegra** cuando el CRM sería un **mero pasamanos**
> (solo agregaría latencia y otra dependencia).

El criterio no es "todo por el CRM" ni "todo directo a Alegra": es **quién es
dueño del concepto**.

## Dueño de cada dato

| Dato | Dueño del concepto | Ruta desde el Shop |
|---|---|---|
| Catálogo, precios, stock | Alegra (dato crudo) | **Directo a Alegra** |
| Facturas / PDF | Alegra (documento) | **Directo a Alegra** (o Portal) |
| Saldo, deudas, límite de crédito, "¿puede comprar a cuenta?" | **CRM** (relación con el cliente) | **Se pregunta al CRM** |

Punto clave: **saldo/deudas/crédito son conceptos del CRM, no del Shop**. El
límite de crédito probablemente ni exista en Alegra — es un campo del CRM. El CRM
combina el saldo que trae de Alegra con **sus propias reglas** (ej. "bloquear si
tiene vencidos > 30 días", "límite $X") y entrega un **veredicto**, no números
crudos. **El Shop nunca calcula nada financiero.**

## Diagrama

```
                ALEGRA  (productos · precios · stock · facturas)
               /       \
   estado de  /         \  catálogo / stock
   cuenta +  /           \  (directo)
   crédito  ▼             ▼
        ┌────────┐   ask   ┌────────┐
        │  CRM   │◄────────│  SHOP  │
        └────────┘         └────────┘
```

## Contrato: estado de cuenta del cliente

Cuando el Shop necesita datos financieros (ej. validar crédito en un checkout a
cuenta corriente), **no toca facturas de Alegra**: le pregunta al CRM.

```
GET {CRM}/api/clientes/:id/estado-cuenta
→ {
    "puedeComprarACuenta": true,
    "saldo": 152000,
    "vencidos": 0,
    "limiteDisponible": 300000
  }
```

El Shop solo **muestra** eso o **decide** en base a `puedeComprarACuenta`. Toda
la lógica financiera vive en un único lugar (el CRM), consistente con lo que ve
el CRM mismo. Prerrequisito: el CRM debe exponer ese endpoint (decisión del lado
del CRM; no bloquea al Shop).

## Consecuencias para este repo

1. **`src/lib/alegra.ts` integra Alegra solo para catálogo / precios / stock /
   facturas.** No arma saldos ni cuenta corriente.
2. **No hay helper de cuenta corriente en el Shop.** Lo financiero es un endpoint
   del CRM que se consume si/cuando el checkout valide crédito.
3. **Escalas de precio por cantidad**: Alegra no las soporta nativamente. Si el
   negocio las necesita, se resuelven en la DB del Shop — no en Alegra.

## Historial

- **Flexxus quedó descartado**: todo su rol lo absorbió Alegra. Los planes en
  `docs/superpowers/plans/` fueron escritos contra Flexxus; la capa de datos se
  migra a Alegra (`src/lib/flexxus.ts` → `src/lib/alegra.ts`), pero el resto de
  la arquitectura (auth OTP, sesión, route groups, componentes) se mantiene.
