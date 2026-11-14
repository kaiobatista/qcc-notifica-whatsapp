import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    clienteAxios,
    obterViewState,
    formatarData,
    formatarMesAno,
    realizarLogin,
    selecionarPerfil,
    automatizarPesquisaLaudo
} from '../integracao.js';

describe('Módulo de Integração com o SISCAN (integracao.js)', () => {
    let getOriginal;
    let postOriginal;
    let envEmailOriginal;
    let envSenhaOriginal;
    const arquivosTemporarios = [];

    beforeEach(() => {
        getOriginal = clienteAxios.get;
        postOriginal = clienteAxios.post;
        envEmailOriginal = process.env.SISCAN_EMAIL;
        envSenhaOriginal = process.env.SISCAN_SENHA;
    });

    afterEach(() => {
        clienteAxios.get = getOriginal;
        clienteAxios.post = postOriginal;
        process.env.SISCAN_EMAIL = envEmailOriginal;
        process.env.SISCAN_SENHA = envSenhaOriginal;

        for (const arq of arquivosTemporarios.splice(0)) {
            if (fs.existsSync(arq)) {
                fs.unlinkSync(arq);
            }
        }
    });

    describe('Funções utilitárias', () => {
        test('obterViewState() deve extrair o valor de javax.faces.ViewState do HTML', () => {
            const html = `
                <html>
                    <body>
                        <form>
                            <input type="hidden" name="javax.faces.ViewState" value="j_id1:j_id2" />
                        </form>
                    </body>
                </html>
            `;
            assert.equal(obterViewState(html), 'j_id1:j_id2');
        });

        test('obterViewState() deve retornar undefined quando ViewState não existir', () => {
            assert.equal(obterViewState('<html><body>Sem form</body></html>'), undefined);
        });

        test('formatarData() e formatarMesAno() devem formatar datas com zero à esquerda', () => {
            const data = new Date(2026, 4, 7); // 07/05/2026
            assert.equal(formatarData(data), '07/05/2026');
            assert.equal(formatarMesAno(data), '05/2026');
        });
    });

    describe('realizarLogin() e selecionarPerfil()', () => {
        test('realizarLogin() deve obter ViewState da tela de login, enviar credenciais e retornar ViewState do perfil', async () => {
            process.env.SISCAN_EMAIL = 'teste@saude.gov.br';
            process.env.SISCAN_SENHA = 'senha123';

            clienteAxios.get = async (url) => {
                assert.match(url, /\/login\.jsf$/);
                return {
                    data: '<input name="javax.faces.ViewState" value="vs_login_1" />'
                };
            };

            clienteAxios.post = async (url, body) => {
                assert.match(url, /\/login\.jsf$/);
                assert.match(body, /email=teste%40saude\.gov\.br/);
                assert.match(body, /javax\.faces\.ViewState=vs_login_1/);
                return {
                    data: '<form name="formPerfil"><input name="javax.faces.ViewState" value="vs_perfil_2" /></form>'
                };
            };

            const vsPerfil = await realizarLogin();
            assert.equal(vsPerfil, 'vs_perfil_2');
        });

        test('realizarLogin() deve lançar erro caso as credenciais sejam inválidas (sem formPerfil)', async () => {
            arquivosTemporarios.push('erro_login_real.html');

            clienteAxios.get = async () => ({
                data: '<input name="javax.faces.ViewState" value="vs_login_1" />'
            });
            clienteAxios.post = async () => ({
                data: '<html><body>Credenciais inválidas</body></html>'
            });

            await assert.rejects(
                () => realizarLogin(),
                /Falha no login ou credenciais incorretas/
            );
        });

        test('selecionarPerfil() deve submeter o índice de perfil correto com o ViewState', async () => {
            let payloadEnviado = '';
            clienteAxios.post = async (url, body) => {
                assert.match(url, /\/visao\/acesso\/perfil\.jsf$/);
                payloadEnviado = body;
                return { data: 'ok' };
            };

            await selecionarPerfil('vs_perfil_2', '0');
            assert.match(payloadEnviado, /j_id28%3A0%3Aj_id31=j_id28%3A0%3Aj_id31/);
            assert.match(payloadEnviado, /javax\.faces\.ViewState=vs_perfil_2/);
        });
    });

    describe('automatizarPesquisaLaudo()', () => {
        test('deve lançar erro se SISCAN_EMAIL ou SISCAN_SENHA não estiverem configurados', async () => {
            delete process.env.SISCAN_EMAIL;
            delete process.env.SISCAN_SENHA;

            await assert.rejects(
                () => automatizarPesquisaLaudo(),
                /SISCAN_EMAIL e SISCAN_SENHA devem estar configurados/
            );
        });

        test('deve retornar null quando nenhum laudo for encontrado no período', async () => {
            process.env.SISCAN_EMAIL = 'teste@saude.gov.br';
            process.env.SISCAN_SENHA = 'senha123';

            clienteAxios.get = async (url) => {
                if (url.endsWith('/login.jsf')) {
                    return { data: '<input name="javax.faces.ViewState" value="vs1" />' };
                }
                return { data: '<input name="javax.faces.ViewState" value="vs2" />' };
            };

            clienteAxios.post = async (url) => {
                if (url.endsWith('/login.jsf')) {
                    return { data: '<form name="formPerfil"><input name="javax.faces.ViewState" value="vs_perfil" /></form>' };
                }
                if (url.endsWith('/perfil.jsf')) {
                    return { data: 'ok' };
                }
                return {
                    data: '<input name="javax.faces.ViewState" value="vs_ajax" /><table></table>'
                };
            };

            const resultado = await automatizarPesquisaLaudo();
            assert.equal(resultado, null);
        });

        test('deve salvar o PDF e retornar o nome do arquivo quando houver laudos encontrados', async () => {
            process.env.SISCAN_EMAIL = 'teste@saude.gov.br';
            process.env.SISCAN_SENHA = 'senha123';

            clienteAxios.get = async () => ({
                data: '<input name="javax.faces.ViewState" value="vs_inicial" />'
            });

            clienteAxios.post = async (url, body, config) => {
                if (url.endsWith('/login.jsf')) {
                    return { data: '<form name="formPerfil"><input name="javax.faces.ViewState" value="vs_perfil" /></form>' };
                }
                if (url.endsWith('/perfil.jsf')) {
                    return { data: 'ok' };
                }
                if (config?.responseType === 'arraybuffer') {
                    return { data: Buffer.from('%PDF-1.4 mock pdf content') };
                }
                if (body.includes('form%3AtamanhoPagina') && body.includes('form%3Aj_id220')) {
                    return {
                        data: `
                            <input name="javax.faces.ViewState" value="vs_paginado" />
                            <input type="checkbox" name="form:listaPesquisaLaudoPaginada:t0" />
                            <input type="checkbox" name="form:listaPesquisaLaudoPaginada:0:j_id225" />
                            <input type="checkbox" name="form:listaPesquisaLaudoPaginada:1:j_id225" />
                        `
                    };
                }
                return {
                    data: '<input name="javax.faces.ViewState" value="vs_atualizado" />'
                };
            };

            const nomeArquivo = await automatizarPesquisaLaudo();
            assert.ok(nomeArquivo);
            arquivosTemporarios.push(nomeArquivo);
            assert.equal(fs.existsSync(nomeArquivo), true);

            const dataEsperadaInicio = new Date();
            dataEsperadaInicio.setMonth(dataEsperadaInicio.getMonth() - 6);
            const mesAnoEsperado = formatarMesAno(dataEsperadaInicio).replace('/', '_');
            assert.ok(nomeArquivo.includes(`relatorio_laudos_${mesAnoEsperado}_a_`));
        });
    });
});
