# VittaDesk

Plataforma de relacionamento da marca Vacivitta: cada clínica, licenciado ou área de serviço trabalha numa unidade própria, com funis, campos, conversas e automações configurados sem mudar código.

## Organização

**Marca**:
A rede que mantém a plataforma, os modelos de unidade e o catálogo base, e enxerga tudo de todas as unidades, próprias e licenciadas.
_Avoid_: Tenant, rede, franquia

**Licenciado**:
Organização que comprou a licença da marca e opera uma ou mais unidades licenciadas, podendo criar outras.
_Avoid_: Franqueado, parceiro, cliente da marca

**Unidade**:
Um espaço de trabalho no VittaDesk, com seus próprios registros, configurações e conexões (uma clínica, o comercial de licenças, a CS).
_Avoid_: Filial, conta, empresa

**Unidade própria**:
Unidade operada pela própria marca (hoje Salto, Itu, Comercial).
_Avoid_: Matriz, unidade da rede

**Unidade licenciada**:
Unidade operada por um licenciado.
_Avoid_: Franquia, unidade parceira

**Modelo de unidade**:
Pacote de configuração mantido pela marca (funis, campos, tags, tipos de serviço, horários, fluxos) copiado para uma unidade quando a marca a cria.
_Avoid_: Template, preset

**Clonar unidade**:
Criar uma unidade copiando a configuração de outra unidade do mesmo licenciado; é como o licenciado cria unidades, além de começar do zero.
_Avoid_: Duplicar, copiar modelo

**Gestor do licenciado**:
Papel de quem administra todas as unidades de um licenciado: cria unidades e usuários e configura, sem ver outros licenciados nem as unidades próprias.
_Avoid_: Admin do franqueado, dono

**Usuário**:
Pessoa que entra no VittaDesk, vinculada a uma ou mais unidades com um papel em cada (atendente, gestor).
_Avoid_: Agente, operador, perfil

## Registros

**Contato**:
Uma pessoa com quem a unidade se relaciona; é cliente para sempre depois do primeiro ganho.
_Avoid_: Lead, paciente, cliente (como registro)

**Negócio**:
Uma oportunidade com um contato, que anda num funil e termina ganha ou perdida; o contato pode ter vários ao longo do tempo.
_Avoid_: Lead, oportunidade, deal

**Empresa**:
Uma organização com que a unidade se relaciona (licenciado, cliente corporativo, fornecedor); ligada ou não conforme a unidade.
_Avoid_: Conta, organização

**Ticket**:
Um pedido de suporte com funil próprio, aberto por ou para um contato, uma empresa ou alguém da equipe.
_Avoid_: Chamado, ocorrência, protocolo

**Dependente**:
Contato ligado a outro contato que responde por ele (ex.: criança vacinada e o responsável).
_Avoid_: Paciente vinculado, contato secundário

## Funil e status

**Funil**:
Sequência de etapas por onde passam negócios (ou tickets) de uma unidade.
_Avoid_: Pipeline, quadro, kanban

**Etapa**:
Uma posição no funil; pode marcar resultado de ganho ou de perda.
_Avoid_: Fase, coluna, estágio

**Ganho**:
Status do negócio fechado com sucesso; torna o contato cliente.
_Avoid_: Convertido, vendido, finalizado

**Perdido**:
Status do negócio que não aconteceu, sempre com um motivo de perda.
_Avoid_: Arquivado, cancelado, finalizado

**Arquivado**:
Registro tirado do quadro por não ser um negócio de verdade (spam, engano, fornecedor), independente do status.
_Avoid_: Perdido, excluído

## Conversas

**Conexão**:
Um número de WhatsApp ligado a uma unidade, pela API oficial da Meta ou por QR Code.
_Avoid_: Canal, instância, número

**Conversa**:
A troca de mensagens de uma conexão com um contato ou com um grupo.
_Avoid_: Chat, atendimento, ticket

**Grupo**:
Conversa com vários participantes, só disponível em conexões por QR Code.
_Avoid_: Comunidade, lista

## Configuração

**Módulo**:
Conjunto de funções que cada unidade liga ou desliga (Empresas, Tickets, Orçamentos, Campanhas...); nenhum é exclusivo de um tipo de unidade.
_Avoid_: Recurso, add-on, plugin

**Campo personalizado**:
Informação que a unidade define para seus registros, com tipo (texto, data, seleção...).
_Avoid_: Propriedade, atributo, campo extra

**Tag de cliente**:
Marcador aplicado ao contato ou negócio.
_Avoid_: Etiqueta, label

**Tag de conversa**:
Marcador aplicado a uma conversa, separado das tags de cliente.
_Avoid_: Etiqueta, label

**Serviço**:
Item do catálogo da unidade que pode entrar num orçamento (vacina, exame, consulta, pacote, licença).
_Avoid_: Produto, item

**Fluxo**:
Automação montada pela unidade: um gatilho e passos (ações, condições, esperas), com rascunho e versão publicada.
_Avoid_: Workflow, automação (como nome do conceito), regra

**Horário de atendimento**:
Dias, horas e feriados em que a unidade (ou uma fila) atende, com fuso próprio.
_Avoid_: Expediente, horário comercial
