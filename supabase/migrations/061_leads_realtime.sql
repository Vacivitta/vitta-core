-- Adiciona a tabela leads à publicação Realtime do Supabase
-- para que o funil e outras páginas recebam eventos em tempo real
ALTER PUBLICATION supabase_realtime ADD TABLE leads;
