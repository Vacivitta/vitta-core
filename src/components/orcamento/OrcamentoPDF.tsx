import {
  Document, Page, Text, View, Image, StyleSheet,
} from '@react-pdf/renderer'
import type { QuoteWithItems, TemplatePageImages } from '@/types/database'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBRL(v: number | null) {
  if (v == null) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function validadeDate(iso: string, dias: number) {
  const d = new Date(iso)
  d.setDate(d.getDate() + dias)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ─── Full-page background image (A4 = 595 × 842 pt) ─────────────────────────

const FULL_PAGE_STYLE = {
  position: 'absolute' as const,
  top: 0, left: 0,
  width: 595,
  height: 842,
}

// ─── Styles for the template content page ────────────────────────────────────

function makeDataStyles(corTexto: string) {
  return StyleSheet.create({
    thText: { fontSize: 7, color: corTexto, opacity: 0.65, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.4 },
    tdText: { fontSize: 9, color: corTexto },
    tdBold: { fontSize: 9, color: corTexto, fontFamily: 'Helvetica-Bold' },
    colNome:  { flex: 3 },
    colQtd:   { flex: 0.8, textAlign: 'center' as const },
    colPreco: { flex: 1.5, textAlign: 'right' as const },
    colDesc:  { flex: 0.9, textAlign: 'center' as const },
    colTotal: { flex: 1.5, textAlign: 'right' as const },
    tableHeader: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: `${corTexto}40`,
      paddingBottom: 5,
      marginBottom: 4,
    },
    tableRow: {
      flexDirection: 'row',
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: `${corTexto}20`,
    },
  })
}

// ─── No-template fallback styles ──────────────────────────────────────────────

const FALLBACK = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: '#111827', backgroundColor: '#ffffff', padding: 40 },
  header: { backgroundColor: '#1D9E75', borderRadius: 8, padding: 20, marginBottom: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: '#ffffff' },
  headerSub: { fontSize: 9, color: 'rgba(255,255,255,0.8)' },
  sectionTitle: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 },
  patientGrid: { flexDirection: 'row', gap: 24, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6, padding: 12, marginBottom: 16 },
  patientField: { flex: 1 },
  fieldLabel: { fontSize: 7, color: '#9ca3af', marginBottom: 2 },
  fieldValue: { fontSize: 10, color: '#111827', fontFamily: 'Helvetica-Bold' },
  tableHeader: { flexDirection: 'row', backgroundColor: '#f3f4f6', borderRadius: 4, paddingVertical: 6, paddingHorizontal: 8, marginBottom: 2 },
  tableRow: { flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  thText: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  tdText: { fontSize: 9, color: '#374151' },
  tdBold: { fontSize: 9, color: '#111827', fontFamily: 'Helvetica-Bold' },
  colNome: { flex: 3 }, colQtd: { flex: 0.8, textAlign: 'center' as const },
  colPreco: { flex: 1.5, textAlign: 'right' as const }, colDesc: { flex: 0.9, textAlign: 'center' as const }, colTotal: { flex: 1.5, textAlign: 'right' as const },
  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  totalLabel: { fontSize: 11, color: '#6b7280' },
  totalValue: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#1D9E75' },
  footer: { position: 'absolute', bottom: 30, left: 40, right: 40, borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 8 },
  footerText: { fontSize: 7, color: '#9ca3af', lineHeight: 1.5 },
})

// ─── Items table (reused across both layouts) ─────────────────────────────────

function ItemsTable({ items, styles }: { items: QuoteWithItems['items']; styles: ReturnType<typeof makeDataStyles> | typeof FALLBACK }) {
  return (
    <>
      <View style={styles.tableHeader}>
        <View style={styles.colNome}><Text style={styles.thText}>Produto / Serviço</Text></View>
        <View style={styles.colQtd}><Text style={styles.thText}>Qtd</Text></View>
        <View style={styles.colPreco}><Text style={[styles.thText, { textAlign: 'right' }]}>Preço Unit.</Text></View>
        <View style={styles.colDesc}><Text style={styles.thText}>Desc.</Text></View>
        <View style={styles.colTotal}><Text style={[styles.thText, { textAlign: 'right' }]}>Total</Text></View>
      </View>
      {items.map(item => (
        <View key={item.id} style={styles.tableRow}>
          <View style={styles.colNome}>
            <Text style={styles.tdBold}>{item.nome_snapshot}</Text>
            {item.observacao && <Text style={[styles.tdText, { fontSize: 7, marginTop: 1, opacity: 0.65 }]}>{item.observacao}</Text>}
          </View>
          <View style={styles.colQtd}><Text style={styles.tdText}>{item.quantidade}</Text></View>
          <View style={styles.colPreco}><Text style={styles.tdText}>{fmtBRL(item.valor_snapshot)}</Text></View>
          <View style={styles.colDesc}>
            <Text style={item.desconto > 0 ? { ...styles.tdText, color: '#ef4444' } : styles.tdText}>
              {item.desconto > 0 ? `${item.desconto}%` : '—'}
            </Text>
          </View>
          <View style={styles.colTotal}><Text style={styles.tdBold}>{fmtBRL(item.valor_final)}</Text></View>
        </View>
      ))}
    </>
  )
}


// ─── PacoteTable (reused across both layouts) ─────────────────────────────────

function PacoteTable({ quote, corTexto }: {
  quote:    QuoteWithItems
  corTexto: string
}) {
  if (!quote.pacote_ativo || !quote.pacote_opcoes?.length) return null
  const base  = quote.total_calculado ?? quote.items.reduce((s, i) => s + i.valor_final, 0)
  const faint = `${corTexto}40`

  return (
    <View style={{ marginTop: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: faint }}>
      <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: corTexto, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Condições de Pagamento
      </Text>
      {quote.pacote_opcoes.map((o, i) => {
        const total = Math.round(base * (1 - o.desconto / 100) * 100) / 100
        const isLast = i === quote.pacote_opcoes!.length - 1
        return (
          <View key={o.id} style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            paddingVertical: 6,
            borderBottomWidth: isLast ? 0 : 0.5,
            borderBottomColor: faint,
          }}>
            <View style={{ flex: 2 }}>
              <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: corTexto }}>{o.label}</Text>
              <Text style={{ fontSize: 7, color: corTexto, opacity: 0.6, marginTop: 1 }}>{o.metodos.join(' · ')}</Text>
              {o.desconto > 0 && (
                <Text style={{ fontSize: 7, color: corTexto, opacity: 0.55, marginTop: 1 }}>{o.desconto}% de desconto</Text>
              )}
            </View>
            <View style={{ flex: 1.2, alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: corTexto }}>{fmtBRL(total)}</Text>
            </View>
          </View>
        )
      })}
    </View>
  )
}

// ─── Main document ────────────────────────────────────────────────────────────

export default function OrcamentoPDF({ quote }: { quote: QuoteWithItems }) {
  const t       = quote.template
  const paginas = (t?.paginas_imagens ?? {}) as TemplatePageImages
  const corTexto      = t?.cor_texto_conteudo ?? '#ffffff'
  const corPrimaria   = t?.cor_primaria       ?? '#67bea0'
  const corSecundaria = t?.cor_secundaria     ?? '#185FA5'
  const nomeClinica   = t?.nome_clinica       ?? 'Vitta Core'
  const validadeDias  = t?.validade_dias      ?? 7
  const numStr  = quote.numero ? String(quote.numero).padStart(4, '0') : '0000'
  const patientName = quote.lead
    ? `${quote.lead.nome}${quote.lead.sobrenome ? ` ${quote.lead.sobrenome}` : ''}`
    : quote.client
    ? `${quote.client.nome}${quote.client.sobrenome ? ` ${quote.client.sobrenome}` : ''}`
    : '—'
  const patientPhone = quote.lead?.telefone ?? quote.client?.telefone ?? null
  const totalCalc    = quote.total_calculado ?? quote.items.reduce((s, i) => s + i.valor_final, 0)
  const rodapeText   = (t?.texto_rodape ?? '').replace('{validade_dias}', String(t?.validade_dias ?? 7))

  // ── With template — solid-color content page + optional image pages ─────────
  if (t) {
    const S = makeDataStyles(corTexto)

    // Inline styles for the content page (no absolute positioning)
    const txt   = corTexto
    const faint = `${corTexto}60`

    return (
      <Document title={`Orçamento #${numStr}`} author={nomeClinica}>

        {/* Capa */}
        {paginas.capa && (
          <Page size="A4" style={{ padding: 0 }}>
            <Image src={paginas.capa} style={FULL_PAGE_STYLE} />
          </Page>
        )}

        {/* Intro pages */}
        {paginas.intro?.map((url, i) => (
          <Page key={i} size="A4" style={{ padding: 0 }}>
            <Image src={url} style={FULL_PAGE_STYLE} />
          </Page>
        ))}

        {/* Content page — solid backgroundColor, normal flow */}
        <Page size="A4" style={{
          padding: 0,
          fontFamily: 'Helvetica',
          fontSize: 9,
          backgroundColor: corPrimaria,
        }}>
          <View style={{ paddingHorizontal: 36, paddingTop: 36, paddingBottom: 60 }}>
            <Text style={{ fontSize: 20, fontFamily: 'Helvetica-Bold', color: txt, marginBottom: 4, letterSpacing: 1 }}>
              ORÇAMENTO #{numStr}
            </Text>
            <Text style={{ fontSize: 9, color: txt, opacity: 0.75, marginBottom: 20 }}>
              Emitido em {fmtDate(quote.criado_em)}
              {nomeClinica !== 'Vitta Core' ? `  ·  ${nomeClinica}` : ''}
              {'  ·  Válido até ' + validadeDate(quote.criado_em, validadeDias)}
            </Text>

            <View style={{ flexDirection: 'row', gap: 20, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 6, padding: 12, marginBottom: 16 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 7, color: txt, opacity: 0.65, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Paciente</Text>
                <Text style={{ fontSize: 10, color: txt, fontFamily: 'Helvetica-Bold' }}>{patientName}</Text>
              </View>
              {patientPhone && (
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 7, color: txt, opacity: 0.65, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>Telefone</Text>
                  <Text style={{ fontSize: 10, color: txt, fontFamily: 'Helvetica-Bold' }}>{patientPhone}</Text>
                </View>
              )}
            </View>

            <ItemsTable items={quote.items} styles={S} />

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 12, paddingTop: 10, borderTopWidth: 1.5, borderTopColor: faint }}>
              <Text style={{ fontSize: 11, color: txt, opacity: 0.75 }}>TOTAL</Text>
              <Text style={{ fontSize: 18, fontFamily: 'Helvetica-Bold', color: txt }}>{fmtBRL(totalCalc)}</Text>
            </View>

            <PacoteTable quote={quote} corTexto={corTexto} />

            {rodapeText && (
              <View style={{ marginTop: 16, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: faint }}>
                <Text style={{ fontSize: 7, color: txt, opacity: 0.55, lineHeight: 1.5 }}>{rodapeText}</Text>
              </View>
            )}
          </View>
        </Page>

        {/* Encerramento */}
        {paginas.encerramento && (
          <Page size="A4" style={{ padding: 0 }}>
            <Image src={paginas.encerramento} style={FULL_PAGE_STYLE} />
          </Page>
        )}

      </Document>
    )
  }

  // ── Fallback: no template — clean layout with default colors ───────────────
  return (
    <Document title={`Orçamento #${numStr}`} author={nomeClinica}>
      <Page size="A4" style={FALLBACK.page}>

        {/* Header */}
        <View style={[FALLBACK.header, { backgroundColor: corPrimaria }]}>
          <View>
            <Text style={FALLBACK.headerTitle}>ORÇAMENTO #{numStr}</Text>
            <Text style={FALLBACK.headerSub}>{nomeClinica}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={FALLBACK.headerSub}>Emitido em {fmtDate(quote.criado_em)}</Text>
            <Text style={FALLBACK.headerSub}>Válido até {validadeDate(quote.criado_em, validadeDias)}</Text>
          </View>
        </View>

        {/* Patient */}
        <Text style={FALLBACK.sectionTitle}>Dados do Paciente</Text>
        <View style={FALLBACK.patientGrid}>
          <View style={FALLBACK.patientField}>
            <Text style={FALLBACK.fieldLabel}>Nome</Text>
            <Text style={FALLBACK.fieldValue}>{patientName}</Text>
          </View>
          {patientPhone && (
            <View style={FALLBACK.patientField}>
              <Text style={FALLBACK.fieldLabel}>Telefone</Text>
              <Text style={FALLBACK.fieldValue}>{patientPhone}</Text>
            </View>
          )}
        </View>

        {/* Items */}
        <Text style={FALLBACK.sectionTitle}>Itens do Orçamento</Text>
        <ItemsTable items={quote.items} styles={FALLBACK} />

        {/* Total */}
        <View style={FALLBACK.totalRow}>
          <Text style={FALLBACK.totalLabel}>TOTAL</Text>
          <Text style={[FALLBACK.totalValue, { color: corPrimaria }]}>{fmtBRL(totalCalc)}</Text>
        </View>

        <PacoteTable quote={quote} corTexto="#111827" />

        {/* Footer */}
        {rodapeText && (
          <View style={FALLBACK.footer} fixed>
            <Text style={FALLBACK.footerText}>{rodapeText}</Text>
          </View>
        )}

      </Page>
    </Document>
  )
}
