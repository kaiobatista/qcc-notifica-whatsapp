import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Define credenciais e chaves efêmeras exclusivas de teste para isolar a execução
// e impedir o uso ou vazamento de senhas reais do arquivo .env (LGPD / Segurança)
process.env.SECRET_KEY = crypto.randomBytes(32).toString('hex');
process.env.SENHA_PAINEL = `senha_teste_efemera_${crypto.randomBytes(12).toString('hex')}`;
delete process.env.SISCAN_EMAIL;
delete process.env.SISCAN_SENHA;
delete process.env.PEC_USUARIO;
delete process.env.PEC_SENHA;
delete process.env.WHATSAPP_NUMERO_TESTE;

const arquivosPdfTemporarios = new Set();
process.on('exit', () => {
    for (const caminho of arquivosPdfTemporarios) {
        try {
            if (fs.existsSync(caminho)) {
                fs.unlinkSync(caminho);
            }
        } catch {
            // Ignora falhas de limpeza no encerramento do processo
        }
    }
});

export function gerarBufferPdfSintetico(paginasLinhas) {
    const objects = [];
    const addObj = (content) => {
        objects.push(content);
        return objects.length;
    };

    const fontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const pageIds = [];

    for (const lines of paginasLinhas) {
        let y = 780;
        const streamLines = ['BT', '/F1 10 Tf'];
        for (const line of lines) {
            const escaped = String(line)
                .replace(/\\/g, '\\\\')
                .replace(/\(/g, '\\(')
                .replace(/\)/g, '\\)');
            streamLines.push(`1 0 0 1 50 ${y} Tm (${escaped}) Tj`);
            y -= 16;
        }
        streamLines.push('ET');
        const stream = streamLines.join('\n');
        const contentId = addObj(
            `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`
        );
        const pageId = addObj(
            `<< /Type /Page /Parent PAGES_ID 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
        );
        pageIds.push(pageId);
    }

    const kids = pageIds.map((id) => `${id} 0 R`).join(' ');
    const pagesId = addObj(`<< /Type /Pages /Kids [${kids}] /Count ${pageIds.length} >>`);
    const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (let i = 0; i < objects.length; i++) {
        offsets.push(Buffer.byteLength(pdf, 'latin1'));
        const body = objects[i].replace(/PAGES_ID/g, String(pagesId));
        pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    }

    const startxref = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
        pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

    return Buffer.from(pdf, 'latin1');
}

function criarPaginaLaudo({ nome, cartaoSUS, nascimento, telefone, dataColeta = '10/07/2026', dataResultado, conclusao }) {
    return [
        'LAUDO DO EXAME CITOPATOLOGICO DO COLO DE UTERO',
        'UNIDADE DE SAUDE',
        'Nome: USF VILA AMERICA CNES: 6918654',
        `Data da coleta: ${dataColeta} UF: BA Municipio: VITORIA DA CONQUISTA`,
        'PACIENTE',
        `Cartao SUS: ${cartaoSUS} Sexo: Feminino`,
        `Nome: ${nome} Idade: 45`,
        `Data do nascimento: ${nascimento}`,
        `Telefone: ${telefone}`,
        'PRESTADOR DE SERVICO',
        'CONCLUSAO',
        conclusao,
        'RESULTADO EXAME',
        'RESPONSAVEL PELO RESULTADO',
        `Data da liberacao do resultado: ${dataResultado}`
    ];
}

export const PACIENTES_EXEMPLO_5 = [
    {
        nome: 'PACIENTE FICTICIA ALFA',
        cartaoSUS: '700000000000001',
        nascimento: '01/01/1981',
        telefone: '77900000001',
        dataColeta: '15/07/2026',
        dataResultado: '31/07/2026',
        conclusao: 'CELULAS ATIPICAS DE SIGNIFICADO INDETERMINADO: ESCAMOSAS (ASC-US)'
    },
    {
        nome: 'PACIENTE FICTICIA BETA',
        cartaoSUS: '700000000000002',
        nascimento: '02/02/1982',
        telefone: '77900000002',
        dataColeta: '12/07/2026',
        dataResultado: '28/07/2026',
        conclusao: 'LESAO INTRAEPITELIAL DE BAIXO GRAU (LSIL)'
    },
    {
        nome: 'PACIENTE FICTICIA GAMA',
        cartaoSUS: '700000000000003',
        nascimento: '03/03/1983',
        telefone: '77900000003',
        dataColeta: '10/07/2026',
        dataResultado: '25/07/2026',
        conclusao: 'LESAO INTRAEPITELIAL DE ALTO GRAU (HSIL)'
    },
    {
        nome: 'PACIENTE FICTICIA DELTA',
        cartaoSUS: '700000000000004',
        nascimento: '04/04/1984',
        telefone: '7730000004',
        dataColeta: '05/07/2026',
        dataResultado: '20/07/2026',
        conclusao: 'CELULAS ATIPICAS DE SIGNIFICADO INDETERMINADO: ESCAMOSAS (ASC-H)'
    },
    {
        nome: 'PACIENTE FICTICIA EPSILON',
        cartaoSUS: '700000000000005',
        nascimento: '05/05/1985',
        telefone: '77900000005',
        dataColeta: '02/07/2026',
        dataResultado: '18/07/2026',
        conclusao: 'CELULAS GLANDULARES ATIPICAS (AGC)'
    }
];

export const PACIENTES_EXEMPLO_8 = [
    PACIENTES_EXEMPLO_5[0],
    PACIENTES_EXEMPLO_5[1],
    PACIENTES_EXEMPLO_5[2],
    {
        nome: 'PACIENTE FICTICIA ZETA',
        cartaoSUS: '700000000000006',
        nascimento: '06/06/1986',
        telefone: '77900000006',
        dataColeta: '01/06/2026',
        dataResultado: '15/06/2026',
        conclusao: 'LESAO INTRAEPITELIAL DE BAIXO GRAU (LSIL)'
    },
    {
        nome: 'PACIENTE FICTICIA ETA',
        cartaoSUS: '700000000000007',
        nascimento: '07/07/1987',
        telefone: '77900000007',
        dataColeta: '28/05/2026',
        dataResultado: '10/06/2026',
        conclusao: 'CELULAS ATIPICAS DE SIGNIFICADO INDETERMINADO (ASC-US)'
    },
    PACIENTES_EXEMPLO_5[3],
    PACIENTES_EXEMPLO_5[4],
    {
        nome: 'PACIENTE FICTICIA TETA',
        cartaoSUS: '700000000000008',
        nascimento: '08/08/1988',
        telefone: '77900000008',
        dataColeta: '08/05/2026',
        dataResultado: '22/05/2026',
        conclusao: 'LESAO INTRAEPITELIAL DE ALTO GRAU (HSIL)'
    }
];

const PAGINA_LAUDO_NORMAL = criarPaginaLaudo({
    nome: 'PACIENTE RESULTADO NORMAL',
    cartaoSUS: '700000000000099',
    nascimento: '01/01/1990',
    telefone: '77900000099',
    dataResultado: '15/07/2026',
    conclusao: 'DENTRO DOS LIMITES DA NORMALIDADE NO MATERIAL EXAMINADO'
});

export function obterCaminhoOuGerarPdfTeste(_caminhoOriginal, quantidadeAtipicos = 5) {
    const lista = quantidadeAtipicos === 8 ? PACIENTES_EXEMPLO_8 : PACIENTES_EXEMPLO_5;
    const paginas = [...lista.map(criarPaginaLaudo), PAGINA_LAUDO_NORMAL];
    const buffer = gerarBufferPdfSintetico(paginas);
    const destinoTemp = path.join(os.tmpdir(), `fixture_laudos_${quantidadeAtipicos}_atipicos_${process.pid}.pdf`);
    fs.writeFileSync(destinoTemp, buffer, { mode: 0o600 });
    arquivosPdfTemporarios.add(destinoTemp);
    return destinoTemp;
}
