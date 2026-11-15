import dotenv from 'dotenv';

const executandoEmTeste =
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.execArgv.includes('--test') ||
    process.argv.some((arg) => arg.endsWith('.test.js'));

if (!executandoEmTeste) {
    dotenv.config();
}

const URL_PADRAO_PEC = 'https://esus.vca.ba.wmsaude.com.br/gestaoCadastros/cadastro-individual';

export const GRAPHQL_MUTATION_LOGIN = `
mutation Login($input: LoginInput!) {
  login(input: $input) {
    success
  }
}
`;

export const GRAPHQL_MUTATION_LOGOUT = `
mutation Logout {
  logout {
    id
  }
}
`;

export const GRAPHQL_QUERY_SESSAO = `
query Sessao {
  sessao {
    id
    acesso {
      id
      tipo
    }
    profissional {
      id
      nome
      cpf
      acessos {
        id
        tipo
        __typename
        ... on Lotacao {
          unidadeSaude {
            id
            nome
            cnes
          }
          equipe {
            id
            nome
            ine
          }
        }
      }
    }
  }
}
`;

export const GRAPHQL_MUTATION_SELECIONAR_ACESSO = `
mutation SelecionarAcesso($input: SelecionarAcessoInput!) {
  selecionarAcesso(input: $input) {
    id
    profissional {
      id
      nome
    }
    acesso {
      id
      moduloInicial
    }
    recursos
  }
}
`;

export const GRAPHQL_QUERY_CIDADAO_LISTING = `
query CidadaoListing($filtro: CidadaosQueryInput!) {
  cidadaos(input: $filtro) {
    content {
      id
      nome
      nomeSocial
      cpf
      cns
      nomeMae
      dataNascimento
      telefoneCelular
      telefoneResidencial
      ativo
      faleceu
    }
  }
}
`;

export const GRAPHQL_QUERY_CIDADAO_VISUALIZACAO = `
query CidadaoVisualizacao($id: ID!) {
  cidadao(id: $id) {
    id
    cpf
    cns
    nome
    nomeSocial
    dataNascimento
    telefoneResidencial
    telefoneCelular
    telefoneContato
    email
    endereco {
      bairro
      cep
      complemento
      logradouro
      municipio {
        id
        nome
      }
      numero
      pontoReferencia
      semNumero
      tipoLogradouro {
        id
        nome
      }
      uf {
        id
        nome
      }
    }
  }
}
`;

/**
 * Extrai a URL base (origin) do PEC a partir da URL configurada (ex: .../gestaoCadastros/cadastro-individual).
 */
export function extrairUrlBasePec(urlConfigurada = process.env.PEC_URL || URL_PADRAO_PEC) {
    if (!urlConfigurada || typeof urlConfigurada !== 'string') {
        return 'https://esus.vca.ba.wmsaude.com.br';
    }
    try {
        const parsed = new URL(urlConfigurada.trim());
        return parsed.origin;
    } catch {
        return 'https://esus.vca.ba.wmsaude.com.br';
    }
}

/**
 * Converte data no formato brasileiro DD/MM/YYYY para ISO YYYY-MM-DD.
 */
export function converterDataBrParaIso(dataBr) {
    if (!dataBr || typeof dataBr !== 'string') return null;
    const match = dataBr.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    const [, dia, mes, ano] = match;
    return `${ano}-${mes}-${dia}`;
}

/**
 * Normaliza texto removendo acentos e espaços extras para comparação segura de nomes.
 */
export function normalizarTextoComparacao(texto) {
    if (!texto || typeof texto !== 'string') return '';
    return texto
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Escolhe o melhor telefone disponível no cadastro do PEC (priorizando celular -> contato -> residencial).
 */
export function escolherMelhorTelefonePec(cidadaoPec, telefoneFallback = '') {
    if (!cidadaoPec || typeof cidadaoPec !== 'object') return telefoneFallback;

    const candidatos = [
        cidadaoPec.telefoneCelular,
        cidadaoPec.telefoneContato,
        cidadaoPec.telefoneResidencial
    ];

    for (const tel of candidatos) {
        if (tel && typeof tel === 'string') {
            const digitos = tel.replace(/\D/g, '');
            if (digitos.length >= 8) {
                return digitos;
            }
        }
    }

    return telefoneFallback;
}

/**
 * Formata o objeto de endereço retornado pelo PEC em uma string legível para a equipe da USF.
 */
export function formatarEnderecoPec(enderecoObj, enderecoFallback = '') {
    if (!enderecoObj || typeof enderecoObj !== 'object') return enderecoFallback;

    const tipoLogradouro = enderecoObj.tipoLogradouro?.nome?.trim() || '';
    const logradouro = enderecoObj.logradouro?.trim() || '';
    const bairro = enderecoObj.bairro?.trim() || '';
    const municipio = enderecoObj.municipio?.nome?.trim() || '';
    const complemento = enderecoObj.complemento?.trim() || '';
    const cep = enderecoObj.cep?.trim() || '';

    if (!logradouro && !bairro) return enderecoFallback;

    let via = [tipoLogradouro, logradouro].filter(Boolean).join(' ').trim();
    if (via) {
        if (enderecoObj.numero && String(enderecoObj.numero).trim()) {
            via += `, Nº ${String(enderecoObj.numero).trim()}`;
        } else if (enderecoObj.semNumero) {
            via += ', S/N';
        }
    }

    const partes = [];
    if (via) partes.push(via);
    if (complemento) partes.push(complemento);
    if (bairro) partes.push(`Bairro: ${bairro}`);
    if (municipio) partes.push(municipio);
    if (cep) partes.push(`CEP: ${cep}`);

    return partes.join(' - ') || enderecoFallback;
}

/**
 * Seleciona o registro de cidadão mais compatível a partir da listagem retornada pelo PEC.
 */
export function selecionarMelhorCidadao(listaCidadaos, { cpfCns, nome, nascimento } = {}) {
    if (!Array.isArray(listaCidadaos) || listaCidadaos.length === 0) return null;

    const docBusca = (cpfCns || '').replace(/\D/g, '');
    const nomeBusca = normalizarTextoComparacao(nome);
    const dataIsoBusca = converterDataBrParaIso(nascimento) || nascimento || '';

    // Filtra prioritariamente cadastros ativos e não falecidos, mantendo todos caso nenhum ativo exista
    const ativos = listaCidadaos.filter((c) => c && c.ativo !== false && !c.faleceu);
    const pool = ativos.length > 0 ? ativos : listaCidadaos.filter(Boolean);

    // 1. Match exato por CPF ou CNS
    if (docBusca) {
        const porDoc = pool.find((c) => {
            const cpfCand = (c.cpf || '').replace(/\D/g, '');
            const cnsCand = (c.cns || '').replace(/\D/g, '');
            return (cpfCand && cpfCand === docBusca) || (cnsCand && cnsCand === docBusca);
        });
        if (porDoc) return porDoc;
    }

    // 2. Match exato por Nome + Data de Nascimento
    if (nomeBusca && dataIsoBusca) {
        const porNomeEData = pool.find((c) => {
            const nomeCand = normalizarTextoComparacao(c.nome);
            const dataCand = (c.dataNascimento || '').trim();
            return nomeCand === nomeBusca && (dataCand === dataIsoBusca || dataCand === nascimento);
        });
        if (porNomeEData) return porNomeEData;
    }

    // 3. Match exato por Nome
    if (nomeBusca) {
        const porNome = pool.find((c) => normalizarTextoComparacao(c.nome) === nomeBusca);
        if (porNome) return porNome;
    }

    return pool[0] || null;
}

/**
 * Cria um cliente HTTP/GraphQL com gerenciamento automático de cookies (SESSION/JSESSIONID) e XSRF-TOKEN do PEC.
 */
export function criarClientePec({
    baseUrl = extrairUrlBasePec(),
    fetchImpl = globalThis.fetch
} = {}) {
    const cookies = new Map();

    function atualizarCookies(res) {
        let rawCookies = [];
        if (typeof res.headers?.getSetCookie === 'function') {
            rawCookies = res.headers.getSetCookie();
        } else if (res.headers?.get('set-cookie')) {
            rawCookies = [res.headers.get('set-cookie')];
        }

        for (const c of rawCookies) {
            const [pair] = c.split(';');
            const eqIdx = pair.indexOf('=');
            if (eqIdx > 0) {
                const k = pair.slice(0, eqIdx).trim();
                const v = pair.slice(eqIdx + 1).trim();
                cookies.set(k, v);
            }
        }
    }

    function obterCookieHeader() {
        return Array.from(cookies.entries())
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
    }

    async function iniciarSessao() {
        const res = await fetchImpl(`${baseUrl}/`, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        atualizarCookies(res);
        return res;
    }

    async function executarGraphQL(query, variables = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'Api-Consumer-Id': 'ESUS_WEB_CLIENT',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
        };

        const cookieStr = obterCookieHeader();
        if (cookieStr) {
            headers['Cookie'] = cookieStr;
        }

        const xsrfToken = cookies.get('XSRF-TOKEN');
        if (xsrfToken) {
            headers['X-XSRF-TOKEN'] = xsrfToken;
        }

        const res = await fetchImpl(`${baseUrl}/api/graphql`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query, variables })
        });

        atualizarCookies(res);

        if (!res.ok) {
            throw new Error(`Falha HTTP ${res.status} ao comunicar com o PEC (${baseUrl}/api/graphql)`);
        }

        return await res.json();
    }

    async function autenticar(usuario, senha, lotacaoPreferida = process.env.PEC_LOTACAO_ID || process.env.PEC_CNES || '') {
        if (!usuario || !senha) {
            throw new Error('Credenciais do PEC (PEC_USUARIO e PEC_SENHA) não informadas.');
        }

        await iniciarSessao();

        const usernameLimpo = String(usuario).replace(/[.-]/g, '').trim();
        let respostaLogin = await executarGraphQL(GRAPHQL_MUTATION_LOGIN, {
            input: {
                username: usernameLimpo,
                password: String(senha)
            }
        });

        // Se o usuário já estiver logado em outra sessão no PEC, força a entrada igual ao botão "Continuar" da interface web
        if (Array.isArray(respostaLogin.errors) && respostaLogin.errors.length > 0) {
            const classificacao = respostaLogin.errors[0]?.extensions?.classification;
            if (classificacao === 'UsuarioJaLogadoException' || classificacao === 'PecAuthenticationException') {
                respostaLogin = await executarGraphQL(GRAPHQL_MUTATION_LOGIN, {
                    input: {
                        username: usernameLimpo,
                        password: String(senha),
                        force: true
                    }
                });
            }
        }

        if (Array.isArray(respostaLogin.errors) && respostaLogin.errors.length > 0) {
            throw new Error(`Erro de autenticação no PEC: ${respostaLogin.errors[0].message || 'Credenciais inválidas'}`);
        }

        if (!respostaLogin.data?.login?.success) {
            throw new Error('Não foi possível autenticar no PEC. Verifique o CPF (PEC_USUARIO) e a senha (PEC_SENHA).');
        }

        // Verifica a sessão atual e seleciona a lotação/acesso caso ainda não esteja selecionado
        const respostaSessao = await executarGraphQL(GRAPHQL_QUERY_SESSAO);
        const sessao = respostaSessao.data?.sessao;

        if (sessao && !sessao.acesso && Array.isArray(sessao.profissional?.acessos) && sessao.profissional.acessos.length > 0) {
            const acessos = sessao.profissional.acessos;
            const pref = String(lotacaoPreferida || '').trim().toLowerCase();

            let acessoEscolhido = null;
            if (pref) {
                acessoEscolhido = acessos.find(
                    (a) =>
                        String(a.id).toLowerCase() === pref ||
                        String(a.unidadeSaude?.cnes || '').toLowerCase() === pref ||
                        String(a.unidadeSaude?.nome || '').toLowerCase().includes(pref)
                );
            }
            if (!acessoEscolhido) {
                acessoEscolhido = acessos.find((a) => a.__typename === 'Lotacao' || a.tipo === 'LOTACAO') || acessos[0];
            }

            if (acessoEscolhido?.id) {
                await executarGraphQL(GRAPHQL_MUTATION_SELECIONAR_ACESSO, {
                    input: { id: acessoEscolhido.id }
                });
            }
        }

        return sessao;
    }

    async function buscarContatoPaciente(paciente) {
        const docLimpo = String(paciente.cpf || '').replace(/\D/g, '');
        const nomeLimpo = String(paciente.nome || '').trim().toUpperCase();
        const nascimentoStr = String(paciente.nascimento || '').trim();

        let candidatos = [];

        // 1. Tenta buscar pelo CNS ou CPF no Cadastro Individual
        if (docLimpo.length === 11 || docLimpo.length === 15) {
            const resPorDoc = await executarGraphQL(GRAPHQL_QUERY_CIDADAO_LISTING, {
                filtro: {
                    pageParams: { size: 51, fetchPageInfo: false },
                    query: docLimpo,
                    dataNascimento: null,
                    nomeMae: null,
                    municipioNascimento: null,
                    cidadaoAldeado: null,
                    ativo: null,
                    obito: null
                }
            });
            candidatos = resPorDoc.data?.cidadaos?.content || [];
        }

        // 2. Se não encontrou por documento, tenta buscar pelo Nome Completo (+ Data de Nascimento se disponível)
        if (candidatos.length === 0 && nomeLimpo) {
            const dataIso = converterDataBrParaIso(nascimentoStr);
            const resPorNome = await executarGraphQL(GRAPHQL_QUERY_CIDADAO_LISTING, {
                filtro: {
                    pageParams: { size: 51, fetchPageInfo: false },
                    query: nomeLimpo,
                    dataNascimento: dataIso,
                    nomeMae: null,
                    municipioNascimento: null,
                    cidadaoAldeado: null,
                    ativo: null,
                    obito: null
                }
            });
            candidatos = resPorNome.data?.cidadaos?.content || [];
        }

        const melhorCandidato = selecionarMelhorCidadao(candidatos, {
            cpfCns: docLimpo,
            nome: nomeLimpo,
            nascimento: nascimentoStr
        });

        if (!melhorCandidato?.id) {
            return { encontrado: false };
        }

        // 3. Consulta a visualização completa do Cadastro Individual (/gestaoCadastros/cadastro-individual/:id/informacoes)
        const resDetalhes = await executarGraphQL(GRAPHQL_QUERY_CIDADAO_VISUALIZACAO, {
            id: melhorCandidato.id
        });

        const cidadaoCompleto = resDetalhes.data?.cidadao || melhorCandidato;
        const telefoneAtualizado = escolherMelhorTelefonePec(cidadaoCompleto, '');
        const enderecoAtualizado = formatarEnderecoPec(cidadaoCompleto.endereco, '');

        return {
            encontrado: true,
            idPec: cidadaoCompleto.id,
            telefone: telefoneAtualizado,
            endereco: enderecoAtualizado,
            cpf: cidadaoCompleto.cpf || melhorCandidato.cpf || '',
            cns: cidadaoCompleto.cns || melhorCandidato.cns || '',
            dadosBrutos: cidadaoCompleto
        };
    }

    async function encerrarSessao() {
        try {
            await executarGraphQL(GRAPHQL_MUTATION_LOGOUT);
        } catch {
            // Ignora erros caso a sessão já tenha sido encerrada
        }
    }

    return {
        cookies,
        iniciarSessao,
        executarGraphQL,
        autenticar,
        buscarContatoPaciente,
        encerrarSessao
    };
}

/**
 * Enriquecimento em lote de pacientes com os dados de contato (telefone e endereço) do PEC do município.
 * Aceita pacientes no formato extraído do laudo (`{ nome, cpf, nascimento, telefone, endereco }`)
 * ou pacientes já cadastrados (`{ nome, cpf, nascimento, numero, endereco }`).
 */
export async function enriquecerPacientesComPec(
    listaPacientes,
    {
        usuario = process.env.PEC_USUARIO,
        senha = process.env.PEC_SENHA,
        baseUrl = extrairUrlBasePec(),
        lotacaoPreferida = process.env.PEC_LOTACAO_ID || process.env.PEC_CNES || '',
        fetchImpl = globalThis.fetch,
        clientePec = null,
        exigirCredenciais = false
    } = {}
) {
    if (!Array.isArray(listaPacientes) || listaPacientes.length === 0) {
        return { pacientes: [], totalAnalisados: 0, totalAtualizados: 0 };
    }

    if (!clientePec && (!usuario || !senha)) {
        if (exigirCredenciais) {
            throw new Error('Configure PEC_USUARIO (CPF) e PEC_SENHA no arquivo .env para consultar o PEC do município.');
        }
        console.log('[PEC] Credenciais PEC_USUARIO/PEC_SENHA não configuradas no .env. Mantendo contatos originais do SISCAN.');
        return {
            pacientes: listaPacientes,
            totalAnalisados: listaPacientes.length,
            totalAtualizados: 0
        };
    }

    const cliente = clientePec || criarClientePec({ baseUrl, fetchImpl });
    if (!clientePec) {
        await cliente.autenticar(usuario, senha, lotacaoPreferida);
    }

    let totalAtualizados = 0;
    const pacientesEnriquecidos = [];

    try {
        for (const p of listaPacientes) {
            try {
                const resultadoPec = await cliente.buscarContatoPaciente(p);
                if (resultadoPec.encontrado) {
                    const novoPaciente = { ...p };
                    let alterou = false;

                    if (resultadoPec.telefone) {
                        if ('telefone' in novoPaciente) {
                            novoPaciente.telefone = resultadoPec.telefone;
                        }
                        if ('numero' in novoPaciente) {
                            novoPaciente.numero = resultadoPec.telefone;
                        }
                        alterou = true;
                    }

                    if (resultadoPec.endereco) {
                        novoPaciente.endereco = resultadoPec.endereco;
                        alterou = true;
                    }

                    if (alterou) {
                        totalAtualizados++;
                    }
                    pacientesEnriquecidos.push(novoPaciente);
                } else {
                    pacientesEnriquecidos.push({ ...p });
                }
            } catch (err) {
                console.error(`[PEC] Erro ao consultar paciente ${p.nome || p.id}:`, err.message);
                pacientesEnriquecidos.push({ ...p });
            }
        }
    } finally {
        if (typeof cliente.encerrarSessao === 'function') {
            await cliente.encerrarSessao();
        }
    }

    return {
        pacientes: pacientesEnriquecidos,
        totalAnalisados: listaPacientes.length,
        totalAtualizados
    };
}
