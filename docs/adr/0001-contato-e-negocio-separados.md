# Contato e Negócio são registros separados

O lead do VittaDesk era ao mesmo tempo a pessoa e a oportunidade, o que obrigava a "reabrir" o negócio quando um cliente voltava e misturava o histórico de vendas diferentes. Decidimos (05/11/2026) separar Contato (a pessoa, cliente para sempre) de Negócio (cada oportunidade, com funil e status), associados entre si e opcionalmente a uma Empresa, como no HubSpot. A separação vem antes do motor de fluxos, porque os gatilhos e ações falam desses registros.

## Consequences

Cada lead atual vira um contato e um negócio; o negócio mantém o id do lead para os links e registros existentes continuarem válidos. Durante a transição o app lê os dois modelos.
