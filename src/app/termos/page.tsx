import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Termos e Condições Gerais de Uso e Licenciamento — VittaDesk',
  description: 'Termos e Condições Gerais de Uso e Licenciamento do sistema VittaDesk, da Vacivitta Saúde Integrada LTDA.',
}

export default function TermosPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-6">
          <div className="h-1.5 bg-[#0098DA]" />
          <div className="px-8 py-6">
            <p className="text-xs font-semibold text-[#0098DA] uppercase tracking-widest mb-1">Vacivitta Saúde Integrada LTDA</p>
            <h1 className="text-2xl font-bold text-gray-900 leading-tight">
              Termos e Condições Gerais de Uso e Licenciamento
            </h1>
            <p className="text-sm text-gray-500 mt-2">
              Sistema VittaDesk &nbsp;·&nbsp; Versão 1.0 &nbsp;·&nbsp; Publicado em 19/06/2026
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="bg-white rounded-2xl shadow-sm px-8 py-8 space-y-8 text-gray-700 text-sm leading-relaxed">

          {/* 1 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">1. Conceitos Importantes</h2>
            <p className="mb-2">Para fins deste instrumento, adotam-se as seguintes definições:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Vacivitta / Fornecedora:</strong> Vacivitta Saúde Integrada LTDA, pessoa jurídica de direito privado, inscrita no CNPJ sob o n.º 26.915.400/0001-10, com sede na Rua Benjamin Constant, 185, Centro, Salto/SP, CEP 13320-120, proprietária e desenvolvedora do Sistema VittaDesk.</li>
              <li><strong>Cliente / Licenciado:</strong> Pessoa física ou jurídica que contrata o acesso ao Sistema VittaDesk mediante plano de assinatura.</li>
              <li><strong>Usuário:</strong> Qualquer pessoa autorizada pelo Cliente a acessar e operar o Sistema, como colaboradores, funcionários e parceiros.</li>
              <li><strong>Sistema VittaDesk:</strong> Plataforma de CRM comercial desenvolvida pela Vacivitta, acessada via navegador web (Software como Serviço — SaaS), destinada à gestão de leads, orçamentos, agendamentos, atendimento e relacionamento comercial de clínicas e empresas da área de saúde.</li>
              <li><strong>Licença de Uso:</strong> Direito não exclusivo e intransferível concedido ao Cliente de acessar e utilizar o Sistema durante a vigência da assinatura contratada.</li>
              <li><strong>Dados do Cliente:</strong> Informações, registros e conteúdos inseridos pelo Cliente ou seus Usuários na plataforma, tais como cadastros de leads, clientes, orçamentos, anotações e histórico de atendimento.</li>
            </ul>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">2. Aceitação dos Termos</h2>
            <p className="mb-2">
              Ao contratar, acessar ou utilizar o Sistema VittaDesk, o Cliente declara ter lido, compreendido e aceito integralmente estes Termos e Condições Gerais de Uso e Licenciamento, bem como a Política de Privacidade (Aviso de Privacidade) da Vacivitta, que constituem o contrato vinculante entre as partes.
            </p>
            <p>
              A aceitação pode ocorrer de forma eletrônica, mediante clique em botão de confirmação, utilização das credenciais de acesso ou qualquer conduta que demonstre inequivocamente o uso do Sistema. O uso continuado do Sistema após a publicação de atualizações destes Termos implicará na aceitação tácita das alterações.
            </p>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">3. Objeto e Natureza do Serviço</h2>
            <p className="mb-2">
              O presente instrumento tem por objeto a concessão, pela Vacivitta ao Cliente, de licença de uso temporária e não exclusiva do Sistema VittaDesk, disponibilizado exclusivamente na modalidade SaaS (Software como Serviço), acessível via navegador na internet.
            </p>
            <p className="mb-2">
              O Sistema oferece, entre outras funcionalidades:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Gestão de leads e funil de vendas (Kanban)</li>
              <li>Emissão, envio e controle de orçamentos com link público de aceite</li>
              <li>Cadastro de clientes, produtos e catálogo de serviços</li>
              <li>Agenda e controle de tarefas</li>
              <li>Atendimento via WhatsApp (com integração à API oficial Meta)</li>
              <li>Automações de funil e notificações internas</li>
              <li>Painel de supervisão e relatórios</li>
              <li>Gestão de equipe com perfis de acesso (Admin, Gestor, Atendente)</li>
            </ul>
            <p className="mt-2">
              A Vacivitta reserva-se o direito de adicionar, modificar ou remover funcionalidades do Sistema a qualquer tempo, comunicando o Cliente com antecedência razoável nos casos de alterações relevantes.
            </p>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">4. Licença de Uso</h2>
            <p className="mb-2">
              A Vacivitta concede ao Cliente uma licença de uso limitada, pessoal, não exclusiva, não sublicenciável e intransferível para acessar e utilizar o Sistema VittaDesk durante o período de vigência da assinatura contratada, exclusivamente para fins comerciais internos do Cliente.
            </p>
            <p className="mb-2"><strong>É expressamente proibido ao Cliente:</strong></p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Copiar, reproduzir, distribuir ou comercializar o Sistema ou qualquer parte de seu código-fonte;</li>
              <li>Realizar engenharia reversa, descompilar, desmontar ou tentar extrair o código-fonte do Sistema;</li>
              <li>Sublicenciar, alugar, vender, transferir ou ceder o acesso ao Sistema a terceiros não autorizados;</li>
              <li>Modificar, adaptar ou criar obras derivadas do Sistema;</li>
              <li>Utilizar o Sistema para fins ilegais, fraudulentos ou contrários à ordem pública;</li>
              <li>Sobrecarregar, interferir ou comprometer a integridade, desempenho ou segurança da infraestrutura do Sistema.</li>
            </ul>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">5. Planos, Pagamento e Renovação</h2>
            <p className="mb-2">
              O acesso ao Sistema VittaDesk é condicionado à contratação de um dos planos de assinatura disponibilizados pela Vacivitta, conforme tabela de preços vigente à época da contratação.
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Periodicidade:</strong> Os planos podem ser mensais ou anuais, conforme opção do Cliente no ato da contratação.</li>
              <li><strong>Pagamento:</strong> Realizado antecipadamente por meio dos métodos disponíveis na plataforma de pagamento da Vacivitta. O parcelamento do plano anual, quando disponível, não equivale ao direito de cancelamento proporcional.</li>
              <li><strong>Renovação:</strong> A assinatura é renovada automaticamente ao final de cada período, salvo cancelamento expresso pelo Cliente com antecedência mínima de 5 (cinco) dias úteis antes do vencimento.</li>
              <li><strong>Reajuste:</strong> A Vacivitta poderá reajustar os valores dos planos anualmente, com comunicação prévia de ao menos 30 (trinta) dias.</li>
              <li><strong>Direito de arrependimento:</strong> Nos termos do art. 49 do Código de Defesa do Consumidor (CDC), o Cliente pessoa física tem o direito de cancelar a contratação em até 7 (sete) dias corridos a partir da data de contratação, mediante reembolso integral dos valores pagos. Após esse prazo, não haverá reembolso proporcional em caso de cancelamento antecipado.</li>
              <li><strong>Inadimplência:</strong> O não pagamento na data de vencimento poderá resultar na suspensão ou bloqueio de acesso ao Sistema, sem prejuízo da cobrança dos valores devidos acrescidos de multa de 2% e juros de mora de 1% ao mês.</li>
            </ul>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">6. Obrigações das Partes</h2>
            <h3 className="font-semibold text-gray-800 mb-2">6.1 Obrigações da Vacivitta</h3>
            <ul className="list-disc pl-5 space-y-1 mb-4">
              <li>Disponibilizar o Sistema em funcionamento durante o período contratado, com esforços razoáveis para garantir disponibilidade mínima de 99% mensal;</li>
              <li>Realizar manutenções e atualizações do Sistema, comunicando previamente quando houver indisponibilidade programada;</li>
              <li>Tratar os Dados do Cliente com confidencialidade e conforme a legislação aplicável, em especial a LGPD (Lei n.º 13.709/2018);</li>
              <li>Prestar suporte técnico nos termos do item 7 deste instrumento.</li>
            </ul>
            <h3 className="font-semibold text-gray-800 mb-2">6.2 Obrigações do Cliente</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Manter suas credenciais de acesso em sigilo e ser responsável por todo uso realizado com sua conta;</li>
              <li>Utilizar o Sistema exclusivamente para fins lícitos e nos termos desta licença;</li>
              <li>Manter atualizadas suas informações cadastrais junto à Vacivitta;</li>
              <li>Responsabilizar-se pelo cumprimento da LGPD perante seus próprios clientes/pacientes, cujos dados sejam inseridos no Sistema;</li>
              <li>Responsabilizar-se pela aquisição, manutenção e custos de sua própria conectividade com a internet e dispositivos de acesso;</li>
              <li>Obter e manter, às suas custas, eventuais licenças de uso de ferramentas de terceiros integradas ao Sistema (ex.: API Oficial do WhatsApp / Meta);</li>
              <li>Realizar backups adicionais dos dados críticos de seu negócio, não dependendo exclusivamente das cópias mantidas pelo Sistema.</li>
            </ul>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">7. Suporte Técnico e Disponibilidade</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Canal de atendimento:</strong> O suporte é prestado por meio dos canais oficiais da Vacivitta (e-mail, WhatsApp ou sistema de tickets, conforme disponível).</li>
              <li><strong>Horário de atendimento:</strong> Segunda a sexta-feira, das 8h às 18h (horário de Brasília), exceto feriados nacionais e do município de Salto/SP.</li>
              <li><strong>Prazo de resposta:</strong> Em regra, até 3 (três) dias úteis após o chamado, podendo variar conforme a complexidade da demanda.</li>
              <li><strong>Escopo do suporte:</strong> O suporte inclui dúvidas sobre funcionalidades do Sistema, correção de erros/bugs e orientações de configuração interna do VittaDesk.</li>
              <li><strong>Fora do escopo:</strong> O suporte não contempla configuração de dispositivos, redes, sistemas operacionais, ferramentas de terceiros (ex.: Meta Business Manager, WhatsApp Business) nem customizações não previstas na plataforma.</li>
              <li><strong>Indisponibilidades:</strong> Indisponibilidades decorrentes de falhas de terceiros (Meta, operadoras, provedores de infraestrutura) ou de força maior não geram direito a reembolso ou indenização.</li>
            </ul>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">8. Propriedade Intelectual</h2>
            <p className="mb-2">
              O Sistema VittaDesk, seu código-fonte, design, interfaces, logotipos, marcas, documentação e demais elementos são de propriedade exclusiva da Vacivitta Saúde Integrada LTDA, protegidos pela legislação brasileira de propriedade intelectual (Lei n.º 9.279/1996 e Lei n.º 9.609/1998) e pelas convenções internacionais aplicáveis.
            </p>
            <p className="mb-2">
              A concessão da licença de uso não implica cessão de qualquer direito de propriedade intelectual ao Cliente. Todos os direitos não expressamente concedidos neste instrumento são reservados à Vacivitta.
            </p>
            <p>
              Os Dados do Cliente permanecem de propriedade do Cliente. A Vacivitta não reivindica qualquer direito de propriedade sobre os conteúdos inseridos pelo Cliente no Sistema.
            </p>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">9. Privacidade e Proteção de Dados (LGPD)</h2>
            <p className="mb-2">
              O tratamento de dados pessoais realizado no contexto do uso do Sistema VittaDesk é regido pela Lei Geral de Proteção de Dados Pessoais (LGPD — Lei n.º 13.709/2018) e detalhado no <strong>Aviso de Privacidade</strong> da Vacivitta, disponível em <a href="/privacidade" className="text-[#0098DA] underline">/privacidade</a>.
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Vacivitta como Controladora:</strong> A Vacivitta trata os dados cadastrais do Cliente (razão social, CNPJ, e-mail, telefone) como Controladora, para fins de gestão contratual e prestação do serviço.</li>
              <li><strong>Vacivitta como Operadora:</strong> Em relação aos dados que o Cliente insere no Sistema (dados de seus pacientes/clientes finais), a Vacivitta atua como Operadora, processando-os exclusivamente por instrução do Cliente, que permanece como Controlador.</li>
              <li><strong>Responsabilidade do Cliente:</strong> O Cliente é o único responsável pela licitude da coleta e inserção dos dados de seus clientes/pacientes no Sistema, devendo cumprir todas as obrigações legais aplicáveis, incluindo a obtenção de consentimento quando exigido.</li>
            </ul>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">10. Limitação de Responsabilidade</h2>
            <p className="mb-2">
              A Vacivitta não será responsável por danos indiretos, incidentais, especiais, consequenciais ou punitivos, incluindo perda de lucros, de receita, de dados ou de oportunidades de negócio, ainda que tenha sido alertada sobre a possibilidade de tais danos, desde que não decorram de dolo ou culpa grave da Vacivitta.
            </p>
            <p className="mb-2">A Vacivitta não se responsabiliza por:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Uso indevido do Sistema pelo Cliente ou seus Usuários;</li>
              <li>Ações ou omissões de terceiros, inclusive plataformas de pagamento, operadoras de telefonia, Meta/WhatsApp e outros provedores;</li>
              <li>Falhas de conectividade ou interrupção dos serviços de internet;</li>
              <li>Danos resultantes de informações incorretas inseridas pelo Cliente no Sistema;</li>
              <li>Qualquer decisão comercial, clínica ou operacional tomada com base nos dados ou relatórios do Sistema.</li>
            </ul>
            <p className="mt-2">
              A responsabilidade total da Vacivitta perante o Cliente, por qualquer causa, será limitada ao valor efetivamente pago pelo Cliente nos últimos 3 (três) meses imediatamente anteriores ao evento gerador do dano.
            </p>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">11. Vigência e Rescisão</h2>
            <p className="mb-2">
              Este contrato entra em vigor na data da contratação e permanece válido enquanto houver assinatura ativa.
            </p>
            <p className="mb-2"><strong>A Vacivitta poderá rescindir ou suspender o acesso do Cliente imediatamente, sem aviso prévio, nos seguintes casos:</strong></p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Violação de qualquer cláusula destes Termos;</li>
              <li>Uso do Sistema para fins ilegais, fraudulentos ou contrários à boa-fé;</li>
              <li>Inadimplência prolongada por mais de 15 (quinze) dias;</li>
              <li>Conduta abusiva, ameaçadora ou vexatória para com a equipe da Vacivitta.</li>
            </ul>
            <p className="mt-2">
              Na hipótese de rescisão, o Cliente terá prazo de 30 (trinta) dias para exportar seus dados do Sistema. Após esse prazo, a Vacivitta poderá excluir definitivamente os dados do Cliente de seus servidores.
            </p>
          </section>

          {/* 12 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">12. Disposições Gerais</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Alterações:</strong> A Vacivitta pode modificar estes Termos a qualquer tempo, publicando a versão atualizada no Sistema ou por e-mail ao Cliente com antecedência mínima de 15 (quinze) dias. O uso continuado do Sistema após a entrada em vigor das alterações implica aceitação.</li>
              <li><strong>Comunicações:</strong> Todas as comunicações entre as partes serão realizadas por e-mail ou por notificação dentro do próprio Sistema, consideradas válidas e suficientes para todos os fins legais.</li>
              <li><strong>Independência das Cláusulas:</strong> A eventual invalidade ou ineficácia de qualquer cláusula destes Termos não afetará as demais, que permanecerão em pleno vigor.</li>
              <li><strong>Cessão:</strong> O Cliente não poderá ceder ou transferir seus direitos ou obrigações decorrentes deste instrumento sem prévia autorização escrita da Vacivitta.</li>
              <li><strong>Integralidade:</strong> Estes Termos, juntamente com o Aviso de Privacidade e eventuais aditivos específicos de plano, constituem o acordo integral entre as partes, substituindo qualquer negociação verbal ou escrita anterior.</li>
            </ul>
          </section>

          {/* 13 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">13. Legislação Aplicável e Foro</h2>
            <p>
              Este instrumento é regido pelas leis da República Federativa do Brasil, em especial o Código Civil (Lei n.º 10.406/2002), o Código de Defesa do Consumidor (Lei n.º 8.078/1990), a LGPD (Lei n.º 13.709/2018) e a Lei de Software (Lei n.º 9.609/1998). Fica eleito o foro da Comarca de <strong>Salto/SP</strong> para dirimir quaisquer controvérsias decorrentes deste instrumento, com renúncia expressa a qualquer outro, por mais privilegiado que seja.
            </p>
          </section>

          {/* Footer info */}
          <div className="border-t border-gray-100 pt-6 text-xs text-gray-400 space-y-1">
            <p><strong>Vacivitta Saúde Integrada LTDA</strong></p>
            <p>CNPJ: 26.915.400/0001-10</p>
            <p>Rua Benjamin Constant, 185, Centro, Salto/SP — CEP: 13320-120</p>
            <p className="mt-2">Dúvidas: <a href="mailto:contato@vacivitta.com.br" className="text-[#0098DA]">contato@vacivitta.com.br</a></p>
          </div>

        </div>

        <p className="text-center text-xs text-gray-400 mt-6 pb-4">
          © 2026 Vacivitta Saúde Integrada LTDA · <a href="/privacidade" className="text-[#0098DA]">Política de Privacidade</a>
        </p>
      </div>
    </div>
  )
}
