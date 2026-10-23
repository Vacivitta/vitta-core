# Módulo de telemarketing — plano de integração

> Status: **em definição de escopo** — nenhum código implementado.
> Base: `especificacao_telemarketing.md` (v0.1, set/2026). Última revisão do plano: out/2026.

## Mudanças de escopo em relação à spec v0.1

1. **Sem integração de telefonia.** As ligações são feitas direto pelo celular e apenas **registradas** no CRM.
   Sai a seção 7 (Digital Vox), a entidade "Chamada" automática e os critérios de aceite 5 e 6.
2. **Importação do VitaPrimo sem layout pronto.** Os dados vêm de mais de um relatório (pacientes + vacinas)
   ou de um relatório paciente × vacina com linhas repetidas. O CRM precisa de uma **etapa de consolidação**.

## Princípio: módulo isolado

- Tabelas próprias com prefixo `tm_*`; nenhuma tabela existente ganha coluna obrigatória ou trigger.
- Rotas próprias: `/telemarketing/*`, `/configuracoes/telemarketing`, `/api/telemarketing/*`.
- Ativação por unidade (interruptor na unidade); o menu só aparece onde estiver ligado.
- RLS no padrão já usado nas conversas: `is_global_admin() OR unit_id IN (user_units do usuário)`.
- Fila calculada no banco (consulta/RPC paginada) — nunca carregar milhares de linhas no navegador
  (lembrar do corte de 1000 linhas do Supabase; usar `fetchAll` quando listar).
- Responsáveis **não** viram `leads`: importar milhares de pendências como leads inundaria o funil,
  dispararia automações de etapa, distorceria o dashboard e entraria no público das campanhas.
  Vínculo com lead apenas **de leitura, pelo telefone** (mostrar histórico de WhatsApp/orçamentos na ficha).

## Reaproveitamento

| Spec | Existe hoje | Decisão |
|---|---|---|
| Unidade | `units` | Reaproveitar |
| Usuários e acesso por unidade | `profiles` + `user_units` | Reaproveitar |
| Atendente / Supervisor / Admin | `atendente`, `gestor_unidade`/`gestor_vacivitta`, `admin` | Mapear |
| Responsável técnico (RT) | — | Marcação no perfil (não um perfil novo) |
| Tabela de vacinas | `products` (36 vacinas/unidade, com marca e preço) | Catálogo próprio de vacinas genéricas + apelidos p/ casar com o VitaPrimo; ligação opcional a `products` |
| Responsável → pacientes | `leads` + `lead_contacts` | Não reaproveitar (ver acima) |
| Funil B2B | Componentes de kanban (`KanbanBoard`, ordenação) | Reaproveitar componentes, tabelas próprias |
| WhatsApp (fase 2) | Integração Meta, templates, conversas | Reaproveitar |

## Ligação pelo celular (registro manual)

- Botão "Ligar" = link `tel:` (útil se o atendente usa o CRM no celular); no computador, mostrar o número com botão de copiar.
- Registro da tentativa 100% manual (resultado, observação, duração opcional); continua obrigatório antes de abrir o próximo contato.
- Hora da tentativa = hora do registro → combinar registro logo após cada ligação (regras de "manhã/tarde" e horário permitido dependem disso).
- Indicadores: "ligações" e "taxa de contato" passam a contar tentativas registradas; "tempo médio de ligação" sai ou vira estimativa.
- Se a Digital Vox for contratada no futuro, entra por cima do registro manual sem retrabalho.

## Importação com consolidação

Ponto decisivo — **o que o VitaPrimo exporta**:

- **Cenário A — exporta pendências** (o que falta aplicar, com data prevista): consolidação organizacional
  (juntar pacientes × vacinas pelo código do paciente, agrupar repetidos por responsável).
- **Cenário B — exporta só o histórico aplicado**: o CRM teria de **calcular** pendências a partir de um
  calendário vacinal com regras por vacina, mantido pelo RT. Projeto à parte, com risco clínico;
  começar só por regras simples (reforço anual da gripe, 2ª dose com intervalo fixo).

A consolidação precisa resolver:

- Junção dos arquivos pelo código do paciente (paciente sem vacina, vacina sem paciente).
- Linhas repetidas: pendência única = paciente + vacina + dose; duplicatas exatas × conflitantes (datas diferentes).
- Responsável: de qual relatório vem; adulto como o próprio responsável.
- Nomes de vacina do VitaPrimo × catálogo do CRM: tabela de correspondência mantida pelo RT/gestor.
- Mapeamento de colunas na tela (lembrado entre cargas) em vez de layout fixo.
- Prévia antes de gravar + lista de triagem (sem par, duplicados, vacina não reconhecida, sem telefone).

## Ordem sugerida

| Etapa | Entrega | Depende de |
|---|---|---|
| 1 | Tabelas `tm_*`, permissões, ativação por unidade, catálogo de vacinas, parâmetros (T7) | — |
| 2 | Importação com consolidação, prévia, carga completa/incremental, triagem (T4) | Exportações reais do VitaPrimo |
| 3 | Fila do dia com priorização (T1) + ficha com registro obrigatório, tentativas, "não contatar" (T2) | — |
| 4 | Roteiros e fichas técnicas com aprovação do RT (T3) | — |
| 5 | B2B: empresas, oportunidades, kanban, renovação automática (T5) — pode vir antes se a campanha de gripe 2027 apertar | — |
| 6 | Indicadores (T6) e WhatsApp | Etapas anteriores |

## Pendências para fechar o escopo

1. Exportação de cada relatório do VitaPrimo (cabeçalho + ~20 linhas, anonimizadas).
2. Cenário A (pendências) ou B (só histórico aplicado)?
3. Celular corporativo ou pessoal (LGPD, número exibido ao cliente); CRM usado no celular ou no computador?
4. Começar por B2C (etapas 1–4) ou B2B primeiro (campanha de gripe)?
5. Opt-out do WhatsApp ("PARAR", `leads.wa_optout_at`) deve bloquear também o telemarketing ("não contatar")?
6. Leitura de XLSX: adicionar biblioteca ou começar só com CSV.
7. Jurídico (consentimento, contato com menores) e RT (tabela de vacinas, roteiros) — bloqueiam o piloto, não o desenvolvimento.
