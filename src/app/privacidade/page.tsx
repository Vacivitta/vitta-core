import type { Metadata } from 'next'

export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'Aviso de Privacidade — VittaDesk',
  description: 'Aviso de Privacidade do sistema VittaDesk, da Vacivitta Saúde Integrada LTDA. Saiba como tratamos seus dados pessoais.',
}

export default function PrivacidadePage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-6">
          <div className="h-1.5 bg-[#0098DA]" />
          <div className="px-8 py-6">
            <p className="text-xs font-semibold text-[#0098DA] uppercase tracking-widest mb-1">Vacivitta Saúde Integrada LTDA</p>
            <h1 className="text-2xl font-bold text-gray-900 leading-tight">
              Aviso de Privacidade
            </h1>
            <p className="text-sm text-gray-500 mt-2">
              Sistema VittaDesk &nbsp;·&nbsp; Versão 1.0 &nbsp;·&nbsp; Publicado em 19/06/2026
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="bg-white rounded-2xl shadow-sm px-8 py-8 space-y-8 text-gray-700 text-sm leading-relaxed">

          {/* Intro */}
          <section>
            <p>
              A <strong>Vacivitta Saúde Integrada LTDA</strong> (&ldquo;Vacivitta&rdquo;, &ldquo;nós&rdquo; ou &ldquo;nosso&rdquo;) é a desenvolvedora e operadora do sistema <strong>VittaDesk</strong>, plataforma de CRM comercial voltada para clínicas e empresas de saúde. Este Aviso de Privacidade descreve como coletamos, utilizamos, compartilhamos e protegemos dados pessoais no contexto da prestação de nossos serviços, em conformidade com a <strong>Lei Geral de Proteção de Dados Pessoais (LGPD — Lei n.º 13.709/2018)</strong> e demais normas aplicáveis.
            </p>
            <p className="mt-2">
              Ao utilizar o VittaDesk, você confirma que leu e compreendeu este Aviso. Caso não concorde com os termos aqui descritos, não utilize o Sistema.
            </p>
          </section>

          {/* 1 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">1. Identificação do Controlador</h2>
            <div className="bg-gray-50 rounded-xl p-4 space-y-1 text-sm">
              <p><strong>Razão Social:</strong> Vacivitta Saúde Integrada LTDA</p>
              <p><strong>CNPJ:</strong> 26.915.400/0001-10</p>
              <p><strong>Endereço:</strong> Rua Benjamin Constant, 185, Centro, Salto/SP — CEP: 13320-120</p>
              <p><strong>E-mail para assuntos de privacidade:</strong> <a href="mailto:contato@vacivitta.com.br" className="text-[#0098DA]">contato@vacivitta.com.br</a></p>
            </div>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">2. Definições</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Dado Pessoal:</strong> Informação relacionada a pessoa natural identificada ou identificável (art. 5.º, I, LGPD).</li>
              <li><strong>Dado Sensível:</strong> Dado sobre origem racial/étnica, convicção religiosa, opinião política, saúde, vida sexual, dado genético ou biométrico (art. 5.º, II, LGPD).</li>
              <li><strong>Titular:</strong> Pessoa natural a quem os dados pessoais se referem.</li>
              <li><strong>Controlador:</strong> Pessoa natural ou jurídica que toma as decisões sobre o tratamento dos dados pessoais.</li>
              <li><strong>Operador:</strong> Pessoa natural ou jurídica que realiza o tratamento de dados pessoais em nome do Controlador.</li>
              <li><strong>Tratamento:</strong> Toda operação realizada com dados pessoais (coleta, produção, recepção, classificação, utilização, acesso, reprodução, transmissão, distribuição, processamento, arquivamento, armazenamento, eliminação, avaliação, controle, modificação, comunicação, transferência, difusão ou extração).</li>
              <li><strong>Cliente:</strong> Pessoa jurídica ou física que contrata o acesso ao Sistema VittaDesk.</li>
              <li><strong>Usuário:</strong> Pessoa autorizada pelo Cliente a acessar e utilizar o Sistema.</li>
            </ul>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">3. Âmbito de Aplicação</h2>
            <p className="mb-2">Este Aviso aplica-se ao tratamento de dados realizado pela Vacivitta nas seguintes situações:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Visitantes do site institucional</strong> da Vacivitta ou do VittaDesk;</li>
              <li><strong>Clientes</strong> que contratam o acesso ao Sistema VittaDesk;</li>
              <li><strong>Usuários</strong> designados pelo Cliente para operar o Sistema.</li>
            </ul>
            <p className="mt-2">
              <strong>Dados de pacientes/clientes finais dos Clientes:</strong> Ao inserir dados de seus próprios pacientes ou clientes no Sistema, o Cliente atua como <strong>Controlador</strong> desses dados, e a Vacivitta atua como <strong>Operadora</strong>. Nesses casos, este Aviso não substitui a política de privacidade do Cliente perante seus pacientes/clientes, que é de responsabilidade exclusiva do Cliente.
            </p>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">4. Dados Coletados e Fontes</h2>

            <h3 className="font-semibold text-gray-800 mb-2">4.1 Dados fornecidos diretamente pelo Cliente/Usuário</h3>
            <ul className="list-disc pl-5 space-y-1 mb-4">
              <li>Nome completo e dados de identificação (CPF, CNPJ);</li>
              <li>Endereço de e-mail e número de telefone;</li>
              <li>Dados da empresa (razão social, endereço, ramo de atividade);</li>
              <li>Credenciais de acesso (e-mail e senha, armazenada em formato hash);</li>
              <li>Foto de perfil, caso enviada voluntariamente.</li>
            </ul>

            <h3 className="font-semibold text-gray-800 mb-2">4.2 Dados coletados automaticamente durante o uso do Sistema</h3>
            <ul className="list-disc pl-5 space-y-1 mb-4">
              <li>Endereço IP e informações do dispositivo/navegador;</li>
              <li>Registros de acesso (logs) com data, hora e ações realizadas;</li>
              <li>Dados de sessão e tokens de autenticação;</li>
              <li>Informações de uso e navegação dentro do Sistema (páginas acessadas, funcionalidades utilizadas).</li>
            </ul>

            <h3 className="font-semibold text-gray-800 mb-2">4.3 Dados inseridos pelo Cliente no Sistema (como Operadora)</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Cadastros de leads e clientes (nome, telefone, e-mail, data de nascimento, entre outros);</li>
              <li>Histórico de atendimento, anotações e tarefas;</li>
              <li>Orçamentos, produtos e valores negociados;</li>
              <li>Mensagens trocadas via integração com WhatsApp.</li>
            </ul>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">5. Finalidades e Bases Legais do Tratamento</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border border-gray-100 rounded-xl overflow-hidden">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 w-2/5">Finalidade</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 w-3/5">Base Legal (LGPD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  <tr>
                    <td className="px-4 py-3">Criação e gestão da conta do Cliente no Sistema</td>
                    <td className="px-4 py-3">Execução de contrato (art. 7.º, V)</td>
                  </tr>
                  <tr className="bg-gray-50/50">
                    <td className="px-4 py-3">Faturamento, cobrança e controle de assinaturas</td>
                    <td className="px-4 py-3">Execução de contrato (art. 7.º, V)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3">Prestação de suporte técnico</td>
                    <td className="px-4 py-3">Execução de contrato (art. 7.º, V)</td>
                  </tr>
                  <tr className="bg-gray-50/50">
                    <td className="px-4 py-3">Comunicações operacionais (atualizações, manutenções)</td>
                    <td className="px-4 py-3">Legítimo interesse / Execução de contrato (art. 7.º, V e IX)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3">Segurança do Sistema, prevenção a fraudes e acesso não autorizado</td>
                    <td className="px-4 py-3">Legítimo interesse / Obrigação legal (art. 7.º, VI e IX)</td>
                  </tr>
                  <tr className="bg-gray-50/50">
                    <td className="px-4 py-3">Cumprimento de obrigações legais e regulatórias</td>
                    <td className="px-4 py-3">Obrigação legal (art. 7.º, II)</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3">Melhoria e desenvolvimento de novas funcionalidades (dados anonimizados)</td>
                    <td className="px-4 py-3">Legítimo interesse (art. 7.º, IX)</td>
                  </tr>
                  <tr className="bg-gray-50/50">
                    <td className="px-4 py-3">Envio de comunicações de marketing sobre novidades do VittaDesk</td>
                    <td className="px-4 py-3">Consentimento (art. 7.º, I) — revogável a qualquer tempo</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">6. Compartilhamento de Dados</h2>
            <p className="mb-2">
              A Vacivitta não vende dados pessoais. O compartilhamento ocorre apenas nas situações abaixo:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Fornecedores de infraestrutura e tecnologia (Operadores):</strong> Provedores de hospedagem em nuvem, serviços de banco de dados e autenticação (ex.: Supabase/AWS), que tratam os dados exclusivamente por instrução da Vacivitta e sob contrato de confidencialidade;</li>
              <li><strong>Plataformas de pagamento:</strong> Intermediadores de pagamento utilizados para processamento das assinaturas, que atuam como Controladores independentes quanto aos dados financeiros;</li>
              <li><strong>Meta / WhatsApp Business API:</strong> Na hipótese de integração com a API Oficial do WhatsApp, dados de mensagens podem transitar pelos servidores da Meta, conforme os Termos de Uso e a Política de Privacidade da própria Meta. A Vacivitta não controla esse tratamento;</li>
              <li><strong>Autoridades e órgãos públicos:</strong> Quando exigido por lei, regulamento, ordem judicial ou outra obrigação legal.</li>
            </ul>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">7. Armazenamento e Segurança</h2>
            <p className="mb-2">
              Os dados tratados pela Vacivitta são armazenados em servidores em nuvem com certificação de segurança, localizados no Brasil ou em países que ofereçam grau de proteção adequado nos termos do art. 33 da LGPD.
            </p>
            <p className="mb-2">A Vacivitta adota medidas técnicas e organizacionais para proteger os dados pessoais, incluindo:</p>
            <ul className="list-disc pl-5 space-y-1 mb-2">
              <li>Criptografia em trânsito (TLS/HTTPS) e em repouso;</li>
              <li>Controle de acesso baseado em funções (RBAC), com autenticação segura;</li>
              <li>Monitoramento de acessos e logs de auditoria;</li>
              <li>Backups automáticos periódicos;</li>
              <li>Políticas internas de segurança da informação.</li>
            </ul>
            <p>
              Embora adotemos medidas robustas de segurança, nenhum sistema é absolutamente imune a incidentes. Em caso de violação que possa acarretar risco ou dano relevante aos Titulares, a Vacivitta notificará a Autoridade Nacional de Proteção de Dados (ANPD) e os afetados nos prazos previstos na LGPD.
            </p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">8. Retenção e Exclusão de Dados</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Durante a vigência da assinatura:</strong> Os dados são retidos para a plena prestação do serviço;</li>
              <li><strong>Após o encerramento da conta:</strong> Os dados do Cliente são mantidos por até 30 (trinta) dias para eventual recuperação, após o que são excluídos de nossos ambientes de produção, salvo obrigação legal de retenção;</li>
              <li><strong>Obrigações legais:</strong> Dados necessários ao cumprimento de obrigações fiscais, contábeis ou legais podem ser retidos pelos prazos determinados pela legislação aplicável (ex.: 5 anos para dados fiscais);</li>
              <li><strong>Dados anonimizados:</strong> Estatísticas e métricas de uso sem identificação pessoal podem ser retidas indefinidamente para fins de melhoria do Sistema.</li>
            </ul>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">9. Cookies e Tecnologias de Rastreamento</h2>
            <p className="mb-2">
              O Sistema VittaDesk utiliza cookies e tecnologias similares para garantir o funcionamento correto da plataforma:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Cookies essenciais/de sessão:</strong> Necessários para autenticação, manutenção de sessão e segurança. Não podem ser desativados sem comprometer o funcionamento do Sistema;</li>
              <li><strong>Cookies de preferência:</strong> Armazenam configurações escolhidas pelo Usuário (ex.: tema, idioma, preferências de interface);</li>
              <li><strong>Cookies analíticos:</strong> Utilizados para mensurar o uso do Sistema e identificar melhorias, com dados anonimizados sempre que possível.</li>
            </ul>
            <p className="mt-2">
              O Usuário pode gerenciar ou bloquear cookies diretamente nas configurações do navegador, com a ressalva de que a desativação de cookies essenciais impede o acesso ao Sistema.
            </p>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">10. Direitos do Titular</h2>
            <p className="mb-2">
              Nos termos do art. 18 da LGPD, o Titular dos dados tem os seguintes direitos em relação a seus dados pessoais tratados pela Vacivitta:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Confirmação e acesso:</strong> Confirmar se tratamos seus dados e obter cópia dos dados que possuímos;</li>
              <li><strong>Correção:</strong> Solicitar a correção de dados incompletos, inexatos ou desatualizados;</li>
              <li><strong>Anonimização, bloqueio ou eliminação:</strong> Solicitar a anonimização, bloqueio ou exclusão de dados desnecessários, excessivos ou tratados em desconformidade com a LGPD;</li>
              <li><strong>Portabilidade:</strong> Solicitar a portabilidade dos dados a outro fornecedor de serviço ou produto, em formato estruturado e interoperável;</li>
              <li><strong>Eliminação:</strong> Solicitar a exclusão dos dados tratados com base no consentimento, observados os prazos legais de retenção;</li>
              <li><strong>Informação sobre compartilhamento:</strong> Obter informações sobre com quais entidades compartilhamos seus dados;</li>
              <li><strong>Revogação do consentimento:</strong> Revogar consentimentos anteriormente concedidos, a qualquer momento;</li>
              <li><strong>Oposição:</strong> Opor-se ao tratamento realizado com base em outras hipóteses legais, em caso de descumprimento da LGPD.</li>
            </ul>
            <p className="mt-2">
              Para exercer qualquer desses direitos, entre em contato pelo e-mail <a href="mailto:contato@vacivitta.com.br" className="text-[#0098DA] underline">contato@vacivitta.com.br</a>. Responderemos em até 15 (quinze) dias úteis, podendo ser necessária verificação de identidade.
            </p>
            <p className="mt-2">
              Caso não esteja satisfeito com nossa resposta, o Titular pode apresentar reclamação à <strong>Autoridade Nacional de Proteção de Dados (ANPD)</strong>, por meio dos canais oficiais disponíveis em <a href="https://www.gov.br/anpd" className="text-[#0098DA] underline" target="_blank" rel="noopener noreferrer">www.gov.br/anpd</a>.
            </p>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">11. Transferências Internacionais de Dados</h2>
            <p className="mb-2">
              Alguns de nossos provedores de serviços e infraestrutura podem estar localizados fora do Brasil. Quando realizamos transferências internacionais de dados pessoais, adotamos as salvaguardas previstas no art. 33 da LGPD:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Transferência para países que a ANPD reconheça como possuidores de proteção adequada;</li>
              <li>Transferência amparada por cláusulas contratuais padrão aprovadas pela ANPD;</li>
              <li>Transferência necessária para a execução do contrato de prestação do serviço ao titular.</li>
            </ul>
          </section>

          {/* 12 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">12. Menores de Idade</h2>
            <p>
              O Sistema VittaDesk é destinado a empresas e profissionais, sendo voltado exclusivamente para uso por pessoas maiores de 18 (dezoito) anos. Não coletamos intencionalmente dados pessoais de menores de idade como usuários da plataforma. Caso um usuário menor de idade seja identificado, sua conta poderá ser suspensa e os dados excluídos.
            </p>
            <p className="mt-2">
              No contexto de dados inseridos pelo Cliente no Sistema (ex.: cadastro de pacientes pediátricos), o Cliente é o responsável pelo cumprimento das normas de proteção aplicáveis a dados de crianças e adolescentes.
            </p>
          </section>

          {/* 13 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">13. Alterações neste Aviso</h2>
            <p>
              Este Aviso de Privacidade pode ser atualizado periodicamente para refletir mudanças em nossas práticas, no Sistema ou na legislação aplicável. Notificaremos os Clientes ativos sobre alterações relevantes por e-mail ou notificação dentro do Sistema com antecedência mínima de 15 (quinze) dias. A versão mais recente estará sempre disponível em <a href="/privacidade" className="text-[#0098DA]">/privacidade</a>.
            </p>
          </section>

          {/* 14 */}
          <section>
            <h2 className="text-base font-bold text-gray-900 mb-3">14. Contato e Encarregado de Dados (DPO)</h2>
            <p className="mb-2">
              Para exercer seus direitos, esclarecer dúvidas ou registrar reclamações relacionadas ao tratamento de dados pessoais, entre em contato com nossa equipe responsável pela privacidade:
            </p>
            <div className="bg-gray-50 rounded-xl p-4 space-y-1 text-sm">
              <p><strong>E-mail:</strong> <a href="mailto:contato@vacivitta.com.br" className="text-[#0098DA]">contato@vacivitta.com.br</a></p>
              <p><strong>Endereço:</strong> Rua Benjamin Constant, 185, Centro, Salto/SP — CEP: 13320-120</p>
              <p><strong>Horário de atendimento:</strong> Segunda a sexta-feira, das 8h às 18h (horário de Brasília)</p>
            </div>
          </section>

          {/* Footer info */}
          <div className="border-t border-gray-100 pt-6 text-xs text-gray-400 space-y-1">
            <p><strong>Vacivitta Saúde Integrada LTDA</strong></p>
            <p>CNPJ: 26.915.400/0001-10</p>
            <p>Rua Benjamin Constant, 185, Centro, Salto/SP — CEP: 13320-120</p>
          </div>

        </div>

        <p className="text-center text-xs text-gray-400 mt-6 pb-4">
          © 2026 Vacivitta Saúde Integrada LTDA · <a href="/termos" className="text-[#0098DA]">Termos de Uso</a>
        </p>
      </div>
    </div>
  )
}
