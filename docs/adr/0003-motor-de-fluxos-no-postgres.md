# Motor de fluxos dentro do Postgres, sem fila externa

Os fluxos (estilo n8n) rodam no banco que já temos: eventos do CRM entram por trigger numa fila em tabela, e o agendador do pg_cron, a cada minuto, reserva o que venceu com `FOR UPDATE SKIP LOCKED` e executa os passos de cada registro até a próxima espera. Decidimos (05/11/2026) não usar Redis/BullMQ como o n8n porque o estado fica num lugar só, sobrevive a reinício e não há mais um serviço para operar na VPS; o custo aceito é uma latência de até 1 minuto por passo.

## Considered Options

Fila com Redis e workers (latência de segundos, mais um serviço e um segundo lugar com estado); LISTEN/NOTIFY do Postgres (perde eventos se o processo cair).
