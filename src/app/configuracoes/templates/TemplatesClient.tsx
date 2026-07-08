'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { QuoteTemplate, AgeGroup, Profile, TemplatePageImages } from '@/types/database'
import { AGE_GROUP_LABELS } from '@/types/database'
import dynamic from 'next/dynamic'

const PdfPreviewButton = dynamic(
  () => import('@/components/orcamento/PdfButton'),
  { ssr: false, loading: () => <button className="text-xs text-gray-400 px-3 py-1.5 border border-gray-200 rounded-xl">Carregando...</button> }
)

interface Props {
  currentUser:      Profile
  initialTemplates: QuoteTemplate[]
}

// ─── Form types ───────────────────────────────────────────────────────────────

interface TemplateForm {
  nome:               string
  age_group:          AgeGroup
  cor_primaria:       string
  cor_secundaria:     string
  cor_texto_conteudo: string
  nome_clinica:       string
  endereco:           string
  cidade_estado:      string
  telefone_clinica:   string
  cnpj:               string
  texto_cabecalho:    string
  texto_rodape:       string
  validade_dias:      string
  is_default:         boolean
}

// Page images state — File = new upload, string = existing URL, null = cleared
interface PageFiles {
  capa?:         File | null
  intro:         (File | null)[]
  encerramento?: File | null
}

const EMPTY_FORM: TemplateForm = {
  nome: '', age_group: 'todos',
  cor_primaria: '#67bea0', cor_secundaria: '#185FA5', cor_texto_conteudo: '#ffffff',
  nome_clinica: '', endereco: '', cidade_estado: '',
  telefone_clinica: '', cnpj: '',
  texto_cabecalho: '',
  texto_rodape: 'Este orçamento é válido por {validade_dias} dias a partir da data de emissão.',
  validade_dias: '7', is_default: false,
}

function formFromTemplate(t: QuoteTemplate): TemplateForm {
  return {
    nome:               t.nome,
    age_group:          t.age_group,
    cor_primaria:       t.cor_primaria,
    cor_secundaria:     t.cor_secundaria,
    cor_texto_conteudo: t.cor_texto_conteudo ?? '#ffffff',
    nome_clinica:       t.nome_clinica     ?? '',
    endereco:           t.endereco         ?? '',
    cidade_estado:      t.cidade_estado    ?? '',
    telefone_clinica:   t.telefone_clinica ?? '',
    cnpj:               t.cnpj             ?? '',
    texto_cabecalho:    t.texto_cabecalho  ?? '',
    texto_rodape:       t.texto_rodape     ?? '',
    validade_dias:      String(t.validade_dias),
    is_default:         t.is_default,
  }
}

// ─── PageSlot — single image upload slot ─────────────────────────────────────

function PageSlot({
  label, description, required = false,
  existingUrl, file, onChange, onClear,
}: {
  label: string; description: string; required?: boolean
  existingUrl?: string; file?: File | null
  onChange: (f: File) => void; onClear: () => void
}) {
  const preview = file ? URL.createObjectURL(file) : existingUrl ?? null

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="bg-gray-50 px-3 py-2 flex items-center justify-between border-b border-gray-200">
        <div>
          <span className="text-xs font-medium text-gray-700">{label}</span>
          {required && <span className="text-red-500 ml-0.5">*</span>}
          <p className="text-[11px] text-gray-400 mt-0.5">{description}</p>
        </div>
        {preview && (
          <button onClick={onClear} className="text-[11px] text-red-400 hover:text-red-600">Remover</button>
        )}
      </div>
      <div className="p-3">
        {preview ? (
          <div className="relative">
            <img src={preview} alt={label} className="w-full rounded-lg object-cover max-h-32" />
            <label className="absolute bottom-2 right-2 cursor-pointer bg-white/90 border border-gray-200 text-xs text-gray-600 px-2 py-1 rounded-lg hover:bg-white transition-colors">
              Trocar
              <input type="file" accept="image/png,image/jpeg" onChange={e => { const f = e.target.files?.[0]; if (f) onChange(f) }} className="sr-only" />
            </label>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-6 cursor-pointer hover:border-[#CDE8CB] hover:bg-[#E8F4E6]/30 transition-colors">
            <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span className="text-xs text-gray-400">Clique para fazer upload</span>
            <span className="text-[11px] text-gray-300">PNG ou JPG apenas — recomendado A4 150–300dpi</span>
            <input type="file" accept="image/png,image/jpeg" onChange={e => { const f = e.target.files?.[0]; if (f) onChange(f) }} className="sr-only" />
          </label>
        )}
      </div>
    </div>
  )
}

// ─── Template Modal ───────────────────────────────────────────────────────────

interface TemplateModalProps {
  editing:  QuoteTemplate | null
  unitId:   string | null
  onClose:  () => void
  onSaved:  (t: QuoteTemplate) => void
}

function TemplateModal({ editing, unitId, onClose, onSaved }: TemplateModalProps) {
  const supabase = createClient()

  const [form,      setForm]      = useState<TemplateForm>(() => editing ? formFromTemplate(editing) : EMPTY_FORM)
  const [logoFile,  setLogoFile]  = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(editing?.logo_url ?? null)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')
  const [activeTab, setActiveTab] = useState<'visual' | 'paginas' | 'clinica' | 'textos'>('visual')

  // Page image files (null = keep existing, File = new upload)
  const existingPages: TemplatePageImages = editing?.paginas_imagens ?? {}
  const [pageFiles, setPageFiles] = useState<PageFiles>({ intro: existingPages.intro?.map(() => null) ?? [] })

  // Cleared flags — when user removes an existing image
  const [cleared, setCleared] = useState<Record<string, boolean>>({})

  function set(key: keyof TemplateForm, val: string | boolean) {
    setForm(f => ({ ...f, [key]: val }))
    setError('')
  }

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  async function uploadFile(file: File, path: string): Promise<string> {
    const { error: uploadErr } = await supabase.storage
      .from('quote-templates')
      .upload(path, file, { upsert: true })
    if (uploadErr) {
      const isBucketMissing = uploadErr.message.toLowerCase().includes('bucket') || uploadErr.message.includes('not found')
      throw new Error(
        isBucketMissing
          ? 'Bucket "quote-templates" não encontrado. Crie-o no Supabase Dashboard → Storage → New Bucket (marcar como público).'
          : `Erro no upload da imagem: ${uploadErr.message}`
      )
    }
    return supabase.storage.from('quote-templates').getPublicUrl(path).data.publicUrl
  }

  async function handleSave() {
    if (!form.nome.trim()) { setError('Informe o nome do template.'); return }
    setSaving(true)
    setError('')

    try {
    const templateId = editing?.id ?? crypto.randomUUID()
    const base = `${unitId}/${templateId}`

    // Upload logo
    const logoUrl = logoFile
      ? await uploadFile(logoFile, `${base}/logo.${logoFile.name.split('.').pop()}`)
      : cleared['logo'] ? null : editing?.logo_url ?? null

    // Upload page images
    async function uploadPage(key: string, file: File | null | undefined, existingUrl?: string): Promise<string | null> {
      if (file) return await uploadFile(file, `${base}/${key}.${file.name.split('.').pop()}`)
      if (cleared[key]) return null
      return existingUrl ?? null
    }

    const capaUrl = await uploadPage('capa',         pageFiles.capa,         existingPages.capa)
    const encerr  = await uploadPage('encerramento', pageFiles.encerramento, existingPages.encerramento)

    const introUrls: string[] = []
    const existingIntro = existingPages.intro ?? []
    const maxIntro = Math.max(pageFiles.intro.length, existingIntro.length)
    for (let i = 0; i < maxIntro; i++) {
      const url = await uploadPage(`intro-${i}`, pageFiles.intro[i], existingIntro[i])
      if (url) introUrls.push(url)
    }

    const paginas_imagens: TemplatePageImages = {
      ...(capaUrl           ? { capa:          capaUrl   } : {}),
      ...(introUrls.length  ? { intro:         introUrls } : {}),
      ...(encerr            ? { encerramento:  encerr    } : {}),
    }

    const payload = {
      id:                  templateId,
      unit_id:             unitId,
      nome:                form.nome.trim(),
      age_group:           form.age_group,
      logo_url:            logoUrl,
      cor_primaria:        form.cor_primaria,
      cor_secundaria:      form.cor_secundaria,
      cor_texto_conteudo:  form.cor_texto_conteudo,
      nome_clinica:        form.nome_clinica.trim()     || null,
      endereco:            form.endereco.trim()         || null,
      cidade_estado:       form.cidade_estado.trim()    || null,
      telefone_clinica:    form.telefone_clinica.trim() || null,
      cnpj:                form.cnpj.trim()             || null,
      texto_cabecalho:     form.texto_cabecalho.trim()  || null,
      texto_rodape:        form.texto_rodape.trim()     || null,
      validade_dias:       parseInt(form.validade_dias) || 7,
      is_default:          form.is_default,
      paginas_imagens,
    }

    const { data, error: err } = editing
      ? await supabase.from('quote_templates').update(payload).eq('id', editing.id).select().single()
      : await supabase.from('quote_templates').insert(payload).select().single()

    setSaving(false)
    if (err) {
      const msg = err.message.includes('column') && err.message.includes('paginas_imagens')
        ? 'Execute a migration 014 no Supabase antes de salvar templates com imagens.'
        : `Erro ao salvar template: ${err.message}`
      setError(msg)
      return
    }
    onSaved(data as QuoteTemplate)
    } catch (err: unknown) {
      setSaving(false)
      setError(err instanceof Error ? err.message : 'Erro inesperado ao salvar.')
    }
  }

  const tabs = [
    { id: 'visual',  label: 'Visual'  },
    { id: 'paginas', label: 'Páginas' },
    { id: 'clinica', label: 'Clínica' },
    { id: 'textos',  label: 'Textos'  },
  ] as const

  // Intro pages helpers
  function addIntroSlot() {
    setPageFiles(p => ({ ...p, intro: [...p.intro, null] }))
  }
  function setIntroFile(i: number, file: File) {
    setPageFiles(p => { const intro = [...p.intro]; intro[i] = file; return { ...p, intro } })
  }
  function clearIntro(i: number) {
    setPageFiles(p => { const intro = [...p.intro]; intro[i] = null; return { ...p, intro } })
    setCleared(c => ({ ...c, [`intro-${i}`]: true }))
  }

  const introCount = Math.max(pageFiles.intro.length, existingPages.intro?.length ?? 0)

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              {editing ? 'Editar template' : 'Novo template'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Configure o visual do PDF de orçamento</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Nome + faixa etária */}
        <div className="px-6 pt-4 shrink-0 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Nome <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.nome}
                onChange={e => set('nome', e.target.value)}
                placeholder="Ex: Padrão Adultos"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3E9849]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Faixa etária</label>
              <select
                value={form.age_group}
                onChange={e => set('age_group', e.target.value as AgeGroup)}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#3E9849]"
              >
                {(Object.keys(AGE_GROUP_LABELS) as AgeGroup[]).map(k => (
                  <option key={k} value={k}>{AGE_GROUP_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end pb-0.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={e => set('is_default', e.target.checked)}
                  className="w-4 h-4 rounded accent-blue-500"
                />
                <span className="text-xs text-gray-600">Usar como padrão</span>
              </label>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6 shrink-0 mt-3">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`text-xs font-medium py-2.5 px-1 mr-4 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-[#3E9849] text-[#3E9849]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* ── Visual ── */}
          {activeTab === 'visual' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Logo <span className="text-gray-400">(opcional — aparece no PDF se não houver página de capa)</span></label>
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center bg-gray-50 shrink-0 overflow-hidden">
                    {logoPreview
                      ? <img src={logoPreview} alt="Logo" className="w-full h-full object-contain p-1" />
                      : <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    }
                  </div>
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-[#3E9849] cursor-pointer hover:text-[#35853F]">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                      {logoPreview ? 'Trocar logo' : 'Fazer upload'}
                      <input type="file" accept="image/png,image/jpeg" onChange={handleLogoChange} className="sr-only" />
                    </label>
                    {logoPreview && (
                      <button onClick={() => { setLogoFile(null); setLogoPreview(null); setCleared(c => ({ ...c, logo: true })) }}
                        className="text-[11px] text-red-400 hover:text-red-600 block mt-1"
                      >Remover</button>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Cor primária</label>
                  <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-1.5">
                    <input type="color" value={form.cor_primaria} onChange={e => set('cor_primaria', e.target.value)} className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0" />
                    <span className="text-sm text-gray-700 font-mono">{form.cor_primaria}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Cor secundária</label>
                  <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-1.5">
                    <input type="color" value={form.cor_secundaria} onChange={e => set('cor_secundaria', e.target.value)} className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0" />
                    <span className="text-sm text-gray-700 font-mono">{form.cor_secundaria}</span>
                  </div>
                </div>
              </div>

              {/* Preview strip */}
              <div className="rounded-xl p-4 text-white text-xs" style={{ background: `linear-gradient(135deg, ${form.cor_primaria}, ${form.cor_secundaria})` }}>
                <div className="flex items-center gap-3">
                  {logoPreview ? <img src={logoPreview} alt="" className="w-10 h-10 object-contain bg-white rounded-lg p-0.5" /> : <div className="w-10 h-10 bg-white/20 rounded-lg" />}
                  <div>
                    <p className="font-bold">{form.nome_clinica || 'Nome da Clínica'}</p>
                    <p className="opacity-75 text-[11px]">{form.cidade_estado || 'Cidade, Estado'}</p>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-white/20 font-semibold">ORÇAMENTO #0001</div>
              </div>
            </>
          )}

          {/* ── Páginas ── */}
          {activeTab === 'paginas' && (
            <>
              <div className="bg-[#E8F4E6] border border-[#CDE8CB] rounded-xl px-4 py-3 text-xs text-[#35853F]">
                <strong>Como funciona:</strong> faça upload das páginas do seu template. A <strong>página de dados</strong> (vacinas, preços e total) usa automaticamente o gradiente das cores do template — configure as cores na aba <strong>Visual</strong>.
              </div>

              <PageSlot
                label="Capa"
                description="1ª página — apresentação, logo, título"
                existingUrl={existingPages.capa}
                file={pageFiles.capa}
                onChange={f => setPageFiles(p => ({ ...p, capa: f }))}
                onClear={() => { setPageFiles(p => ({ ...p, capa: null })); setCleared(c => ({ ...c, capa: true })) }}
              />

              {/* Intro pages */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-700">Páginas de introdução</label>
                  {introCount < 4 && (
                    <button onClick={addIntroSlot} className="text-xs text-[#3E9849] hover:text-[#35853F] flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                      Adicionar página
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  {Array.from({ length: introCount }).map((_, i) => (
                    <PageSlot
                      key={i}
                      label={`Introdução ${i + 1}`}
                      description={`Página ${i + 2} — conteúdo institucional`}
                      existingUrl={existingPages.intro?.[i]}
                      file={pageFiles.intro[i]}
                      onChange={f => setIntroFile(i, f)}
                      onClear={() => clearIntro(i)}
                    />
                  ))}
                  {introCount === 0 && (
                    <p className="text-xs text-gray-400 text-center py-4">Nenhuma página de introdução. Clique em "Adicionar página" para incluir.</p>
                  )}
                </div>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${form.cor_primaria}, ${form.cor_secundaria})` }}>
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-700">Página de dados — gerada automaticamente</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Gradiente {form.cor_primaria} → {form.cor_secundaria} com os dados do orçamento sobrepostos</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Cor do texto na página de dados</label>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-1.5">
                    <input type="color" value={form.cor_texto_conteudo} onChange={e => set('cor_texto_conteudo', e.target.value)} className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0" />
                    <span className="text-sm text-gray-700 font-mono">{form.cor_texto_conteudo}</span>
                  </div>
                  <div className="flex gap-2">
                    {['#ffffff', '#1a1a1a', '#1D9E75', '#185FA5'].map(c => (
                      <button key={c} onClick={() => set('cor_texto_conteudo', c)}
                        className={`w-6 h-6 rounded-full border-2 transition-all ${form.cor_texto_conteudo === c ? 'border-[#3E9849] scale-110' : 'border-gray-200'}`}
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <PageSlot
                label="Encerramento"
                description="Última página — contato, redes sociais, informações finais"
                existingUrl={existingPages.encerramento}
                file={pageFiles.encerramento}
                onChange={f => setPageFiles(p => ({ ...p, encerramento: f }))}
                onClear={() => { setPageFiles(p => ({ ...p, encerramento: null })); setCleared(c => ({ ...c, encerramento: true })) }}
              />
            </>
          )}

          {/* ── Clínica ── */}
          {activeTab === 'clinica' && (
            <>
              {[
                { key: 'nome_clinica',     label: 'Nome da clínica',  placeholder: 'Vacivitta Campinas' },
                { key: 'cnpj',             label: 'CNPJ',             placeholder: '00.000.000/0001-00' },
                { key: 'endereco',         label: 'Endereço',         placeholder: 'Rua Exemplo, 123 — Bairro' },
                { key: 'cidade_estado',    label: 'Cidade / Estado',  placeholder: 'Campinas, SP — CEP 13000-000' },
                { key: 'telefone_clinica', label: 'Telefone',         placeholder: '(19) 99999-0000' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input
                    type="text"
                    value={form[key as keyof TemplateForm] as string}
                    onChange={e => set(key as keyof TemplateForm, e.target.value)}
                    placeholder={placeholder}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3E9849]"
                  />
                </div>
              ))}
            </>
          )}

          {/* ── Textos ── */}
          {activeTab === 'textos' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tagline</label>
                <input
                  type="text"
                  value={form.texto_cabecalho}
                  onChange={e => set('texto_cabecalho', e.target.value)}
                  placeholder="Proteção para toda a família"
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3E9849]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Texto do rodapé</label>
                <textarea
                  value={form.texto_rodape}
                  onChange={e => set('texto_rodape', e.target.value)}
                  rows={4}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3E9849] resize-none"
                />
                <p className="text-[11px] text-gray-400 mt-1">Use <code className="bg-gray-100 px-1 rounded">{'{validade_dias}'}</code> para inserir o prazo automaticamente.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Validade padrão (dias)</label>
                <input
                  type="number" min="1"
                  value={form.validade_dias}
                  onChange={e => set('validade_dias', e.target.value)}
                  className="w-24 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3E9849]"
                />
              </div>
            </>
          )}

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-xs font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-xs font-medium text-white bg-[#3E9849] rounded-xl hover:bg-[#35853F] disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            {saving && <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            {editing ? 'Salvar' : 'Criar template'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Template card ────────────────────────────────────────────────────────────

function TemplateCard({ template, onEdit, onDelete, onToggleDefault }: {
  template: QuoteTemplate; onEdit: () => void; onDelete: () => void; onToggleDefault: () => void
}) {
  const paginas = template.paginas_imagens ?? {}
  const hasPages = !!(paginas.capa || paginas.encerramento || paginas.intro?.length)

  const rodapeText = (template.texto_rodape ?? '').replace('{validade_dias}', String(template.validade_dias))
  const sampleQuote = {
    id: 'preview', unit_id: template.unit_id, client_id: null, lead_id: null, template_id: template.id,
    numero: 1, status: 'rascunho' as const, motivo_recusa: null, responsavel_id: null,
    validade_ate: null, observacoes: null, total_calculado: 450,
    token_publico: 'preview', enviado_em: null, visualizado_em: null, aceito_em: null,
    pacote_ativo: false, pacote_opcoes: null, paciente_nome: null,
    criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
    items: [
      { id: '1', quote_id: 'preview', unit_id: template.unit_id, product_id: '1', nome_snapshot: 'Vacina Gripe Quadrivalente', descricao_snapshot: 'Proteção contra influenza A (H1N1, H3N2) e influenza B. Recomendada anualmente.', valor_snapshot: 150, quantidade: 1, desconto: 0, valor_final: 150, observacao: null, criado_em: '' },
      { id: '2', quote_id: 'preview', unit_id: template.unit_id, product_id: '2', nome_snapshot: 'Vacina Hepatite B', descricao_snapshot: 'Prevenção da hepatite B, doença hepática grave causada pelo vírus HBV. Esquema em 3 doses.', valor_snapshot: 120, quantidade: 2, desconto: 5, valor_final: 228, observacao: null, criado_em: '' },
    ],
    template: { ...template, texto_rodape: rodapeText },
    lead: { nome: 'Maria', sobrenome: 'Silva', telefone: '(11) 99999-0000' },
    client: null,
  }

  return (
    <div className={`bg-white border rounded-2xl overflow-hidden transition-all ${template.ativo ? 'border-gray-200 shadow-sm' : 'border-gray-100 opacity-60'}`}>
      <div className="h-2" style={{ background: `linear-gradient(to right, ${template.cor_primaria}, ${template.cor_secundaria})` }} />
      <div className="p-4">
        <div className="flex items-start gap-3">
          {template.logo_url
            ? <img src={template.logo_url} alt="" className="w-10 h-10 object-contain rounded-lg border border-gray-100 p-0.5 shrink-0" />
            : <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${template.cor_primaria}20` }}>
                <svg className="w-5 h-5" style={{ color: template.cor_primaria }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
          }
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-900">{template.nome}</span>
              {template.is_default && <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full">Padrão</span>}
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap text-[11px] text-gray-400">
              <span>{AGE_GROUP_LABELS[template.age_group]}</span>
              {template.nome_clinica && <span>· {template.nome_clinica}</span>}
              <span>· {template.validade_dias}d</span>
              <span>· {hasPages ? `${[paginas.capa, ...(paginas.intro??[]), paginas.encerramento].filter(Boolean).length} pág.` : 'sem imagens'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 mt-3">
          <div className="w-5 h-5 rounded-full border border-white shadow-sm" style={{ backgroundColor: template.cor_primaria }} />
          <div className="w-5 h-5 rounded-full border border-white shadow-sm" style={{ backgroundColor: template.cor_secundaria }} />
          <div className="w-4 h-4 rounded-full border border-gray-200 ml-0.5" style={{ backgroundColor: template.cor_texto_conteudo }} title={`Texto: ${template.cor_texto_conteudo}`} />
          <span className="text-[11px] text-gray-400 ml-1">{template.cor_primaria}</span>
        </div>

        <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-gray-100">
          <PdfPreviewButton quote={sampleQuote} label="Prévia PDF" variant="preview" />
          <div className="ml-auto flex items-center gap-1">
            {!template.is_default && (
              <button onClick={onToggleDefault} title="Definir como padrão" className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </button>
            )}
            <button onClick={onEdit} title="Editar" className="p-1.5 text-gray-400 hover:text-[#3E9849] hover:bg-[#E8F4E6] rounded-lg transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            </button>
            <button onClick={onDelete} title="Excluir" className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function TemplatesClient({ currentUser, initialTemplates }: Props) {
  const supabase  = createClient()
  const [templates, setTemplates] = useState<QuoteTemplate[]>(initialTemplates)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing,   setEditing]   = useState<QuoteTemplate | null>(null)

  function handleSaved(t: QuoteTemplate) {
    setTemplates(prev => {
      const exists = prev.find(x => x.id === t.id)
      const updated = exists ? prev.map(x => x.id === t.id ? t : x) : [t, ...prev]
      if (t.is_default) return updated.map(x => x.id !== t.id && x.age_group === t.age_group ? { ...x, is_default: false } : x)
      return updated
    })
    setModalOpen(false)
    setEditing(null)
  }

  async function handleDelete(t: QuoteTemplate) {
    if (!confirm(`Excluir o template "${t.nome}"?`)) return
    await supabase.from('quote_templates').delete().eq('id', t.id)
    setTemplates(prev => prev.filter(x => x.id !== t.id))
  }

  async function handleToggleDefault(t: QuoteTemplate) {
    const { data } = await supabase.from('quote_templates').update({ is_default: true }).eq('id', t.id).select().single()
    if (data) setTemplates(prev => prev.map(x => x.age_group === t.age_group ? { ...x, is_default: x.id === t.id } : x))
  }

  const byAgeGroup: AgeGroup[] = ['todos', 'crianca', 'adulto', 'idoso']

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <header className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-gray-900">Templates de Orçamento</h1>
            <p className="text-xs text-gray-400 mt-0.5">Configure o visual dos PDFs — faça upload das imagens de cada página do seu template</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-1.5">
              Bucket <code className="font-mono">quote-templates</code> deve estar público no Supabase Storage
            </span>
            <button
              onClick={() => { setEditing(null); setModalOpen(true) }}
              className="flex items-center gap-1.5 text-sm px-3 py-2 bg-[#3E9849] text-white rounded-xl hover:bg-[#35853F] transition-colors font-medium"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Novo template
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6">
        {templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-500">Nenhum template criado</p>
            <p className="text-xs text-gray-400 mt-1">Crie o primeiro template e faça upload das páginas do PDF</p>
          </div>
        ) : (
          <div className="space-y-8">
            {byAgeGroup.map(group => {
              const groupTemplates = templates.filter(t => t.age_group === group)
              if (!groupTemplates.length) return null
              return (
                <div key={group}>
                  <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{AGE_GROUP_LABELS[group]}</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {groupTemplates.map(t => (
                      <TemplateCard key={t.id} template={t}
                        onEdit={() => { setEditing(t); setModalOpen(true) }}
                        onDelete={() => handleDelete(t)}
                        onToggleDefault={() => handleToggleDefault(t)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {modalOpen && (
        <TemplateModal
          editing={editing}
          unitId={currentUser.unit_id}
          onClose={() => { setModalOpen(false); setEditing(null) }}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
