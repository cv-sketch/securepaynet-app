import { Link } from 'react-router-dom'

export default function Privacidad() {
  return (
    <div className="p-4 space-y-4">
      <Link to="/legales" className="text-xs text-brand-600">&larr; Volver a Legales</Link>
      <h1 className="text-xl font-bold">Politica de Privacidad</h1>

      <article className="bg-white rounded-2xl border border-slate-200 p-4 text-sm text-slate-700 space-y-3 leading-relaxed">
        <p className="text-xs text-slate-400">Ultima actualizacion: [fecha]</p>

        <Section title="1. Responsable del tratamiento">
          SecurePayNet S.A., CUIT XX-XXXXXXXX-X, con domicilio legal en [direccion], CABA. Email
          de contacto: privacidad@securepaynet.com.ar
        </Section>

        <Section title="2. Datos que recolectamos">
          Datos de identificacion (nombre, DNI, CUIT/CUIL), datos de contacto (email, telefono, domicilio),
          datos de operaciones (CVU, alias, transacciones, dispositivo, IP) y datos para cumplimiento
          normativo (KYC, AML).
        </Section>

        <Section title="3. Finalidades">
          Brindar el servicio de billetera virtual, cumplir obligaciones legales (BCRA, UIF, AFIP),
          prevenir fraude y lavado de activos, mejorar la experiencia y atencion al cliente.
        </Section>

        <Section title="4. Base legal">
          Ejecucion del contrato de servicios, cumplimiento de obligaciones legales y, en su caso,
          consentimiento explicito del titular.
        </Section>

        <Section title="5. Conservacion">
          Los datos se conservan por el plazo exigido por la normativa aplicable (10 anos para datos
          financieros y de prevencion de lavado, segun corresponda).
        </Section>

        <Section title="6. Derechos del titular (Ley 25.326)">
          El titular puede ejercer los derechos de acceso, rectificacion, actualizacion y supresion
          escribiendo a privacidad@securepaynet.com.ar. La AGENCIA DE ACCESO A LA INFORMACION PUBLICA
          es el organo de control de la Ley 25.326 y tiene la atribucion de atender denuncias y reclamos
          que se interpongan con relacion al incumplimiento de las normas sobre proteccion de datos
          personales.
        </Section>

        <Section title="7. Seguridad">
          Implementamos medidas tecnicas y organizativas para proteger los datos: cifrado en transito
          y en reposo, control de accesos, monitoreo continuo y autenticacion multifactor (passkeys).
        </Section>

        <Section title="8. Transferencias">
          Los datos pueden ser compartidos con entidades financieras custodias, BCRA, UIF, AFIP y
          proveedores tecnologicos contratados, siempre bajo estrictos acuerdos de confidencialidad.
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
