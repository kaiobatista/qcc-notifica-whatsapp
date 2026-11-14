import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    extrairUrlBasePec,
    converterDataBrParaIso,
    normalizarTextoComparacao,
    escolherMelhorTelefonePec,
    formatarEnderecoPec,
    selecionarMelhorCidadao,
    criarClientePec,
    enriquecerPacientesComPec
} from '../integracao_pec.js';

describe('Módulo de Integração com o PEC e-SUS APS (integracao_pec.js)', () => {
    describe('Funções utilitárias de URL, Datas, Telefone e Endereço', () => {
        test('extrairUrlBasePec() deve extrair o domínio base a partir da URL do cadastro individual', () => {
            assert.equal(
                extrairUrlBasePec('https://esus.vca.ba.wmsaude.com.br/gestaoCadastros/cadastro-individual'),
                'https://esus.vca.ba.wmsaude.com.br'
            );
            assert.equal(
                extrairUrlBasePec('https://esus.vca.ba.wmsaude.com.br'),
                'https://esus.vca.ba.wmsaude.com.br'
            );
            assert.equal(extrairUrlBasePec('url-invalida'), 'https://esus.vca.ba.wmsaude.com.br');
        });

        test('converterDataBrParaIso() deve converter DD/MM/YYYY para YYYY-MM-DD', () => {
            assert.equal(converterDataBrParaIso('12/05/1961'), '1961-05-12');
            assert.equal(converterDataBrParaIso(''), null);
            assert.equal(converterDataBrParaIso('1961-05-12'), null);
        });

        test('normalizarTextoComparacao() deve remover acentos e padronizar caixa alta', () => {
            assert.equal(
                normalizarTextoComparacao('  Mária   José da Conceição '),
                'MARIA JOSE DA CONCEICAO'
            );
        });

        test('escolherMelhorTelefonePec() deve priorizar celular > contato > residencial > fallback', () => {
            assert.equal(
                escolherMelhorTelefonePec(
                    {
                        telefoneCelular: '(77) 98811-2233',
                        telefoneContato: '(77) 98800-0000',
                        telefoneResidencial: '(77) 3421-0000'
                    },
                    '7700000000'
                ),
                '77988112233'
            );

            assert.equal(
                escolherMelhorTelefonePec(
                    {
                        telefoneCelular: null,
                        telefoneContato: '(77) 99123-4567',
                        telefoneResidencial: '(77) 3421-0000'
                    },
                    '7700000000'
                ),
                '77991234567'
            );

            assert.equal(
                escolherMelhorTelefonePec(
                    {
                        telefoneCelular: '',
                        telefoneContato: '',
                        telefoneResidencial: ''
                    },
                    '77988230391'
                ),
                '77988230391'
            );
        });

        test('formatarEnderecoPec() deve montar endereço completo legível a partir do objeto do PEC', () => {
            const enderecoCompleto = formatarEnderecoPec({
                tipoLogradouro: { nome: 'Rua' },
                logradouro: 'Graciliano Ramos',
                numero: '145',
                complemento: 'Casa B',
                bairro: 'Vila América',
                municipio: { nome: 'Vitória da Conquista' },
                cep: '45000000'
            });

            assert.equal(
                enderecoCompleto,
                'Rua Graciliano Ramos, Nº 145 - Casa B - Bairro: Vila América - Vitória da Conquista - CEP: 45000000'
            );

            const enderecoSemNumero = formatarEnderecoPec({
                tipoLogradouro: { nome: 'Avenida' },
                logradouro: 'Francisco Sabino',
                semNumero: true,
                bairro: 'Vila América'
            });
            assert.equal(enderecoSemNumero, 'Avenida Francisco Sabino, S/N - Bairro: Vila América');

            assert.equal(formatarEnderecoPec(null, 'Endereço Antigo'), 'Endereço Antigo');
        });

        test('selecionarMelhorCidadao() deve priorizar match por CNS/CPF ou Nome + Nascimento em cadastros ativos', () => {
            const lista = [
                {
                    id: '101',
                    nome: 'ANA CELIA SILVA LESSA',
                    cns: '704600127493222',
                    cpf: '11122233344',
                    dataNascimento: '1961-05-12',
                    ativo: true,
                    faleceu: false
                },
                {
                    id: '102',
                    nome: 'OUTRA PACIENTE',
                    cns: '700000000000000',
                    cpf: '99988877766',
                    dataNascimento: '1980-01-01',
                    ativo: true,
                    faleceu: false
                }
            ];

            const porCns = selecionarMelhorCidadao(lista, { cpfCns: '704600127493222' });
            assert.equal(porCns.id, '101');

            const porNomeEData = selecionarMelhorCidadao(lista, {
                nome: 'Ana Célia Silva Lessa',
                nascimento: '12/05/1961'
            });
            assert.equal(porNomeEData.id, '101');
        });
    });

    describe('Fluxo GraphQL Completo do Cliente PEC (Login, Lotação e Busca de Cadastro Individual)', () => {
        test('autenticar() deve capturar XSRF-TOKEN, tratar UsuarioJaLogadoException com force:true e selecionar lotação', async () => {
            const chamadasGraphql = [];
            let tentativaLogin = 0;

            const mockFetch = async (url, options = {}) => {
                if (options.method === 'GET') {
                    return {
                        ok: true,
                        status: 200,
                        headers: {
                            getSetCookie: () => ['XSRF-TOKEN=token-csrf-123; Path=/; Secure']
                        }
                    };
                }

                const body = JSON.parse(options.body);
                chamadasGraphql.push({
                    url,
                    headers: options.headers,
                    body
                });

                if (body.query.includes('mutation Login')) {
                    tentativaLogin++;
                    if (tentativaLogin === 1) {
                        return {
                            ok: true,
                            status: 200,
                            headers: { getSetCookie: () => [] },
                            json: async () => ({
                                errors: [
                                    {
                                        message: 'Usuário já está logado em outro terminal',
                                        extensions: { classification: 'UsuarioJaLogadoException' }
                                    }
                                ]
                            })
                        };
                    }
                    return {
                        ok: true,
                        status: 200,
                        headers: {
                            getSetCookie: () => ['SESSION=sessao-autenticada-abc; Path=/; HttpOnly']
                        },
                        json: async () => ({
                            data: { login: { success: true } }
                        })
                    };
                }

                if (body.query.includes('query Sessao')) {
                    return {
                        ok: true,
                        status: 200,
                        headers: { getSetCookie: () => [] },
                        json: async () => ({
                            data: {
                                sessao: {
                                    id: 'sess-1',
                                    acesso: null,
                                    profissional: {
                                        id: 'prof-1',
                                        nome: 'PROFISSIONAL USF',
                                        acessos: [
                                            {
                                                id: 'lotacao-vila-america-99',
                                                tipo: 'LOTACAO',
                                                __typename: 'Lotacao',
                                                unidadeSaude: {
                                                    id: 'usf-1',
                                                    nome: 'USF VILA AMERICA',
                                                    cnes: '2400001'
                                                }
                                            }
                                        ]
                                    }
                                }
                            }
                        })
                    };
                }

                if (body.query.includes('mutation SelecionarAcesso')) {
                    return {
                        ok: true,
                        status: 200,
                        headers: { getSetCookie: () => [] },
                        json: async () => ({
                            data: {
                                selecionarAcesso: {
                                    id: 'sess-1',
                                    acesso: { id: body.variables.input.id }
                                }
                            }
                        })
                    };
                }

                throw new Error('Query inesperada no teste');
            };

            const cliente = criarClientePec({
                baseUrl: 'https://esus.vca.ba.wmsaude.com.br',
                fetchImpl: mockFetch
            });

            await cliente.autenticar('123.456.789-00', 'SenhaSegura123');

            assert.equal(chamadasGraphql.length, 4);
            // 1ª chamada: Login sem force e com CPF limpo e header X-XSRF-TOKEN
            assert.equal(chamadasGraphql[0].headers['X-XSRF-TOKEN'], 'token-csrf-123');
            assert.equal(chamadasGraphql[0].headers['Api-Consumer-Id'], 'ESUS_WEB_CLIENT');
            assert.equal(chamadasGraphql[0].body.variables.input.username, '12345678900');
            assert.equal(chamadasGraphql[0].body.variables.input.force, undefined);

            // 2ª chamada: Retry automático com force: true
            assert.equal(chamadasGraphql[1].body.variables.input.force, true);

            // 4ª chamada: Seleção automática da lotação
            assert.equal(chamadasGraphql[3].body.variables.input.id, 'lotacao-vila-america-99');
        });

        test('enriquecerPacientesComPec() deve buscar telefone e endereço no Cadastro Individual do PEC', async () => {
            const mockCliente = {
                async buscarContatoPaciente(p) {
                    if (p.cpf === '704600127493222') {
                        return {
                            encontrado: true,
                            idPec: '5501',
                            telefone: '77988776655',
                            endereco: 'Rua Eva Peron, Nº 268 - Bairro: Vila América - Vitória da Conquista'
                        };
                    }
                    return { encontrado: false };
                }
            };

            const entrada = [
                {
                    nome: 'ANA CELIA SILVA LESSA',
                    cpf: '704600127493222',
                    nascimento: '12/05/1961',
                    telefone: '77900000000',
                    endereco: ''
                },
                {
                    nome: 'PACIENTE NAO ENCONTRADA NO PEC',
                    cpf: '700000000000000',
                    nascimento: '01/01/1980',
                    telefone: '77911112222',
                    endereco: 'Endereço Original'
                }
            ];

            const resultado = await enriquecerPacientesComPec(entrada, {
                clientePec: mockCliente
            });

            assert.equal(resultado.totalAnalisados, 2);
            assert.equal(resultado.totalAtualizados, 1);
            assert.equal(resultado.pacientes[0].telefone, '77988776655');
            assert.equal(
                resultado.pacientes[0].endereco,
                'Rua Eva Peron, Nº 268 - Bairro: Vila América - Vitória da Conquista'
            );
            assert.equal(resultado.pacientes[1].telefone, '77911112222');
            assert.equal(resultado.pacientes[1].endereco, 'Endereço Original');
        });

        test('enriquecerPacientesComPec() deve lançar erro quando exigirCredenciais=true e variáveis estiverem vazias', async () => {
            await assert.rejects(
                async () => {
                    await enriquecerPacientesComPec(
                        [{ nome: 'TESTE', cpf: '123' }],
                        { usuario: '', senha: '', exigirCredenciais: true }
                    );
                },
                /Configure PEC_USUARIO \(CPF\) e PEC_SENHA/
            );
        });
    });
});
