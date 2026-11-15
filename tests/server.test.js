import test, { describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { obterCaminhoOuGerarPdfTeste } from './pdf_fixture_helper.js';
import {
    app,
    criptografar,
    descriptografar,
    descriptografarPaciente,
    classificarPrioridadeClinica,
    calcularEstatisticasPacientes,
    converterDataBrParaTimestamp,
    ordenarPacientes,
    compararSenhasSeguro,
    mascararDadoSensivel,
    limparTentativasLogin,
    dispararMensagemPaciente,
    processarMensagemRecebida,
    executarFluxoCompletoSemanal,
    atualizarContatosPacientesPec,
    aguardandoConfirmacao,
    obterPacientes,
    definirPacientes,
    definirArquivoPacientes,
    definirSocketWhatsApp,
    definirFluxoSemanal,
    definirSincronizadorPec,
    obterStatusEnviosWhatsApp,
    definirStatusEnviosWhatsApp,
    deduplicarPacientes,
    gerarSvgQrCode,
    definirQrCodeWhatsApp
} from '../server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

describe('Módulo Principal do Servidor, Criptografia LGPD, Rotas e WhatsApp (server.js)', () => {
    let servidorHttp;
    let urlBase;
    let arquivoTempPacientes;
    let tokenValido;

    before(async () => {
        arquivoTempPacientes = path.join(os.tmpdir(), `pacientes_test_${Date.now()}.json`);
        definirArquivoPacientes(arquivoTempPacientes);
        definirPacientes([]);

        await new Promise((resolve) => {
            servidorHttp = app.listen(0, '127.0.0.1', () => {
                const { port } = servidorHttp.address();
                urlBase = `http://127.0.0.1:${port}`;
                resolve();
            });
        });

        tokenValido = jwt.sign({ autorizado: true }, process.env.SENHA_PAINEL, { expiresIn: '5m' });
    });

    after(async () => {
        if (servidorHttp) {
            await new Promise((resolve) => servidorHttp.close(resolve));
        }
        if (arquivoTempPacientes && fs.existsSync(arquivoTempPacientes)) {
            fs.unlinkSync(arquivoTempPacientes);
        }
    });

    beforeEach(() => {
        definirPacientes([]);
        aguardandoConfirmacao.clear();
        limparTentativasLogin();
        definirSocketWhatsApp(null);
        definirStatusEnviosWhatsApp(true);
        definirFluxoSemanal(null);
        definirSincronizadorPec(null);
    });

    describe('Criptografia e Descriptografia AES-256-CBC (Conformidade LGPD)', () => {
        test('criptografar() deve gerar hash hexadecimal com IV aleatório e descriptografar() deve reverter ao original', () => {
            const textoOriginal = 'Maria José da Conceição - (77) 98888-7777';
            const cifrado1 = criptografar(textoOriginal);
            const cifrado2 = criptografar(textoOriginal);

            assert.match(cifrado1, /^[a-f0-9]{32}:[a-f0-9]+$/);
            assert.notEqual(cifrado1, cifrado2);
            assert.equal(descriptografar(cifrado1), textoOriginal);
            assert.equal(descriptografar(cifrado2), textoOriginal);
        });

        test('criptografar() e descriptografar() devem tratar valores vazios ou textos legados sem quebrar', () => {
            assert.equal(criptografar(''), '');
            assert.equal(criptografar(null), '');
            assert.equal(descriptografar(''), '');
            assert.equal(descriptografar(null), '');
            assert.equal(descriptografar('Texto Legado Puro'), 'Texto Legado Puro');
        });

        test('descriptografarPaciente() deve descriptografar todos os campos sensíveis e aplicar padrão na conclusão', () => {
            const registroCifrado = {
                id: 1,
                nome: criptografar('PACIENTE FICTICIA TESTE 01'),
                numero: criptografar('77900000001'),
                nascimento: criptografar('01/01/1981'),
                cpf: criptografar('700000000000001'),
                endereco: criptografar('Rua Fictícia de Teste, 100'),
                dataResultado: criptografar('31/07/2026'),
                conclusao: ''
            };

            const pacienteLimpo = descriptografarPaciente(registroCifrado);
            assert.equal(pacienteLimpo.nome, 'PACIENTE FICTICIA TESTE 01');
            assert.equal(pacienteLimpo.numero, '77900000001');
            assert.equal(pacienteLimpo.nascimento, '01/01/1981');
            assert.equal(pacienteLimpo.cpf, '700000000000001');
            assert.equal(pacienteLimpo.endereco, 'Rua Fictícia de Teste, 100');
            assert.equal(pacienteLimpo.dataResultado, '31/07/2026');
            assert.equal(pacienteLimpo.conclusao, 'Aguardando laudo...');
        });
    });

    describe('Autenticação e Controle de Acesso (POST /login e verificarToken)', () => {
        test('POST /login deve retornar token JWT quando a senha estiver correta', async () => {
            const resposta = await fetch(`${urlBase}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ senha: process.env.SENHA_PAINEL })
            });

            assert.equal(resposta.status, 200);
            const dados = await resposta.json();
            assert.equal(dados.autorizado, true);
            assert.ok(dados.token);
        });

        test('POST /login deve retornar 401 quando a senha estiver incorreta', async () => {
            const resposta = await fetch(`${urlBase}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ senha: 'senha_errada_invalida' })
            });

            assert.equal(resposta.status, 401);
            const dados = await resposta.json();
            assert.equal(dados.autorizado, false);
        });

        test('Rotas protegidas devem bloquear requisições sem token (403) ou com token inválido (401)', async () => {
            const semToken = await fetch(`${urlBase}/pacientes`);
            assert.equal(semToken.status, 403);

            const tokenInvalido = await fetch(`${urlBase}/pacientes`, {
                headers: { Authorization: 'token.invalido.123' }
            });
            assert.equal(tokenInvalido.status, 401);
        });
    });

    describe('Gerenciamento CRUD de Pacientes (/cadastrar-paciente, /pacientes, /editar-paciente, /pacientes/:id)', () => {
        test('deve cadastrar paciente criptografada em disco, listar descriptografada, editar e remover', async () => {
            // 1. Cadastrar
            const resCadastro = await fetch(`${urlBase}/cadastrar-paciente`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: tokenValido
                },
                body: JSON.stringify({
                    nome: 'Paciente Teste LGPD',
                    numero: '5577988112233',
                    nascimento: '10/10/1990',
                    cpf: '123.456.789-00',
                    endereco: 'Rua A, 100',
                    unidade: 'USF Vila América'
                })
            });
            assert.equal(resCadastro.status, 200);

            // Verifica que no estado interno/disco os dados estão criptografados
            const salvosEmDisco = JSON.parse(fs.readFileSync(arquivoTempPacientes, 'utf-8'));
            assert.equal(salvosEmDisco.length, 1);
            assert.notEqual(salvosEmDisco[0].nome, 'Paciente Teste LGPD');
            assert.match(salvosEmDisco[0].nome, /^[a-f0-9]{32}:[a-f0-9]+$/);

            // 2. Listar descriptografado
            const resLista = await fetch(`${urlBase}/pacientes`, {
                headers: { Authorization: tokenValido }
            });
            assert.equal(resLista.status, 200);
            const lista = await resLista.json();
            assert.equal(lista.length, 1);
            assert.equal(lista[0].nome, 'Paciente Teste LGPD');
            assert.equal(lista[0].cpf, '123.456.789-00');

            const idPaciente = lista[0].id;

            // 3. Editar
            const resEdicao = await fetch(`${urlBase}/editar-paciente/${idPaciente}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: tokenValido
                },
                body: JSON.stringify({
                    nome: 'Paciente Teste Editada',
                    numero: '5577999998888',
                    nascimento: '10/10/1990',
                    cpf: '123.456.789-00',
                    endereco: 'Rua B, 200',
                    unidade: 'USF Vila América'
                })
            });
            assert.equal(resEdicao.status, 200);

            const resListaAposEdicao = await fetch(`${urlBase}/pacientes`, {
                headers: { Authorization: tokenValido }
            });
            const listaEditada = await resListaAposEdicao.json();
            assert.equal(listaEditada[0].nome, 'Paciente Teste Editada');
            assert.equal(listaEditada[0].endereco, 'Rua B, 200');

            // 4. Remover
            const resDelete = await fetch(`${urlBase}/pacientes/${idPaciente}`, {
                method: 'DELETE',
                headers: { Authorization: tokenValido }
            });
            assert.equal(resDelete.status, 200);
            assert.equal(obterPacientes().length, 0);
        });

        test('PUT /editar-paciente/:id deve retornar 404 para ID inexistente', async () => {
            const res = await fetch(`${urlBase}/editar-paciente/999999`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: tokenValido
                },
                body: JSON.stringify({
                    nome: 'Inexistente',
                    numero: '5577900000000',
                    nascimento: '01/01/2000',
                    cpf: '000',
                    endereco: 'Rua X',
                    unidade: 'USF'
                })
            });
            assert.equal(res.status, 404);
        });
    });

    describe('Disparo de Mensagens e Fluxo de Confirmação via WhatsApp', () => {
        test('deve enviar pergunta de confirmação e entregar laudo descriptografado ao receber resposta "1"', async () => {
            const mensagensEnviadas = [];
            definirSocketWhatsApp({
                user: { id: '557799999999@s.whatsapp.net' },
                async sendMessage(jid, conteudo) {
                    mensagensEnviadas.push({ jid, conteudo });
                }
            });

            const paciente = {
                id: 501,
                nome: criptografar('PACIENTE FICTICIA TESTE 05'),
                numero: criptografar('7730000005'),
                nascimento: criptografar('05/05/1985'),
                cpf: criptografar('700000000000005'),
                endereco: criptografar('Rua Fictícia de Teste, 500'),
                unidade: 'USF Vila América',
                conclusao: criptografar('ATIPIAS EM CÉLULAS ESCAMOSAS: Lesão intraepitelial de baixo grau'),
                dataResultado: criptografar('20/07/2026'),
                status: 'Pendente'
            };
            definirPacientes([paciente]);

            const resDisparo = await fetch(`${urlBase}/enviar-notificacao/501`, {
                method: 'POST',
                headers: { Authorization: tokenValido }
            });
            assert.equal(resDisparo.status, 200);
            assert.equal(obterPacientes()[0].status, 'Aguardando Confirmação');
            assert.equal(mensagensEnviadas.length, 1);
            assert.match(mensagensEnviadas[0].conteudo.text, /Você é \*PACIENTE FICTICIA TESTE 05\*\?/);

            const jidDestino = mensagensEnviadas[0].jid;

            // Simula resposta inválida primeiro
            await processarMensagemRecebida({
                type: 'notify',
                messages: [
                    {
                        key: { remoteJid: jidDestino, fromMe: false },
                        message: { conversation: 'Sim, sou eu' }
                    }
                ]
            });
            assert.equal(mensagensEnviadas.length, 2);
            assert.match(mensagensEnviadas[1].conteudo.text, /responda apenas com \*1\* para \*Sim\* ou \*0\* para \*Não\*/);

            // Simula resposta "1" (Sim) com desmascaramento de @lid
            await processarMensagemRecebida({
                type: 'notify',
                messages: [
                    {
                        key: {
                            remoteJid: '123456789@lid',
                            remoteJidAlt: jidDestino,
                            fromMe: false
                        },
                        message: { conversation: '1' }
                    }
                ]
            });

            assert.equal(mensagensEnviadas.length, 3);
            assert.match(mensagensEnviadas[2].conteudo.text, /resultado do seu exame preventivo já está disponível na \*USF Vila América\*/);
            assert.equal(mensagensEnviadas[2].conteudo.text.includes('Conclusão:'), false);
            assert.equal(obterPacientes()[0].status, 'Enviado');
            assert.equal(aguardandoConfirmacao.has(jidDestino), false);
        });

        test('deve marcar status como "Número Incorreto" ao receber resposta "0"', async () => {
            const mensagensEnviadas = [];
            definirSocketWhatsApp({
                user: { id: '557799999999@s.whatsapp.net' },
                async sendMessage(jid, conteudo) {
                    mensagensEnviadas.push({ jid, conteudo });
                }
            });

            const paciente = {
                id: 502,
                nome: criptografar('PACIENTE FICTICIA TESTE 01'),
                numero: criptografar('77900000001'),
                nascimento: criptografar('01/01/1981'),
                cpf: criptografar('700000000000001'),
                endereco: criptografar(''),
                unidade: 'USF Vila América',
                conclusao: criptografar('ASC-US'),
                status: 'Pendente'
            };
            definirPacientes([paciente]);

            await dispararMensagemPaciente(paciente);
            const jidDestino = mensagensEnviadas[0].jid;

            await processarMensagemRecebida({
                type: 'notify',
                messages: [
                    {
                        key: { remoteJid: jidDestino, fromMe: false },
                        message: { extendedTextMessage: { text: '0' } }
                    }
                ]
            });

            assert.equal(mensagensEnviadas.length, 2);
            assert.match(mensagensEnviadas[1].conteudo.text, /Pedimos desculpas pelo incômodo/);
            assert.equal(obterPacientes()[0].status, 'Número Incorreto');
            assert.equal(aguardandoConfirmacao.has(jidDestino), false);
        });

        test('POST /enviar-notificacao/:id deve retornar 404 para paciente não encontrada', async () => {
            const res = await fetch(`${urlBase}/enviar-notificacao/404999`, {
                method: 'POST',
                headers: { Authorization: tokenValido }
            });
            assert.equal(res.status, 404);
        });
    });

    describe('Fluxo Completo de Integração Semanal e Rota /sincronizar-ministerio (Sem IA)', () => {
        test('executarFluxoCompletoSemanal() deve extrair localmente os laudos com atipia do PDF e salvar criptografados', async () => {
            const caminhoPdfReal = obterCaminhoOuGerarPdfTeste(
                path.join(ROOT_DIR, 'relatorio_laudos_07_2026.pdf'),
                5
            );

            const cadastrados = await executarFluxoCompletoSemanal({
                buscarLaudo: async () => caminhoPdfReal
            });

            assert.equal(cadastrados.length, 5);
            assert.equal(obterPacientes().length, 5);

            // Todos os registros salvos devem estar criptografados em repouso (LGPD)
            for (const reg of cadastrados) {
                assert.match(reg.nome, /^[a-f0-9]{32}:[a-f0-9]+$/);
                assert.match(reg.cpf, /^[a-f0-9]{32}:[a-f0-9]+$/);
                assert.match(reg.conclusao, /^[a-f0-9]{32}:[a-f0-9]+$/);
            }

            const primeiroDescriptografado = descriptografarPaciente(cadastrados[0]);
            assert.equal(primeiroDescriptografado.nome, 'PACIENTE FICTICIA ALFA');
            assert.equal(primeiroDescriptografado.nascimento, '01/01/1981');
            assert.equal(primeiroDescriptografado.dataResultado, '31/07/2026');
        });

        test('executarFluxoCompletoSemanal() deve retornar array vazio quando nenhum PDF for gerado', async () => {
            const resultado = await executarFluxoCompletoSemanal({
                buscarLaudo: async () => null
            });
            assert.deepEqual(resultado, []);
        });

        test('GET /sincronizar-ministerio deve retornar sucesso com o total de pacientes processados localmente', async () => {
            const caminhoPdfReal = obterCaminhoOuGerarPdfTeste(
                path.join(ROOT_DIR, 'relatorio_laudos_07_2026.pdf'),
                5
            );
            definirFluxoSemanal(() =>
                executarFluxoCompletoSemanal({
                    buscarLaudo: async () => caminhoPdfReal
                })
            );

            const res = await fetch(`${urlBase}/sincronizar-ministerio`, {
                headers: { Authorization: tokenValido }
            });

            assert.equal(res.status, 200);
            const corpo = await res.json();
            assert.equal(corpo.status, 'sucesso');
            assert.equal(corpo.totalEncontrados, 5);
            assert.equal(corpo.dados.length, 5);
        });

        test('GET /sincronizar-ministerio deve retornar 500 caso ocorra falha na integração', async () => {
            definirFluxoSemanal(async () => {
                throw new Error('Portal SISCAN indisponível');
            });

            const res = await fetch(`${urlBase}/sincronizar-ministerio`, {
                headers: { Authorization: tokenValido }
            });

            assert.equal(res.status, 500);
            const corpo = await res.json();
            assert.match(corpo.error, /Portal SISCAN indisponível/);
        });
    });

    describe('Ordenação de Pacientes e Colunas Separadas (Data de Nascimento e Data do Laudo)', () => {
        const amostraPacientes = [
            {
                id: 10,
                nome: 'CARLA SOUZA',
                nascimento: '15/03/1985',
                dataResultado: '10/06/2026',
                status: 'Pendente'
            },
            {
                id: 20,
                nome: 'ANA BEATRIZ',
                nascimento: '20/11/1995',
                dataResultado: '25/09/2026',
                status: 'Enviado'
            },
            {
                id: 30,
                nome: 'BRUNA LIMA',
                nascimento: '05/01/1970',
                dataResultado: '18/08/2026',
                status: 'Aguardando Confirmação'
            },
            {
                id: 40,
                nome: 'DANIELA SEM LAUDO',
                nascimento: '01/05/1990',
                dataResultado: '',
                status: 'Pendente'
            }
        ];

        test('converterDataBrParaTimestamp() deve converter datas DD/MM/YYYY corretamente e retornar null para inválidas', () => {
            assert.equal(converterDataBrParaTimestamp('31/07/2026'), Date.UTC(2026, 6, 31));
            assert.equal(converterDataBrParaTimestamp(''), null);
            assert.equal(converterDataBrParaTimestamp(null), null);
            assert.equal(converterDataBrParaTimestamp('Sem data'), null);
            assert.equal(converterDataBrParaTimestamp('2026-07-31'), null);
        });

        test('ordenarPacientes() deve usar dataResultado (mais recente primeiro) como padrão e manter registros sem data no final', () => {
            const ordenadosPadrao = ordenarPacientes(amostraPacientes);
            assert.deepEqual(
                ordenadosPadrao.map((p) => p.nome),
                ['ANA BEATRIZ', 'BRUNA LIMA', 'CARLA SOUZA', 'DANIELA SEM LAUDO']
            );

            const ordenadosDataAntiga = ordenarPacientes(amostraPacientes, 'dataResultado', 'asc');
            assert.deepEqual(
                ordenadosDataAntiga.map((p) => p.nome),
                ['CARLA SOUZA', 'BRUNA LIMA', 'ANA BEATRIZ', 'DANIELA SEM LAUDO']
            );
        });

        test('ordenarPacientes() deve ordenar corretamente por nascimento, nome, status e cadastro', () => {
            const porNascimentoAsc = ordenarPacientes(amostraPacientes, 'nascimento', 'asc');
            assert.deepEqual(
                porNascimentoAsc.map((p) => p.nome),
                ['BRUNA LIMA', 'CARLA SOUZA', 'DANIELA SEM LAUDO', 'ANA BEATRIZ']
            );

            const porNomeAsc = ordenarPacientes(amostraPacientes, 'nome', 'asc');
            assert.deepEqual(
                porNomeAsc.map((p) => p.nome),
                ['ANA BEATRIZ', 'BRUNA LIMA', 'CARLA SOUZA', 'DANIELA SEM LAUDO']
            );

            const porNomeDesc = ordenarPacientes(amostraPacientes, 'nome', 'desc');
            assert.deepEqual(
                porNomeDesc.map((p) => p.nome),
                ['DANIELA SEM LAUDO', 'CARLA SOUZA', 'BRUNA LIMA', 'ANA BEATRIZ']
            );

            const porStatusAsc = ordenarPacientes(amostraPacientes, 'status', 'asc');
            assert.equal(porStatusAsc[0].status, 'Aguardando Confirmação');
            assert.equal(porStatusAsc[1].status, 'Enviado');

            const porCadastroDesc = ordenarPacientes(amostraPacientes, 'cadastro', 'desc');
            assert.deepEqual(porCadastroDesc.map((p) => p.id), [40, 30, 20, 10]);
        });

        test('GET /pacientes deve retornar os pacientes ordenados por data do laudo por padrão e aceitar parâmetros ordenarPor e ordem', async () => {
            definirPacientes(
                amostraPacientes.map((p) => ({
                    id: p.id,
                    nome: criptografar(p.nome),
                    numero: criptografar('77999990000'),
                    nascimento: criptografar(p.nascimento),
                    cpf: criptografar('700000000000000'),
                    endereco: criptografar('Rua Teste'),
                    dataResultado: criptografar(p.dataResultado),
                    conclusao: criptografar('ASC-US'),
                    status: p.status
                }))
            );

            // Padrão: dataResultado desc
            const resPadrao = await fetch(`${urlBase}/pacientes`, {
                headers: { Authorization: tokenValido }
            });
            assert.equal(resPadrao.status, 200);
            const listaPadrao = await resPadrao.json();
            assert.deepEqual(
                listaPadrao.map((p) => p.nome),
                ['ANA BEATRIZ', 'BRUNA LIMA', 'CARLA SOUZA', 'DANIELA SEM LAUDO']
            );

            // Ordenado por nome A-Z via query string
            const resPorNome = await fetch(`${urlBase}/pacientes?ordenarPor=nome&ordem=asc`, {
                headers: { Authorization: tokenValido }
            });
            const listaPorNome = await resPorNome.json();
            assert.deepEqual(
                listaPorNome.map((p) => p.nome),
                ['ANA BEATRIZ', 'BRUNA LIMA', 'CARLA SOUZA', 'DANIELA SEM LAUDO']
            );
        });

        test('Interface (index.html e script.js) deve exibir colunas separadas para Data de Nascimento e Data do Laudo e seletor de ordenação', () => {
            const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf-8');
            const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'scripts', 'script.js'), 'utf-8');

            assert.ok(html.includes('<th class="px-6 py-4">Data de Nascimento</th>'), 'Cabeçalho de Data de Nascimento separado deve existir');
            assert.ok(html.includes('<th class="px-6 py-4">Data da Coleta</th>'), 'Cabeçalho de Data da Coleta separado deve existir');
            assert.ok(html.includes('<th class="px-6 py-4">Data do Laudo</th>'), 'Cabeçalho de Data do Laudo separado deve existir');
            assert.ok(!html.includes('Nascimento / Data Laudo'), 'Cabeçalho antigo combinado não deve existir');
            assert.ok(html.includes('id="criterioOrdenacao"'), 'Seletor de critério de ordenação deve existir');
            assert.ok(html.includes('<option value="dataResultado:desc" selected>'), 'Padrão de ordenação deve ser Data do Laudo');

            assert.ok(script.includes('CÉLULA: DATA DE NASCIMENTO'), 'Célula separada de nascimento deve existir no script.js');
            assert.ok(script.includes('CÉLULA: DATA DA COLETA'), 'Célula separada de data da coleta deve existir no script.js');
            assert.ok(script.includes('CÉLULA: DATA DO LAUDO'), 'Célula separada de data do laudo deve existir no script.js');
            assert.ok(script.includes('function ordenarPacientesLista'), 'Função de ordenação no cliente deve existir no script.js');
        });
    });

    describe('Integração PEC nas Rotas e no Fluxo Semanal (/sincronizar-pec e enriquecimento de contatos)', () => {
        test('executarFluxoCompletoSemanal() deve enriquecer telefone e endereço via PEC e criptografá-los em disco', async () => {
            const caminhoPdfReal = obterCaminhoOuGerarPdfTeste(
                path.join(ROOT_DIR, 'relatorio_laudos_07_2026.pdf'),
                5
            );

            const cadastrados = await executarFluxoCompletoSemanal({
                buscarLaudo: async () => caminhoPdfReal,
                enriquecerPec: async (lista) => ({
                    pacientes: lista.map((p) => ({
                        ...p,
                        telefone: '77988881111',
                        endereco: 'Rua Atualizada pelo PEC, Nº 100 - Bairro: Vila América'
                    })),
                    totalAnalisados: lista.length,
                    totalAtualizados: lista.length
                })
            });

            assert.equal(cadastrados.length, 5);
            const primeiroLimpo = descriptografarPaciente(cadastrados[0]);
            assert.equal(primeiroLimpo.numero, '77988881111');
            assert.equal(primeiroLimpo.endereco, 'Rua Atualizada pelo PEC, Nº 100 - Bairro: Vila América');
        });

        test('POST /sincronizar-pec deve atualizar contatos dos pacientes já cadastrados mantendo criptografia LGPD', async () => {
            definirPacientes([
                {
                    id: 901,
                    nome: criptografar('PACIENTE FICTICIA TESTE 01'),
                    numero: criptografar('77900000000'),
                    nascimento: criptografar('01/01/1981'),
                    cpf: criptografar('700000000000001'),
                    endereco: criptografar(''),
                    dataResultado: criptografar('31/07/2026'),
                    conclusao: criptografar('ASC-US'),
                    status: 'Pendente'
                }
            ]);

            definirSincronizadorPec(() =>
                atualizarContatosPacientesPec({
                    enriquecerPec: async (lista) => ({
                        pacientes: lista.map((p) => ({
                            ...p,
                            numero: '77999112233',
                            endereco: 'Av. Fictícia de Teste, Nº 500 - Bairro: Bairro Teste'
                        })),
                        totalAnalisados: lista.length,
                        totalAtualizados: 1
                    })
                })
            );

            const res = await fetch(`${urlBase}/sincronizar-pec`, {
                method: 'POST',
                headers: { Authorization: tokenValido }
            });

            assert.equal(res.status, 200);
            const corpo = await res.json();
            assert.equal(corpo.status, 'sucesso');
            assert.equal(corpo.totalAnalisados, 1);
            assert.equal(corpo.totalAtualizados, 1);

            const salvoCifrado = obterPacientes()[0];
            assert.match(salvoCifrado.numero, /^[a-f0-9]{32}:[a-f0-9]+$/);
            assert.match(salvoCifrado.endereco, /^[a-f0-9]{32}:[a-f0-9]+$/);

            const limpo = descriptografarPaciente(salvoCifrado);
            assert.equal(limpo.numero, '77999112233');
            assert.equal(limpo.endereco, 'Av. Fictícia de Teste, Nº 500 - Bairro: Bairro Teste');
        });

        test('POST /sincronizar-pec deve retornar 400 caso as credenciais do PEC não estejam configuradas', async () => {
            definirPacientes([
                {
                    id: 902,
                    nome: criptografar('PACIENTE TESTE'),
                    numero: criptografar(''),
                    nascimento: criptografar('01/01/1990'),
                    cpf: criptografar('700000000000000'),
                    endereco: criptografar(''),
                    dataResultado: criptografar('01/08/2026'),
                    conclusao: criptografar('ASC-US'),
                    status: 'Pendente'
                }
            ]);

            definirSincronizadorPec(() =>
                atualizarContatosPacientesPec({
                    enriquecerPec: async () => {
                        throw new Error('Configure PEC_USUARIO (CPF) e PEC_SENHA no arquivo .env para consultar o PEC do município.');
                    }
                })
            );

            const res = await fetch(`${urlBase}/sincronizar-pec`, {
                method: 'POST',
                headers: { Authorization: tokenValido }
            });

            assert.equal(res.status, 400);
            const corpo = await res.json();
            assert.match(corpo.error, /PEC_USUARIO/);
        });
    });

    describe('Segurança da Informação e Adequação à LGPD (Hardening)', () => {
        test('compararSenhasSeguro() deve comparar senhas em tempo constante e rejeitar entradas inválidas', () => {
            assert.equal(compararSenhasSeguro('senha_ficticia_teste_123', 'senha_ficticia_teste_123'), true);
            assert.equal(compararSenhasSeguro('senha_errada', 'senha_ficticia_teste_123'), false);
            assert.equal(compararSenhasSeguro(null, 'senha_ficticia_teste_123'), false);
            assert.equal(compararSenhasSeguro('senha_ficticia_teste_123', ''), false);
        });

        test('mascararDadoSensivel() deve anonimizar nomes e JIDs de telefone para logs seguros (LGPD)', () => {
            assert.equal(mascararDadoSensivel('5577900000001@s.whatsapp.net'), '5577****01@s.whatsapp.net');
            assert.equal(mascararDadoSensivel('PACIENTE FICTICIA TESTE 05'), 'PAC***05');
            assert.equal(mascararDadoSensivel(''), '***');
        });

        test('POST /login deve bloquear ataques de força bruta (HTTP 429) após 5 tentativas falhas', async () => {
            for (let i = 0; i < 5; i++) {
                const resFalha = await fetch(`${urlBase}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ senha: `tentativa_errada_${i}` })
                });
                assert.equal(resFalha.status, 401);
            }

            const resBloqueado = await fetch(`${urlBase}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ senha: process.env.SENHA_PAINEL })
            });
            assert.equal(resBloqueado.status, 429);
        });

        test('Rotas sensíveis devem incluir cabeçalhos de segurança HTTP e Cache-Control no-store (LGPD Art. 46)', async () => {
            const res = await fetch(`${urlBase}/pacientes`, {
                headers: { Authorization: `Bearer ${tokenValido}` }
            });
            assert.equal(res.status, 200);
            assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
            assert.equal(res.headers.get('x-frame-options'), 'DENY');
            assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
            assert.match(res.headers.get('cache-control') || '', /no-store/);
            assert.equal(res.headers.get('x-powered-by'), null);
        });

        test('dispararMensagemPaciente() deve enviar para o número real da paciente (sem redirecionamento fixo) e validar telefone ausente', async () => {
            const envios = [];
            definirSocketWhatsApp({
                user: { id: '557799999999@s.whatsapp.net' },
                async sendMessage(jid, conteudo) {
                    envios.push({ jid, conteudo });
                }
            });

            const pacienteComNumero = {
                id: 701,
                nome: criptografar('PACIENTE FICTICIA TESTE 01'),
                numero: criptografar('77900000001'),
                unidade: 'USF Vila América',
                conclusao: criptografar('ASC-US'),
                status: 'Pendente'
            };

            await dispararMensagemPaciente(pacienteComNumero);
            assert.equal(envios.length, 1);
            // 55 + 77 + 00000001 (9º dígito removido para DDD > 31 no padrão WhatsApp)
            assert.equal(envios[0].jid, '557700000001@s.whatsapp.net');
            const dadosConfirmacao = aguardandoConfirmacao.get('557700000001@s.whatsapp.net');
            assert.ok(dadosConfirmacao, 'Deve registrar a paciente aguardando confirmação');
            assert.ok(dadosConfirmacao.mensagemFinal.includes('já está disponível na *USF Vila América*'));
            assert.ok(!dadosConfirmacao.mensagemFinal.includes('ASC-US'), 'Não deve expor a conclusão do laudo no WhatsApp (sigilo LGPD)');
            assert.ok(!dadosConfirmacao.mensagemFinal.includes('Conclusão:'), 'Não deve exibir o campo Conclusão na mensagem');

            const pacienteSemNumero = {
                id: 702,
                nome: criptografar('PACIENTE SEM TELEFONE'),
                numero: criptografar(''),
                unidade: 'USF Vila América',
                conclusao: criptografar('ASC-US'),
                status: 'Pendente'
            };

            await assert.rejects(
                () => dispararMensagemPaciente(pacienteSemNumero),
                /não possui número de telefone válido/
            );
        });

        test('executarFluxoCompletoSemanal() deve evitar duplicação de pacientes e remover PDF temporário quando configurado', async () => {
            const pdfOriginal = obterCaminhoOuGerarPdfTeste(
                path.join(ROOT_DIR, 'relatorio_laudos_07_2026.pdf'),
                5
            );
            const pdfTemporario = path.join(os.tmpdir(), `laudo_temp_lgpd_${Date.now()}.pdf`);
            fs.copyFileSync(pdfOriginal, pdfTemporario);

            // 1ª execução: cadastra 5 pacientes e apaga o PDF temporário do disco
            await executarFluxoCompletoSemanal({
                buscarLaudo: async () => pdfTemporario,
                enriquecerPec: async (lista) => ({ pacientes: lista, totalAnalisados: lista.length, totalAtualizados: 0 }),
                removerPdfAposExtracao: true
            });

            assert.equal(fs.existsSync(pdfTemporario), false, 'PDF temporário em texto aberto deve ser eliminado após extração');
            assert.equal(obterPacientes().length, 5);

            // 2ª execução com o mesmo relatório: não deve duplicar os 5 cadastros existentes
            await executarFluxoCompletoSemanal({
                buscarLaudo: async () => pdfOriginal,
                enriquecerPec: async (lista) => ({ pacientes: lista, totalAnalisados: lista.length, totalAtualizados: 0 }),
                removerPdfAposExtracao: false
            });

            assert.equal(obterPacientes().length, 5, 'Pacientes já cadastradas com a mesma data de laudo não devem ser duplicadas');
        });

        test('deduplicarPacientes() deve consolidar registros legados duplicados (mesmo sem dataResultado) mantendo o status mais avançado e dados completos', () => {
            const listaComDuplicatas = [
                {
                    id: 1,
                    nome: criptografar('PACIENTE FICTICIA TESTE 01'),
                    numero: criptografar('77900000001'),
                    nascimento: criptografar('01/01/1981'),
                    cpf: criptografar('Não informado'),
                    endereco: criptografar('Não consta no laudo'),
                    dataResultado: criptografar(''),
                    conclusao: criptografar('ASC-US'),
                    status: 'Enviado'
                },
                {
                    id: 2,
                    nome: criptografar('Paciente Fictícia Teste 01'),
                    numero: criptografar('77991112222'),
                    nascimento: criptografar('01/01/1981'),
                    cpf: criptografar('700000000000001'),
                    endereco: criptografar('Rua Exemplo, Nº 10, Bairro Teste'),
                    dataResultado: criptografar('31/07/2026'),
                    conclusao: criptografar('ASC-US (Atipia escamosa)'),
                    status: 'Pendente'
                }
            ];

            const consolidada = deduplicarPacientes(listaComDuplicatas);
            assert.equal(consolidada.length, 1);

            const limpo = descriptografarPaciente(consolidada[0]);
            assert.equal(limpo.cpf, '700000000000001');
            assert.equal(limpo.dataResultado, '31/07/2026');
            assert.equal(limpo.numero, '77991112222');
            assert.equal(limpo.endereco, 'Rua Exemplo, Nº 10, Bairro Teste');
            assert.equal(limpo.status, 'Enviado');
        });

        test('Suíte de testes deve usar credenciais efêmeras isoladas do .env e não conter senhas reais ou dados pessoais nos scripts', () => {
            assert.match(process.env.SENHA_PAINEL || '', /^senha_teste_efemera_[a-f0-9]{24}$/);
            assert.equal(process.env.SISCAN_EMAIL, undefined);
            assert.equal(process.env.SISCAN_SENHA, undefined);
            assert.equal(process.env.PEC_USUARIO, undefined);
            assert.equal(process.env.PEC_SENHA, undefined);

            // Se existir .env local, garante que nenhuma credencial real do .env está carregada nos testes
            const caminhoEnv = path.join(ROOT_DIR, '.env');
            if (fs.existsSync(caminhoEnv)) {
                const linhasEnv = fs.readFileSync(caminhoEnv, 'utf-8').split(/\r?\n/);
                for (const linha of linhasEnv) {
                    const match = linha.match(/^\s*(SENHA_PAINEL|SECRET_KEY)\s*=\s*(.+)\s*$/);
                    if (match) {
                        const chave = match[1];
                        const valorReal = match[2].replace(/^['"]|['"]$/g, '').trim();
                        if (valorReal) {
                            assert.notEqual(
                                process.env[chave],
                                valorReal,
                                `A variável ${chave} de produção não deve ser carregada durante os testes`
                            );
                        }
                    }
                }
            }

            // Verifica que nenhum arquivo em tests/ contém CNS reais fora da faixa sintética 700000000000xxx
            const arquivosTeste = fs.readdirSync(__dirname).filter((f) => f.endsWith('.js'));
            for (const arquivo of arquivosTeste) {
                const conteudo = fs.readFileSync(path.join(__dirname, arquivo), 'utf-8');
                const cnsEncontrados = conteudo.match(/\b7\d{14}\b/g) || [];
                for (const cns of cnsEncontrados) {
                    assert.match(
                        cns,
                        /^700000000000\d{3}$/,
                        `CNS em ${arquivo} deve ser exclusivamente sintético (700000000000xxx), encontrado: ${cns}`
                    );
                }
            }
        });

        test('Frontend (script.js e index.html) deve sanitizar HTML contra XSS e possuir botão de encerramento de sessão', () => {
            const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'scripts', 'script.js'), 'utf-8');
            const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf-8');

            assert.ok(script.includes('function escaparHtml('), 'Função escaparHtml contra XSS deve existir');
            assert.ok(script.includes('abrirEdicaoPorId('), 'Edição deve usar ID em vez de injetar JSON inline no HTML');
            assert.ok(!script.includes('JSON.stringify(p)'), 'Não deve injetar JSON.stringify dentro de atributo onclick');
            assert.ok(html.includes('id="btn-sair"'), 'Botão de logout (Sair) deve existir na barra de navegação');
        });
    });

    describe('Novas Funcionalidades Clínicas e de UI/UX (Prioridade, KPIs, Lote, Status Rápido e Importação PDF)', () => {
        test('classificarPrioridadeClinica() deve diferenciar lesões de Alto Grau (Alta), Baixo Grau (Moderada) e Rotina', () => {
            assert.equal(classificarPrioridadeClinica('Lesão intraepitelial de alto grau (HSIL)'), 'Alta');
            assert.equal(classificarPrioridadeClinica('Células escamosas atípicas não se pode afastar alto grau (ASC-H)'), 'Alta');
            assert.equal(classificarPrioridadeClinica('Atipias em células glandulares (AGC)'), 'Alta');
            assert.equal(classificarPrioridadeClinica('Lesão intraepitelial de baixo grau (LSIL)'), 'Moderada');
            assert.equal(classificarPrioridadeClinica('ASC-US - possivelmente não neoplásicas'), 'Moderada');
            assert.equal(classificarPrioridadeClinica('Aguardando laudo...'), 'Rotina');
        });

        test('calcularEstatisticasPacientes() e GET /status-sistema devem retornar indicadores clínicos precisos', async () => {
            definirPacientes([
                {
                    id: 1,
                    nome: criptografar('PACIENTE ALTA PRIORIDADE'),
                    numero: criptografar('77988887777'),
                    nascimento: criptografar('10/05/1975'),
                    cpf: criptografar('701'),
                    endereco: criptografar('Rua A'),
                    conclusao: criptografar('Lesão intraepitelial de alto grau (HSIL)'),
                    dataResultado: criptografar('10/08/2026'),
                    status: 'Pendente'
                },
                {
                    id: 2,
                    nome: criptografar('PACIENTE SEM TELEFONE'),
                    numero: criptografar(''),
                    nascimento: criptografar('20/08/1982'),
                    cpf: criptografar('702'),
                    endereco: criptografar('Rua B'),
                    conclusao: criptografar('ASC-US'),
                    dataResultado: criptografar('12/08/2026'),
                    status: 'Compareceu à USF'
                }
            ]);

            const res = await fetch(`${urlBase}/status-sistema`, {
                headers: { Authorization: tokenValido }
            });
            assert.equal(res.status, 200);
            const corpo = await res.json();
            assert.equal(corpo.estatisticas.total, 2);
            assert.equal(corpo.estatisticas.pendentes, 1);
            assert.equal(corpo.estatisticas.compareceram, 1);
            assert.equal(corpo.estatisticas.semTelefone, 1);
            assert.equal(corpo.estatisticas.prioridadeAlta, 1);
            assert.equal(corpo.estatisticas.prioridadeModerada, 1);
        });

        test('ordenarPacientes() deve permitir ordenar por prioridade clínica (Alta > Moderada > Rotina)', () => {
            const lista = [
                { nome: 'B', conclusao: 'ASC-US', dataResultado: '10/08/2026' },
                { nome: 'A', conclusao: 'HSIL - alto grau', dataResultado: '05/08/2026' },
                { nome: 'C', conclusao: 'Aguardando laudo...', dataResultado: '15/08/2026' }
            ];
            const ordenada = ordenarPacientes(lista, 'prioridade', 'desc');
            assert.deepEqual(ordenada.map((p) => p.nome), ['A', 'B', 'C']);
        });

        test('PATCH /pacientes/:id/status deve atualizar status rápido e salvar observações criptografadas', async () => {
            definirPacientes([
                {
                    id: 801,
                    nome: criptografar('PACIENTE RETORNO USF'),
                    numero: criptografar('77988112233'),
                    nascimento: criptografar('01/01/1980'),
                    cpf: criptografar('7001'),
                    endereco: criptografar('Rua X'),
                    conclusao: criptografar('ASC-US'),
                    dataResultado: criptografar('01/08/2026'),
                    status: 'Enviado'
                }
            ]);

            const res = await fetch(`${urlBase}/pacientes/801/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: tokenValido
                },
                body: JSON.stringify({
                    status: 'Compareceu à USF',
                    observacoes: 'Acolhida pela enfermeira na USF em 14/11/2026'
                })
            });

            assert.equal(res.status, 200);
            const corpo = await res.json();
            assert.equal(corpo.paciente.status, 'Compareceu à USF');
            assert.equal(corpo.paciente.observacoes, 'Acolhida pela enfermeira na USF em 14/11/2026');

            // Verifica que observações ficaram criptografadas em repouso
            const registroBruto = obterPacientes()[0];
            assert.match(registroBruto.observacoes, /^[a-f0-9]{32}:[a-f0-9]+$/);
            assert.ok(registroBruto.dataComparecimento);
        });

        test('POST /enviar-notificacoes-pendentes deve disparar em lote apenas para pendentes com telefone válido', async () => {
            const disparos = [];
            definirSocketWhatsApp({
                user: { id: '557799999999@s.whatsapp.net' },
                async sendMessage(jid, conteudo) {
                    disparos.push({ jid, conteudo });
                }
            });

            definirPacientes([
                {
                    id: 810,
                    nome: criptografar('COM TELEFONE'),
                    numero: criptografar('77900000001'),
                    unidade: 'USF Vila América',
                    conclusao: criptografar('ASC-US'),
                    status: 'Pendente'
                },
                {
                    id: 811,
                    nome: criptografar('SEM TELEFONE'),
                    numero: criptografar(''),
                    unidade: 'USF Vila América',
                    conclusao: criptografar('ASC-US'),
                    status: 'Pendente'
                }
            ]);

            const res = await fetch(`${urlBase}/enviar-notificacoes-pendentes`, {
                method: 'POST',
                headers: { Authorization: tokenValido }
            });
            assert.equal(res.status, 200);
            const corpo = await res.json();
            assert.equal(corpo.enviados, 1);
            assert.equal(corpo.ignoradosSemTelefone, 1);
            assert.equal(disparos.length, 1);
        });

        test('POST /importar-pdf-laudos deve extrair localmente um PDF enviado em base64 e cadastrar pacientes criptografadas', async () => {
            const pdfBuffer = fs.readFileSync(
                obterCaminhoOuGerarPdfTeste(path.join(ROOT_DIR, 'relatorio_laudos_07_2026.pdf'), 5)
            );
            const conteudoBase64 = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`;

            const res = await fetch(`${urlBase}/importar-pdf-laudos`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: tokenValido
                },
                body: JSON.stringify({ nomeArquivo: 'relatorio_07_2026.pdf', conteudoBase64 })
            });

            assert.equal(res.status, 200);
            const corpo = await res.json();
            assert.equal(corpo.status, 'sucesso');
            assert.equal(corpo.totalAtipicosEncontrados, 5);
            assert.equal(corpo.novosCadastros, 5);
            assert.equal(obterPacientes().length, 5);
        });

        test('POST /configurar-envios-whatsapp deve permitir desativar o envio de mensagens em Modo de Teste', async () => {
            const disparos = [];
            definirSocketWhatsApp({
                user: { id: '557799999999@s.whatsapp.net' },
                async sendMessage(jid, conteudo) {
                    disparos.push({ jid, conteudo });
                }
            });

            definirPacientes([
                {
                    id: 850,
                    nome: criptografar('PACIENTE MODO TESTE'),
                    numero: criptografar('77900000001'),
                    unidade: 'USF Vila América',
                    conclusao: criptografar('ASC-US'),
                    status: 'Pendente'
                }
            ]);

            // Desativa os envios pelo endpoint
            const resDesativar = await fetch(`${urlBase}/configurar-envios-whatsapp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: tokenValido
                },
                body: JSON.stringify({ ativo: false })
            });
            assert.equal(resDesativar.status, 200);
            const corpoDesativar = await resDesativar.json();
            assert.equal(corpoDesativar.enviosWhatsAppAtivos, false);
            assert.equal(obterStatusEnviosWhatsApp(), false);

            // Tenta enviar notificação individual com Modo de Teste ativo -> deve bloquear sem disparar no socket
            const resEnvioIndividual = await fetch(`${urlBase}/enviar-notificacao/850`, {
                method: 'POST',
                headers: { Authorization: tokenValido }
            });
            assert.equal(resEnvioIndividual.status, 500);
            assert.equal(disparos.length, 0);

            // Tenta enviar em lote com Modo de Teste ativo -> deve retornar 403 e não disparar
            const resEnvioLote = await fetch(`${urlBase}/enviar-notificacoes-pendentes`, {
                method: 'POST',
                headers: { Authorization: tokenValido }
            });
            assert.equal(resEnvioLote.status, 403);
            assert.equal(disparos.length, 0);
        });

        test('GET /whatsapp/qrcode deve exigir autenticação JWT e fornecer QR Code em SVG sem poluir os logs', async () => {
            const resSemAuth = await fetch(`${urlBase}/whatsapp/qrcode`);
            assert.equal(resSemAuth.status, 403);

            definirSocketWhatsApp(null);
            definirQrCodeWhatsApp('2@QR_TESTE_SEGURO_UESB_12345');

            const resComAuth = await fetch(`${urlBase}/whatsapp/qrcode`, {
                headers: { Authorization: `Bearer ${tokenValido}` }
            });
            assert.equal(resComAuth.status, 200);
            const corpo = await resComAuth.json();
            assert.equal(corpo.conectado, false);
            assert.equal(corpo.qrDisponivel, true);
            assert.match(corpo.qrSvgDataUrl, /^data:image\/svg\+xml;base64,/);

            const svgDecodificado = Buffer.from(corpo.qrSvgDataUrl.split(',')[1], 'base64').toString('utf-8');
            assert.ok(svgDecodificado.includes('<svg'), 'Deve conter um SVG vetorial gerado localmente');

            definirQrCodeWhatsApp(null);
        });
    });
});
