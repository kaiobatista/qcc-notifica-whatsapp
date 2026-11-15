import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    possuiAtipia,
    extrairTextoOrdenadoPagina,
    extrairDadosPagina,
    analisarLaudos
} from '../analisar_laudos.js';
import { obterCaminhoOuGerarPdfTeste } from './pdf_fixture_helper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

describe('Módulo de Extração Local de Laudos (analisar_laudos.js - LGPD)', () => {
    describe('possuiAtipia()', () => {
        test('deve retornar true para conclusões com ASC-US, ASC-H, LSIL, HSIL ou termos de atipia', () => {
            assert.equal(
                possuiAtipia('CÉLULAS ATÍPICAS DE SIGNIFICADO INDETERMINADO: ESCAMOSAS: Possivelmente não neoplásicas (ASC-US)'),
                true
            );
            assert.equal(
                possuiAtipia('CÉLULAS ATÍPICAS DE SIGNIFICADO INDETERMINADO: ESCAMOSAS: Não se pode asfastar lesão de alto grau (ASC-H)'),
                true
            );
            assert.equal(
                possuiAtipia('ATIPIAS EM CÉLULAS ESCAMOSAS: Lesão intraepitelial de baixo grau (compreendendo o efeito citopático pelo HPV e neoplasia intraepitelial cervical grau I)'),
                true
            );
            assert.equal(
                possuiAtipia('Lesão intraepitelial de alto grau (HSIL)'),
                true
            );
            assert.equal(
                possuiAtipia('Atipias em células glandulares (AGC)'),
                true
            );
            assert.equal(
                possuiAtipia('Carcinoma epidermóide invasor'),
                true
            );
        });

        test('deve retornar false para conclusões normais, benignas ou entradas inválidas', () => {
            assert.equal(possuiAtipia('NEGATIVO PARA MALIGNIDADE'), false);
            assert.equal(
                possuiAtipia('NEGATIVO PARA MALIGNIDADE OBSERVAÇÕES: PROCESSO INFLAMATORIO ACENTUADO.'),
                false
            );
            assert.equal(
                possuiAtipia('DENTRO DOS LIMITES DA NORMALIDADE NO MATERIAL EXAMINADO MICROBIOLOGIA: Lactobacillus sp.'),
                false
            );
            assert.equal(possuiAtipia(''), false);
            assert.equal(possuiAtipia(null), false);
            assert.equal(possuiAtipia(undefined), false);
        });
    });

    describe('extrairTextoOrdenadoPagina()', () => {
        test('deve ordenar itens de texto de cima para baixo (Y decrescente) e da esquerda para a direita (X crescente)', async () => {
            const paginaMock = {
                async getTextContent() {
                    return {
                        items: [
                            { str: 'Feminino', transform: [1, 0, 0, 1, 344, 690] },
                            { str: 'Cartão SUS:', transform: [1, 0, 0, 1, 31, 690] },
                            { str: '700000000000001', transform: [1, 0, 0, 1, 92, 691] },
                            { str: 'Sexo:', transform: [1, 0, 0, 1, 312, 690] },
                            { str: 'PACIENTE', transform: [1, 0, 0, 1, 31, 703] },
                            { str: '   ', transform: [1, 0, 0, 1, 10, 800] }
                        ]
                    };
                }
            };

            const texto = await extrairTextoOrdenadoPagina(paginaMock);
            assert.equal(
                texto,
                'PACIENTE\nCartão SUS: 700000000000001 Sexo: Feminino'
            );
        });
    });

    describe('extrairDadosPagina()', () => {
        test('deve extrair todos os campos a partir do formato visual ordenado por linha', () => {
            const textoVisual = [
                'LAUDO DO EXAME CITOPATOLÓGICO DO COLO DE ÚTERO',
                'UNIDADE DE SAÚDE',
                'Nome: USF UNIDADE EXEMPLO TESTE CNES: 0000001',
                'Data da coleta: 08/07/2026 UF: BA Município: VITORIA DA CONQUISTA',
                'PACIENTE',
                'Cartão SUS: 700000000000001 Sexo: Feminino',
                'Nome: PACIENTE FICTICIA ALFA Idade: 45',
                'Data do nascimento: 01/01/1981 Telefone 900000001',
                'Mãe: MAE FICTICIA ALFA',
                'PRESTADOR DE SERVIÇO',
                'RESULTADO EXAME',
                'CONCLUSÃO',
                'CÉLULAS ATÍPICAS DE SIGNIFICADO INDETERMINADO:',
                'ESCAMOSAS: Possivelmente não neoplásicas (ASC-US)',
                'RESPONSÁVEL PELO RESULTADO',
                'Responsável: PROFISSIONAL FICTICIO TESTE',
                'Conselho: CRF - 00000 CNS: 700000000000090 Data da liberação do resultado: 31/07/2026'
            ].join('\n');

            const dados = extrairDadosPagina(textoVisual);
            assert.deepEqual(dados, {
                nome: 'PACIENTE FICTICIA ALFA',
                nascimento: '01/01/1981',
                dataColeta: '08/07/2026',
                dataResultado: '31/07/2026',
                cartaoSUS: '700000000000001',
                telefone: '900000001',
                conclusao: 'CÉLULAS ATÍPICAS DE SIGNIFICADO INDETERMINADO: ESCAMOSAS: Possivelmente não neoplásicas (ASC-US)'
            });
        });

        test('deve extrair corretamente quando a paciente não possui telefone cadastrado', () => {
            const textoSemTelefone = [
                'PACIENTE',
                'Cartão SUS: 700000000000010 Sexo: Feminino',
                'Nome: PACIENTE FICTICIA SEM TELEFONE Idade: 45',
                'Data do nascimento: 21/08/1980 Telefone',
                'Mãe: MAE FICTICIA BETA',
                'PRESTADOR DE SERVIÇO',
                'CONCLUSÃO',
                'NEGATIVO PARA MALIGNIDADE',
                'RESPONSÁVEL PELO RESULTADO',
                'Conselho: CRF - 00000 CNS: 700000000000090 Data da liberação do resultado: 25/07/2026'
            ].join('\n');

            const dados = extrairDadosPagina(textoSemTelefone);
            assert.equal(dados.nome, 'PACIENTE FICTICIA SEM TELEFONE');
            assert.equal(dados.telefone, '');
            assert.equal(dados.nascimento, '21/08/1980');
            assert.equal(dados.dataColeta, '');
            assert.equal(dados.dataResultado, '25/07/2026');
        });

        test('deve extrair todos os campos a partir do fluxo bruto do PDF (fallback)', () => {
            const textoBruto = [
                'UNIDADE DE SAÚDE',
                'USF UNIDADE EXEMPLO TESTE',
                'BA\t05/07/2026',
                '0000001',
                'PACIENTE',
                'Data do recebimento: Município:',
                'PACIENTE FICTICIA DELTA',
                '700000000000004',
                'VCVA071/26',
                'LAUDO DO EXAME CITOPATOLÓGICO DO COLO DE ÚTERO',
                'BA',
                '2407132',
                '04/04/1984',
                'MAE FICTICIA DELTA',
                'Feminino',
                '30000004',
                'CONCLUSÃO',
                'CÉLULAS ATÍPICAS DE SIGNIFICADO INDETERMINADO:',
                'ESCAMOSAS: Não se pode asfastar lesão de alto grau (ASC-H)',
                'RESULTADO EXAME',
                'RESPONSÁVEL PELO RESULTADO',
                'Responsável:',
                'CNS:\tConselho: Data da liberação do resultado:',
                'PROFISSIONAL FICTICIO TESTE',
                '700000000000090 20/07/2026\tCRF - 00000'
            ].join('\n');

            const dados = extrairDadosPagina(textoBruto);
            assert.deepEqual(dados, {
                nome: 'PACIENTE FICTICIA DELTA',
                nascimento: '04/04/1984',
                dataColeta: '05/07/2026',
                dataResultado: '20/07/2026',
                cartaoSUS: '700000000000004',
                telefone: '30000004',
                conclusao: 'CÉLULAS ATÍPICAS DE SIGNIFICADO INDETERMINADO: ESCAMOSAS: Não se pode asfastar lesão de alto grau (ASC-H)'
            });
        });

        test('deve retornar null para entradas vazias ou texto sem dados de laudo', () => {
            assert.equal(extrairDadosPagina(''), null);
            assert.equal(extrairDadosPagina(null), null);
            assert.equal(extrairDadosPagina('Texto aleatório sem estrutura de laudo'), null);
        });
    });

    describe('analisarLaudos() em arquivos PDF sintéticos de teste', () => {
        test('deve extrair localmente as 8 pacientes com atipia do relatório 05/2026 a 08/2026 sem uso de IA', async () => {
            const caminhoPdf = obterCaminhoOuGerarPdfTeste(
                path.join(ROOT_DIR, 'relatorio_laudos_05_2026_a_08_2026.pdf'),
                8
            );
            const pacientes = await analisarLaudos(caminhoPdf);

            assert.equal(pacientes.length, 8);

            const nomesExtraidos = pacientes.map(p => p.nome);
            assert.deepEqual(nomesExtraidos, [
                'PACIENTE FICTICIA ALFA',
                'PACIENTE FICTICIA BETA',
                'PACIENTE FICTICIA GAMA',
                'PACIENTE FICTICIA ZETA',
                'PACIENTE FICTICIA ETA',
                'PACIENTE FICTICIA DELTA',
                'PACIENTE FICTICIA EPSILON',
                'PACIENTE FICTICIA TETA'
            ]);

            for (const p of pacientes) {
                assert.ok(p.nome.length > 0);
                assert.match(p.nascimento, /^\d{2}\/\d{2}\/\d{4}$/);
                assert.match(p.dataColeta, /^\d{2}\/\d{2}\/\d{4}$/);
                assert.match(p.dataResultado, /^\d{2}\/\d{2}\/\d{4}$/);
                assert.match(p.cartaoSUS, /^\d{15}$/);
                assert.match(p.telefone, /^\d{8,11}$/);
                assert.equal(possuiAtipia(p.conclusao), true);
            }
        });

        test('deve extrair localmente as 5 pacientes com atipia do relatório 07/2026 (aceitando caminho ou Buffer)', async () => {
            const caminhoPdf = obterCaminhoOuGerarPdfTeste(
                path.join(ROOT_DIR, 'relatorio_laudos_07_2026.pdf'),
                5
            );
            const bufferPdf = fs.readFileSync(caminhoPdf);
            const pacientes = await analisarLaudos(bufferPdf);

            assert.equal(pacientes.length, 5);
            assert.deepEqual(
                pacientes.map(p => p.nome),
                [
                    'PACIENTE FICTICIA ALFA',
                    'PACIENTE FICTICIA BETA',
                    'PACIENTE FICTICIA GAMA',
                    'PACIENTE FICTICIA DELTA',
                    'PACIENTE FICTICIA EPSILON'
                ]
            );
        });

        test('deve retornar array vazio caso o arquivo PDF não exista ou seja inválido', async () => {
            const resultadoInexistente = await analisarLaudos('arquivo_que_nao_existe_12345.pdf');
            assert.deepEqual(resultadoInexistente, []);

            const resultadoInvalido = await analisarLaudos(Buffer.from('conteudo invalido nao pdf'));
            assert.deepEqual(resultadoInvalido, []);
        });

        test('não deve depender de chave de API externa (GEMINI_API_KEY) nem do pacote @google/genai (LGPD)', async () => {
            const codigoFonte = fs.readFileSync(path.join(ROOT_DIR, 'analisar_laudos.js'), 'utf-8');
            assert.equal(codigoFonte.includes('@google/genai'), false);
            assert.equal(codigoFonte.includes('GEMINI_API_KEY'), false);
        });
    });
});
