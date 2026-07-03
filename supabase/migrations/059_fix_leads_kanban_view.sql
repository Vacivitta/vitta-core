-- Corrige a view leads_kanban:
-- 1. Adiciona is_converted e unit_id (faltavam desde a migration de merge)
-- 2. Corrige alias stage_alerta_dias → stage_alerta_horas (bug da migration 038)
DROP VIEW IF EXISTS leads_kanban;

CREATE VIEW leads_kanban AS
 SELECT l.id,
    l.nome,
    l.sobrenome,
    l.profissao,
    l.cidade,
    l.estado,
    l.pais,
    l.instagram,
    l.site,
    l.email,
    l.telefone,
    l.responsavel_id,
    l.arquivado,
    l.motivo_perda,
    l.ordem,
    l.created_at,
    l.updated_at,
    l.funnel_id,
    l.stage_id,
    l.origem,
    l.stage_changed_at,
    l.unit_id,
    l.is_converted,
    COALESCE(NULLIF(TRIM(p.apelido), ''), split_part(p.full_name, ' ', 1)) AS responsavel_nome,
    p.avatar_url AS responsavel_avatar,
    fs.nome AS stage_nome,
    fs.cor AS stage_cor,
    fs.ordem AS stage_ordem,
    fs.alerta_dias AS stage_alerta_horas,
    f.nome AS funnel_nome,
    ln.valor_proposta,
    ln.modelo,
    ln.valor_negociado,
    (( SELECT count(*) AS count
           FROM lead_tasks t
          WHERE ((t.lead_id = l.id) AND (t.concluida = false))))::integer AS tarefas_pendentes,
    (( SELECT count(*) AS count
           FROM lead_notes n
          WHERE (n.lead_id = l.id)))::integer AS total_notas,
    (( SELECT count(*) AS count
           FROM lead_contacts c
          WHERE (c.lead_id = l.id)))::integer AS total_contatos
   FROM ((((leads l
     LEFT JOIN profiles p ON ((p.id = l.responsavel_id)))
     LEFT JOIN funnel_stages fs ON ((fs.id = l.stage_id)))
     LEFT JOIN funnels f ON ((f.id = l.funnel_id)))
     LEFT JOIN lead_negotiation ln ON ((ln.lead_id = l.id)))
  WHERE (l.arquivado = false)
  ORDER BY fs.ordem, l.ordem, l.created_at;
