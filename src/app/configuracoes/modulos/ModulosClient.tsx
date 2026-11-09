'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MODULOS, modulosLigados } from '@/lib/modulos'
import type { Modulo, UnidadeModulo } from '@/types/database'

interface Props {
  unidades: { id: string; nome: string; tipo: string }[]
  excecoes: UnidadeModulo[]
  userId:   string
}

const COR = { tinta: '#25402C', fraco: '#9AA79C', medio: '#71856F', borda: '#EBE7DA', verde: '#3E9849', erro: '#DC2626' }

export default function ModulosClient({ unidades, excecoes: iniciais, userId }: Props) {
  const supabase = createClient()
  const [excecoes, setExcecoes] = useState(iniciais)
  const [salvando, setSalvando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function alternar(unitId: string, modulo: Modulo, ativo: boolean) {
    const chave = `${unitId}:${modulo}`
    setSalvando(chave)
    setErro(null)
    const { error } = await supabase.from('unidade_modulos')
      .upsert({ unit_id: unitId, modulo, ativo, alterado_em: new Date().toISOString(), alterado_por: userId }, { onConflict: 'unit_id,modulo' })
    setSalvando(null)
    if (error) { setErro(`Não foi possível salvar: ${error.message}`); return }
    setExcecoes(prev => [...prev.filter(e => !(e.unit_id === unitId && e.modulo === modulo)),
      { unit_id: unitId, modulo, ativo, alterado_em: new Date().toISOString(), alterado_por: userId }])
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 980, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: COR.tinta, margin: 0 }}>Módulos por unidade</h1>
      <p style={{ fontSize: 13, color: COR.fraco, margin: '4px 0 18px', lineHeight: 1.5 }}>
        O que cada unidade usa. Desligado some do menu e não deixa criar registros novos; o que já existe continua
        guardado. Só a marca altera.
      </p>
      {erro && (
        <div role="alert" style={{ padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 9, marginBottom: 16, fontSize: 12.5, color: COR.erro }}>
          {erro}
        </div>
      )}
      <div style={{ overflowX: 'auto', background: '#fff', border: `1px solid ${COR.borda}`, borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '10px 14px', color: COR.medio, borderBottom: `1px solid ${COR.borda}` }}>Unidade</th>
              {MODULOS.map(m => (
                <th key={m.chave} title={m.descricao} style={{ padding: '10px 8px', color: COR.medio, borderBottom: `1px solid ${COR.borda}`, fontWeight: 700 }}>
                  {m.nome}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {unidades.map(u => {
              const ligados = modulosLigados(excecoes.filter(e => e.unit_id === u.id))
              return (
                <tr key={u.id}>
                  <td style={{ padding: '10px 14px', color: COR.tinta, fontWeight: 700, borderBottom: `1px solid ${COR.borda}` }}>{u.nome}</td>
                  {MODULOS.map(m => {
                    const ativo = ligados.has(m.chave)
                    return (
                      <td key={m.chave} style={{ textAlign: 'center', padding: '8px', borderBottom: `1px solid ${COR.borda}` }}>
                        <input type="checkbox" checked={ativo} disabled={salvando === `${u.id}:${m.chave}`}
                          aria-label={`${m.nome} em ${u.nome}`}
                          onChange={e => void alternar(u.id, m.chave, e.target.checked)} />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
