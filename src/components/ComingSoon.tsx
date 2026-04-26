type Props = {
  title: string
  description: string
  icon?: string
}

export default function ComingSoon({ title, description, icon }: Props) {
  return (
    <div className="p-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
        {icon && <div className="text-2xl mb-4 font-bold text-brand-600">{icon}</div>}
        <h1 className="text-xl font-bold text-slate-900 mb-2">{title}</h1>
        <p className="text-sm text-slate-600 mb-6">{description}</p>
        <span className="inline-block bg-amber-100 text-amber-800 text-xs font-semibold px-3 py-1.5 rounded-full">
          Proximamente
        </span>
        <p className="text-xs text-slate-400 mt-6">
          Estamos trabajando para ofrecerte este servicio. Te avisaremos cuando este disponible.
        </p>
      </div>
    </div>
  )
}