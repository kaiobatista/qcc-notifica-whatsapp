import fs from 'fs';
import { PDFParse } from 'pdf-parse';

const PADRAO_ATIPIA = /\b(?:at[ií]pi(?:a|as|ca|cas)|asc-us|asc-h|lsil|hsil|agc|baixo\s+grau|alto\s+grau|les[aã]o\s+intraepitelial|carcinoma|adenocarcinoma)\b/i;

export function possuiAtipia(conclusao) {
    if (!conclusao || typeof conclusao !== 'string') {
        return false;
    }
    return PADRAO_ATIPIA.test(conclusao);
}

export async function extrairTextoOrdenadoPagina(page) {
    const textContent = await page.getTextContent();
    const linhas = [];

    for (const item of textContent.items || []) {
        if (!item || typeof item.str !== 'string' || !item.str.trim()) {
            continue;
        }
        const x = Array.isArray(item.transform) ? item.transform[4] : 0;
        const y = Array.isArray(item.transform) ? item.transform[5] : 0;

        let linhaExistente = linhas.find(l => Math.abs(l.y - y) <= 3);
        if (!linhaExistente) {
            linhaExistente = { y, itens: [] };
            linhas.push(linhaExistente);
        }
        linhaExistente.itens.push({ x, str: item.str.trim() });
    }

    linhas.sort((a, b) => b.y - a.y);

    return linhas
        .map(linha => linha.itens.sort((a, b) => a.x - b.x).map(i => i.str).join(' '))
        .join('\n');
}

export function extrairDadosPagina(textoPagina) {
    if (!textoPagina || typeof textoPagina !== 'string') {
        return null;
    }

    let nome = '';
    let cartaoSUS = '';
    let nascimento = '';
    let telefone = '';
    let dataColeta = '';
    let dataResultado = '';
    let conclusao = '';

    // 1. Tenta extrair a partir do formato visual ordenado linha a linha
    const secaoPacienteMatch = textoPagina.match(/PACIENTE([\s\S]*?)PRESTADOR DE SERVI[ÇC]O/i);
    if (secaoPacienteMatch) {
        const secaoPaciente = secaoPacienteMatch[1];
        const nomeMatch = secaoPaciente.match(/Nome:\s*(.+?)(?:\s+Idade:|\s*$)/im);
        const susMatch = secaoPaciente.match(/Cart[ãa]o SUS:\s*(\d{15})/i);
        const nascMatch = secaoPaciente.match(/Data do nascimento:\s*(\d{2}\/\d{2}\/\d{4})/i);
        const telMatch = secaoPaciente.match(/Telefone:?\s*([0-9()\-\s]{8,})?(?:\s*$|\n)/im);

        if (nomeMatch && !nomeMatch[1].startsWith('Data do nascimento:')) {
            nome = nomeMatch[1].trim();
        }
        if (susMatch) {
            cartaoSUS = susMatch[1].trim();
        }
        if (nascMatch) {
            nascimento = nascMatch[1].trim();
        }
        if (telMatch && telMatch[1]) {
            telefone = telMatch[1].replace(/\D/g, '');
        }
    }

    // 2. Fallback para o formato de fluxo bruto (ex.: PDFParse.getText())
    if (!nome || !cartaoSUS) {
        const blocoBrutoMatch = textoPagina.match(/Data do recebimento:\s*Munic[íi]pio:\s*\n([^\n]+)\n(\d{15})/i);
        if (blocoBrutoMatch) {
            nome = nome || blocoBrutoMatch[1].trim();
            cartaoSUS = cartaoSUS || blocoBrutoMatch[2].trim();
        }
    }

    if (!nascimento) {
        const nascTelBrutoMatch = textoPagina.match(/\n(\d{2}\/\d{2}\/\d{4})\n[^\n]+\n(?:Feminino|Masculino)\n(?:(\d{8,11})\n)?/i);
        if (nascTelBrutoMatch) {
            nascimento = nascTelBrutoMatch[1].trim();
            if (!telefone && nascTelBrutoMatch[2]) {
                telefone = nascTelBrutoMatch[2].trim();
            }
        }
    }

    const dataColDiretaMatch = textoPagina.match(/Data da coleta:\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (dataColDiretaMatch) {
        dataColeta = dataColDiretaMatch[1].trim();
    } else {
        const dataColBrutaMatch =
            textoPagina.match(/\n[A-Z]{2}[\t ]+(\d{2}\/\d{2}\/\d{4})\n\d{6,8}\n/i) ||
            textoPagina.match(/Data da coleta:[\s\S]*?\b(\d{2}\/\d{2}\/\d{4})\b/i);
        if (dataColBrutaMatch) {
            dataColeta = dataColBrutaMatch[1].trim();
        }
    }

    const dataResDiretaMatch = textoPagina.match(/Data da libera[çc][ãa]o do resultado:\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (dataResDiretaMatch) {
        dataResultado = dataResDiretaMatch[1].trim();
    } else {
        const dataResBrutaMatch = textoPagina.match(/Data da libera[çc][ãa]o do resultado:[\s\S]*?\b(\d{2}\/\d{2}\/\d{4})\b/i);
        if (dataResBrutaMatch) {
            dataResultado = dataResBrutaMatch[1].trim();
        }
    }

    const conclusaoMatch =
        textoPagina.match(/CONCLUS[ÃA]O\s*\n([\s\S]*?)\n(?:RESULTADO EXAME|RESPONS[ÁA]VEL PELO RESULTADO)/i) ||
        textoPagina.match(/DIAGN[ÓO]STICO DESCRITIVO:?\s*\n([\s\S]*?)\n(?:RESULTADO EXAME|RESPONS[ÁA]VEL PELO RESULTADO)/i);

    if (conclusaoMatch) {
        conclusao = conclusaoMatch[1].replace(/\s+/g, ' ').trim();
    }

    if (!nome && !cartaoSUS && !conclusao) {
        return null;
    }

    return {
        nome,
        nascimento,
        dataColeta,
        dataResultado,
        cartaoSUS,
        telefone,
        conclusao
    };
}

export async function analisarLaudos(caminhoPdf) {
    let parser = null;
    try {
        const pdfBuffer = Buffer.isBuffer(caminhoPdf) ? caminhoPdf : fs.readFileSync(caminhoPdf);
        parser = new PDFParse({ data: pdfBuffer });

        const textosPaginas = [];

        if (typeof parser.load === 'function') {
            const doc = await parser.load();
            for (let numPagina = 1; numPagina <= doc.numPages; numPagina++) {
                const page = await doc.getPage(numPagina);
                const textoOrdenado = await extrairTextoOrdenadoPagina(page);
                textosPaginas.push(textoOrdenado);
                if (typeof page.cleanup === 'function') {
                    page.cleanup();
                }
            }
        } else {
            const resultado = await parser.getText();
            for (const pagina of resultado.pages || []) {
                textosPaginas.push(pagina.text);
            }
        }

        const pacientesExtraidos = [];
        for (const textoPagina of textosPaginas) {
            const dados = extrairDadosPagina(textoPagina);
            if (dados && possuiAtipia(dados.conclusao)) {
                pacientesExtraidos.push(dados);
            }
        }

        console.log(`--- EXTRAÇÃO LOCAL CONCLUÍDA: ${pacientesExtraidos.length} PACIENTES COM ATIPIA ---`);
        return pacientesExtraidos;
    } catch (error) {
        console.error('Erro ao processar laudos localmente:', error);
        return [];
    } finally {
        if (parser && typeof parser.destroy === 'function') {
            await parser.destroy().catch(() => {});
        }
    }
}
