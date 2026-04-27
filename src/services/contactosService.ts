import { supabase } from '../lib/supabase'

export type Contacto = {
  id: string
  cliente_id: string
  nombre: string
  cvu: string | null
  alias: string | null
  cuit: string | null
  titular: string | null
  banco: string | null
  email: string | null
  telefono: string | null
  favorito: boolean
  notas: string | null
  created_at: string
  updated_at: string
}

export type ContactoInput = {
  nombre: string
  cvu?: string | null
  alias?: string | null
  cuit?: string | null
  titular?: string | null
  banco?: string | null
  email?: string | null
  telefono?: string | null
  favorito?: boolean
  notas?: string | null
}

export const contactosService = {
  async list(clienteId: string): Promise<Contacto[]> {
    const { data, error } = await supabase
      .from('contactos')
      .select('*')
      .eq('cliente_id', clienteId)
      .order('favorito', { ascending: false })
      .order('nombre', { ascending: true })
    if (error) throw error
    return (data ?? []) as Contacto[]
  },

  async get(id: string): Promise<Contacto | null> {
    const { data, error } = await supabase
      .from('contactos')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return data as Contacto | null
  },

  async create(clienteId: string, input: ContactoInput): Promise<Contacto> {
    const { data, error } = await supabase
      .from('contactos')
      .insert({ cliente_id: clienteId, ...input })
      .select()
      .single()
    if (error) throw error
    return data as Contacto
  },

  async update(id: string, input: Partial<ContactoInput>): Promise<Contacto> {
    const { data, error } = await supabase
      .from('contactos')
      .update(input)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data as Contacto
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('contactos').delete().eq('id', id)
    if (error) throw error
  },

  async toggleFavorito(id: string, favorito: boolean): Promise<void> {
    const { error } = await supabase
      .from('contactos')
      .update({ favorito })
      .eq('id', id)
    if (error) throw error
  },
}
