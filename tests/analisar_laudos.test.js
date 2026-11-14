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
                            { str: '704600127493222', transform: [1, 0, 0, 1, 92, 691] },
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
                'PACIENTE\nCartão SUS: 704600127493222 Sexo: Feminino'
            );
        });
    });

    describe('extrairDadosPagina()', () => {
        test('deve extrair todos os campos a partir do formato visual ordenado por linha', () => {
            const textoVisual = [
                'LAUDO DO EXAME CITOPATOLÓGICO DO COLO DE ÚTERO',
                'PACIENTE',
                'Cartão SUS: 704600127493222 Sexo: Feminino',
                'Nome: ANA CELIA SILVA LESSA Idade: 65',
                'Data do nascimento: 12/05/1961 Telefone 988230391',
                'Mãe: ANA E SILVA LESSA',
                'PRESTADOR DE SERVIÇO',
                'RESULTADO EXAME',
                'CONCLUSÃO',
                'CÉLULAS ATÍPICAS DE SIGNIFICADO INDETERMINADO:',
                'ESCAMOSAS: Possivelmente não neoplásicas (ASC-US)',
                'RESPONSÁVEL PELO RESULTADO',
                'Responsável: LUDMILA MOREIRA BARROS',
                'Conselho: CRF - 10224 CNS: 704609612336220 Data da liberação do resultado: 31/07/2026'
            ].join('\n');

            const dados = extrairDadosPagina(textoVisual);
            assert.deepEqual(dados, {
                nome: 'ANA CELIA SILVA LESSA',
                nascimento: '12/05/1961',
                dataResultado: '31/07/2026',
                cartaoSUS: '704600127493222',
                telefone: '988230391',
                conclusao: 'CÉLULAS ATÍPICAS DE SIGNIFICADO INDETERMINADO: ESCAMOSAS: Possivelmente não neoplásicas (ASC-US)'
            });
        });

        test('deve extrair corretamente quando a paciente não possui telefone cadastrado', () => {
            const textoSemTelefone = [
                'PACIENTE',
                'Cartão SUS: 702804620733869 Sexo: Feminino',
                'Nome: JOELANDIA SILVA MEDEIROS DE ABREU Idade: 45',
                'Data do nascimento: 21/08/1980 Telefone',
                'Mãe: EDNALVA SILVA MEDEIROS',
                'PRESTADOR DE SERVIÇO',
                'CONCLUSÃO',
                'NEGATIVO PARA MALIGNIDADE',
                'RESPONSÁVEL PELO RESULTADO',
                'Conselho: CRF - 1458 CNS: 700501522146458 Data da liberação do resultado: 25/07/2026'
            ].join('\n');

            const dados = extrairDadosPagina(textoSemTelefone);
            assert.equal(dados.nome, 'JOELANDIA SILVA MEDEIROS DE ABREU');
            assert.equal(dados.telefone, '');
            assert.equal(dados.nascimento, '21/08/1980');
            assert.equal(dados.dataResultado, '25/07/2026');
        });

        test('deve extrair todos os campos a partir do fluxo bruto do PDF (fallback)', () => {
            const textoBruto = [
                'PACIENTE',
                'Data do recebimento: Município:',
                'SAMARA DE JESUS SANTOS',
                '707001826479335',
                'VCVA071/26',
                'LAUDO DO EXAME CITOPATOLÓGICO DO COLO DE ÚTERO',
                'BA',
                '2407132',
                '09/01/1975',
                'ANITA MARIA DE JESUS',
                'Feminino',
                '34217217',
                'CONCLUSÃO',
                'CÉLULAS ATÍPICAS DE SIGNIFICADO INDETERMINADO:',
                'ESCAMOSAS: Não se pode asfastar lesão de alto grau (ASC-H)',
                'RESULTADO EXAME',
                'RESPONSÁVEL PELO RESULTADO',
                'Responsável:',
                'CNS:\tConselho: Data da liberação do resultado:',
                'LUDMILA MOREIRA BARROS',
                '704609612336220 20/07/2026\tCRF - 10224'
            ].join('\n');

            const dados = extrairDadosPagina(textoBruto);
            assert.deepEqual(dados, {
                nome: 'SAMARA DE JESUS SANTOS',
                nascimento: '09/01/1975',
                dataResultado: '20/07/2026',
                cartaoSUS: '707001826479335',
                telefone: '34217217',
                conclusao: 'CÉLULAS ATÍPICAS DE SIGNIFICADO INDETERMINADO: ESCAMOSAS: Não se pode asfastar lesão de alto grau (ASC-H)'
            });
        });

        test('deve retornar null para entradas vazias ou texto sem dados de laudo', () => {
            assert.equal(extrairDadosPagina(''), null);
            assert.equal(extrairDadosPagina(null), null);
            assert.equal(extrairDadosPagina('Texto aleatório sem estrutura de laudo'), null);
        });
    });

    describe('analisarLaudos() em arquivos PDF reais', () => {
        test('deve extrair localmente as 8 pacientes com atipia do relatório 05/2026 a 08/2026 sem uso de IA', async () => {
            const caminhoPdf = path.join(ROOT_DIR, 'relatorio_laudos_05_2026_a_08_2026.pdf');
            const pacientes = await analisarLaudos(caminhoPdf);

            assert.equal(pacientes.length, 8);

            const nomesExtraidos = pacientes.map(p => p.nome);
            assert.deepEqual(nomesExtraidos, [
                'ANA CELIA SILVA LESSA',
                'ELENILZA SANTOS ALMEIDA NERES',
                'MARIA CLAUDIA DE JESUS SANTOS',
                'MARIA LIMA MORAIS',
                'REBECA DIAS MENEZES DA SILVA',
                'SAMARA DE JESUS SANTOS',
                'SILVANA ROCHA OLIVEIRA',
                'VANECIA DIAS DOS SANTOS'
            ]);

            for (const p of pacientes) {
                assert.ok(p.nome.length > 0);
                assert.match(p.nascimento, /^\d{2}\/\d{2}\/\d{4}$/);
                assert.match(p.dataResultado, /^\d{2}\/\d{2}\/\d{4}$/);
                assert.match(p.cartaoSUS, /^\d{15}$/);
                assert.match(p.telefone, /^\d{8,11}$/);
                assert.equal(possuiAtipia(p.conclusao), true);
            }
        });

        test('deve extrair localmente as 5 pacientes com atipia do relatório 07/2026 (aceitando caminho ou Buffer)', async () => {
            const caminhoPdf = path.join(ROOT_DIR, 'relatorio_laudos_07_2026.pdf');
            const bufferPdf = fs.readFileSync(caminhoPdf);
            const pacientes = await analisarLaudos(bufferPdf);

            assert.equal(pacientes.length, 5);
            assert.deepEqual(
                pacientes.map(p => p.nome),
                [
                    'ANA CELIA SILVA LESSA',
                    'ELENILZA SANTOS ALMEIDA NERES',
                    'MARIA CLAUDIA DE JESUS SANTOS',
                    'SAMARA DE JESUS SANTOS',
                    'SILVANA ROCHA OLIVEIRA'
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
