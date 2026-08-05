import 'dotenv/config';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import fs from 'fs';

const urlBase = 'https://siscan.saude.gov.br';

const clienteAxios = wrapper(axios.create({
    jar: new CookieJar(),
    withCredentials: true,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0',
        'Accept': '*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
    }
}));

// --- FUNÇÕES UTILITÁRIAS ---

function obterViewState(html) {
    return cheerio.load(html)('input[name="javax.faces.ViewState"]').first().val();
}

// --- MÓDULOS DA AUTOMAÇÃO ---

async function realizarLogin() {
    console.log('1. Acessando página de login...');
    const urlLogin = `${urlBase}/login.jsf`;
    const paginaLogin = await clienteAxios.get(urlLogin);
    const viewState = obterViewState(paginaLogin.data);
    
    if (!viewState) throw new Error('ViewState do login não encontrado.');

    const loginData = new URLSearchParams({
        formLogin: 'formLogin',
        email: process.env.SISCAN_EMAIL,
        senha: process.env.SISCAN_SENHA,
        j_id34: 'Acessar',
        'javax.faces.ViewState': viewState
    });

    const resposta = await clienteAxios.post(urlLogin, loginData.toString(), {
        headers: { Referer: urlLogin }
    });

    const $ = cheerio.load(resposta.data);
    if (!$('form[name="formPerfil"]').length) {
        fs.writeFileSync('erro_login_real.html', resposta.data, 'utf-8');
        throw new Error('Falha no login ou credenciais incorretas.');
    }

    return obterViewState(resposta.data);
}

async function selecionarPerfil(viewStatePerfil, perfilIndex) {
    console.log('2. Selecionando perfil de acesso...');
    const urlPerfil = `${urlBase}/visao/acesso/perfil.jsf`;
    const botaoPerfil = `j_id28:${perfilIndex}:j_id31`;
    
    const perfilData = new URLSearchParams({
        formPerfil: 'formPerfil',
        [botaoPerfil]: botaoPerfil,
        'javax.faces.ViewState': viewStatePerfil
    });
    
    await clienteAxios.post(urlPerfil, perfilData.toString(), {
        headers: { Referer: `${urlBase}/login.jsf` }
    });
}

// --- FUNÇÃO PRINCIPAL ---

export async function automatizarPesquisaLaudo() {
    if (!process.env.SISCAN_EMAIL || !process.env.SISCAN_SENHA) {
        throw new Error('SISCAN_EMAIL e SISCAN_SENHA devem estar configurados no arquivo .env.');
    }

    const config = {
        ufExame: process.env.SISCAN_UF_EXAME || '1', 
        municipioResidencia: process.env.SISCAN_MUNICIPIO_RESIDENCIA || '1', 
        perfilIndex: process.env.SISCAN_PERFIL_INDEX || '0',
        tipoExame: process.env.SISCAN_TIPO_EXAME || '02',
        prestador: process.env.SISCAN_PRESTADOR || '1',
        porData: process.env.SISCAN_POR_DATA || '01', 
        dataInicio: process.env.SISCAN_DATA_INICIO || '01/07/2026',
        mesAnoInicio: process.env.SISCAN_MES_ANO_INICIO || '07/2026',
        dataFim: process.env.SISCAN_DATA_FIM || '31/07/2026',
        mesAnoFim: process.env.SISCAN_MES_ANO_FIM || '07/2026',
        tamanhoPagina: process.env.SISCAN_TAMANHO_PAGINA || '300' 
    };
    
    const urlRelatorio = `${urlBase}/visao/exame/pesquisarLaudo.jsf`;
    
    const headersAjax = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': urlBase,
        'Referer': urlRelatorio,
        'X-Requested-With': 'XMLHttpRequest',
        'Faces-Request': 'partial/ajax',
        'Accept': '*/*'
    };

    try {
        const viewStateLogin = await realizarLogin();
        await selecionarPerfil(viewStateLogin, config.perfilIndex);

        console.log('3. Abrindo formulário de Pesquisa de Laudos...');
        const paginaBusca = await clienteAxios.get(urlRelatorio);
        let viewState = obterViewState(paginaBusca.data);
        if (!viewState) throw new Error('ViewState da tela de Laudos não encontrado.');

        const montarPayload = (campoAlvo, idControle, isAjax = true) => {
            const params = new URLSearchParams();
            
            if (isAjax) params.append('AJAXREQUEST', '_viewRoot');
            
            params.append('form', 'form');
            params.append('form:ufLaudo', config.ufExame);
            params.append('form:municipios', config.municipioResidencia);
            params.append('form:cnesUnidade', '');
            params.append('form:nomeUnidade', '');
            params.append('form:tpExame', config.tipoExame);
            params.append('form:laudoLiberado', 'true');
            params.append('form:numeroExame', '');
            params.append('form:numeroProtocolo', '');
            params.append('form:numeroProntuario', '');
            params.append('form:cartaoSUS', '');
            params.append('form:numeroCnsPaciente', '');
            params.append('form:nomePaciente', '');
            params.append('form:prestadorServico5', config.prestador);
            params.append('form:porData', config.porData);
            
            params.append('form:dataInicioInputDate', config.dataInicio);
            params.append('form:dataInicioInputCurrentDate', config.mesAnoInicio);
            params.append('form:dataFimInputDate', config.dataFim);
            params.append('form:dataFimInputCurrentDate', config.mesAnoFim);
            
            params.append('form:tamanhoPagina', config.tamanhoPagina);
            params.append('javax.faces.ViewState', viewState);

            if (isAjax && idControle) params.append(idControle, idControle);
            if (isAjax && campoAlvo) params.append('ajaxSingle', campoAlvo);

            return params;
        };

        const atualizarCampoAjax = async (campoAlvo, idControle) => {
            const formAjax = montarPayload(campoAlvo, idControle);
            const respostaAjax = await clienteAxios.post(urlRelatorio, formAjax.toString(), { headers: headersAjax });
            
            const novoViewState = obterViewState(respostaAjax.data);
            if (novoViewState) {
                viewState = novoViewState;
            } else if (respostaAjax.data.includes('errorMessage')) {
                fs.writeFileSync(`erro_ajax_${campoAlvo.replace(':', '_')}.xml`, respostaAjax.data, 'utf-8');
                const $erro = cheerio.load(respostaAjax.data);
                throw new Error(`SISCAN rejeitou a sincronização do campo '${campoAlvo}': ` + $erro('.errorMessage').text().trim());
            } else {
                throw new Error(`Falha ao sincronizar campo AJAX '${campoAlvo}'.`);
            }
        };

        console.log('4. Sincronizando máquina de estados via AJAX...');
        await atualizarCampoAjax('form:tpExame', 'form:j_id81');
        await atualizarCampoAjax('form:prestadorServico5', 'form:j_id170');
        await atualizarCampoAjax('form:porData', 'form:j_id192');
        await atualizarCampoAjax('form:dataInicio');
        await atualizarCampoAjax('form:dataFim');

        console.log(`5. Executando Pesquisa de Laudos (Filtro: ${config.dataInicio} a ${config.dataFim})...`);
        const pesquisa = montarPayload();
        pesquisa.append('form:botaoPesquisarLaudo', 'form:botaoPesquisarLaudo');

        const respostaBusca = await clienteAxios.post(urlRelatorio, pesquisa.toString(), { headers: headersAjax });
        viewState = obterViewState(respostaBusca.data) || viewState;

        console.log(`6. Expandindo visualização para ${config.tamanhoPagina} resultados...`);
        const paginacao = montarPayload('form:tamanhoPagina', 'form:j_id220');
        const respostaFinal = await clienteAxios.post(urlRelatorio, paginacao.toString(), { headers: headersAjax });
        viewState = obterViewState(respostaFinal.data) || viewState;
        
        console.log('7. Coletando resultados e requisitando PDF...');
        const $tabela = cheerio.load(respostaFinal.data);
        
        const payloadPdf = montarPayload(null, null, false);
        payloadPdf.append('form:listaPesquisaLaudoPaginada:t0', 'on');

        let laudosEncontrados = 0;
        $tabela('input[type="checkbox"][name^="form:listaPesquisaLaudoPaginada:"]').each((_, el) => {
            const name = $tabela(el).attr('name');
            if (name && name !== 'form:listaPesquisaLaudoPaginada:t0') {
                payloadPdf.append(name, 'on');
                laudosEncontrados++;
            }
        });

        console.log(`   -> ${laudosEncontrados} laudos selecionados para emissão.`);

        if (laudosEncontrados === 0) {
            console.log('⚠️ Nenhum laudo encontrado no período especificado.');
            return null;
        }

        payloadPdf.append('form:j_id272', 'Gerar Relatório');

        const headersPdf = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': urlBase,
            'Referer': urlRelatorio
        };

        const respostaPdf = await clienteAxios.post(urlRelatorio, payloadPdf.toString(), { 
            headers: headersPdf,
            responseType: 'arraybuffer'
        });

        const nomeArquivo = `relatorio_laudos_${config.mesAnoInicio.replace('/', '_')}.pdf`;
        fs.writeFileSync(nomeArquivo, respostaPdf.data);

        console.log(`✅ SUCESSO! Arquivo PDF salvo como '${nomeArquivo}'.`);
        return respostaPdf.data;

    } catch (erro) {
        console.error('❌ Erro na automação do SISCAN:', erro.message || erro);
        throw erro;
    }
}

// Execução via terminal se chamado diretamente
if (process.argv[1] && process.argv[1].endsWith('integracao.js')) {
    automatizarPesquisaLaudo()
        .catch(() => {
            process.exitCode = 1;
        });
}