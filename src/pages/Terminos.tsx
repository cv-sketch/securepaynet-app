import { Link } from 'react-router-dom'

export default function Terminos() {
  return (
    <div className="p-4 space-y-4">
      <Link to="/legales" className="text-xs text-brand-600">&larr; Volver a Legales</Link>
      <h1 className="text-xl font-bold">Terminos y Condiciones</h1>

      <article className="bg-white rounded-2xl border border-slate-200 p-4 text-sm text-slate-700 space-y-3 leading-relaxed">
        <p className="text-xs text-slate-400">Ultima actualizacion: [fecha]</p>

        <Section title="1. Identificacion del prestador">
          SecurePayNet S.A., CUIT XX-XXXXXXXX-X, con domicilio legal en [direccion], CABA, Argentina,
          inscripta como Proveedor de Servicios de Pago que ofrece Cuentas de Pago (PSPCP) en el
          Registro de Proveedores del Banco Central de la Republica Argentina (BCRA).
        </Section>

        <Section title="2. Objeto del servicio">
          El servicio consiste en la apertura y administracion de una Cuenta de Pago Virtual identificada
          con un CVU, que permite recibir, enviar y mantener saldos en pesos argentinos. Los fondos no
          constituyen depositos en una entidad financiera y no cuentan con la garantia de los depositos
          de la Ley 24.485.
        </Section>

        <Section title="3. Resguardo de fondos">
          De acuerdo con la normativa BCRA, el 100% de los fondos de los clientes se encuentra disponible
          de inmediato y depositado en cuentas a la vista en entidades financieras reguladas por el BCRA,
          a nombre y por cuenta y orden de los titulares.
        </Section>

        <Section title="4. Operaciones permitidas">
          Transferencias entrantes y salientes, recepcion de pagos via QR, pagos de servicios
          (proximamente) y otras operaciones que se incorporen oportunamente. Las operaciones estan
          sujetas a limites operativos y a controles de prevencion de lavado de activos.
        </Section>

        <Section title="5. Comisiones y cargos">
          Las comisiones aplicables se informan en el sitio web y dentro de la app antes de cada operacion.
          Cualquier modificacion sera notificada con al menos 60 dias corridos de anticipacion conforme
          normativa BCRA.
        </Section>

        <Section title="6. Obligaciones del cliente">
          El cliente se compromete a (i) suministrar informacion veridica y actualizada, (ii) custodiar
          sus credenciales de acceso, (iii) no utilizar el servicio para actividades ilicitas, (iv)
          informar movimientos no reconocidos dentro de los plazos legales.
        </Section>

        <Section title="7. Baja del servicio">
          El cliente puede solicitar la baja en cualquier momento a traves del menu Legales -&gt; Solicitud de
          Baja, conforme Resolucion 316/2018 SCI.
        </Section>

        <Section title="8. Defensa del consumidor">
          Para reclamos puede contactar al Servicio de Atencion al Cliente o, ante falta de respuesta, a
          la Direccion Nacional de Defensa del Consumidor.
        </Section>

        <Section title="9. Ley aplicable y jurisdiccion">
          Estos terminos se rigen por las leyes de la Republica Argentina. Para cualquier controversia
          son competentes los tribunales ordinarios con jurisdiccion en el domicilio del consumidor.
        </Section>
      </article>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-semibold text-slate-900 mb-1">{title}</h2>
      <p className="text-xs">{children}</p>
    </section>
  )
}
