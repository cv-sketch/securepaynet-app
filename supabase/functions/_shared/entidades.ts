const ENTIDADES_CBU: Record<string, string> = {
  '005': 'Banco Galicia',
  '007': 'Banco Galicia',
  '011': 'Banco Nación',
  '014': 'Banco Provincia',
  '015': 'ICBC',
  '017': 'BBVA',
  '027': 'Supervielle',
  '029': 'Banco Ciudad',
  '034': 'Banco Patagonia',
  '044': 'Banco Hipotecario',
  '072': 'Santander',
  '143': 'Brubank',
  '150': 'HSBC',
  '191': 'Credicoop',
  '259': 'Itaú',
  '285': 'Macro',
  '299': 'Comafi',
  '384': 'Wilobank',
  '389': 'Banco de Comercio',
}

const ENTIDADES_CVU: Record<string, string> = {
  '0000003': 'Mercado Pago',
  '0000019': 'Personal Pay',
  '0000044': 'Naranja X',
  '0000054': 'Ualá',
  '0000086': 'Lemon',
  '0000094': 'Belo',
}

export function entidadByPrefix(cvu: string): string {
  if (cvu.startsWith('0000')) {
    const cvuPrefix = cvu.substring(0, 7)
    if (ENTIDADES_CVU[cvuPrefix]) return ENTIDADES_CVU[cvuPrefix]
  }
  const cbuPrefix = cvu.substring(0, 3)
  return ENTIDADES_CBU[cbuPrefix] ?? 'Otra entidad'
}

export const PREFIJOS_CVU_DISPONIBLES = Object.keys(ENTIDADES_CVU)
export const PREFIJOS_CBU_DISPONIBLES = Object.keys(ENTIDADES_CBU)
