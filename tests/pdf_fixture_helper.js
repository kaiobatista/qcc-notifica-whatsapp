import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Define variáveis de ambiente padrão para que a suíte de testes funcione mesmo sem .env completo
if (!/^[a-fA-F0-9]{64}$/.test(process.env.SECRET_KEY || '')) {
    process.env.SECRET_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
}
if (!process.env.SENHA_PAINEL) {
    process.env.SENHA_PAINEL = 'medicina@uesb';
}

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

function criarPaginaLaudo({ nome, cartaoSUS, nascimento, telefone, dataResultado, conclusao }) {
    return [
        'LAUDO DO EXAME CITOPATOLOGICO DO COLO DE UTERO',
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
        nome: 'ANA CELIA SILVA LESSA',
        cartaoSUS: '704600127493222',
        nascimento: '12/05/1961',
        telefone: '77988230391',
        dataResultado: '31/07/2026',
        conclusao: 'CELULAS ATIPICAS DE SIGNIFICADO INDETERMINADO: ESCAMOSAS (ASC-US)'
    },
    {
        nome: 'ELENILZA SANTOS ALMEIDA NERES',
        cartaoSUS: '700000000000002',
        nascimento: '14/03/1979',
        telefone: '77988230002',
        dataResultado: '28/07/2026',
        conclusao: 'LESAO INTRAEPITELIAL DE BAIXO GRAU (LSIL)'
    },
    {
        nome: 'MARIA CLAUDIA DE JESUS SANTOS',
        cartaoSUS: '700000000000003',
        nascimento: '22/08/1983',
        telefone: '77988230003',
        dataResultado: '25/07/2026',
        conclusao: 'LESAO INTRAEPITELIAL DE ALTO GRAU (HSIL)'
    },
    {
        nome: 'SAMARA DE JESUS SANTOS',
        cartaoSUS: '707001826479335',
        nascimento: '09/01/1975',
        telefone: '7734217217',
        dataResultado: '20/07/2026',
        conclusao: 'CELULAS ATIPICAS DE SIGNIFICADO INDETERMINADO: ESCAMOSAS (ASC-H)'
    },
    {
        nome: 'SILVANA ROCHA OLIVEIRA',
        cartaoSUS: '700000000000005',
        nascimento: '05/11/1988',
        telefone: '77988230005',
        dataResultado: '18/07/2026',
        conclusao: 'CELULAS GLANDULARES ATIPICAS (AGC)'
    }
];

export const PACIENTES_EXEMPLO_8 = [
    PACIENTES_EXEMPLO_5[0],
    PACIENTES_EXEMPLO_5[1],
    PACIENTES_EXEMPLO_5[2],
    {
        nome: 'MARIA LIMA MORAIS',
        cartaoSUS: '700000000000006',
        nascimento: '10/04/1972',
        telefone: '77988230006',
        dataResultado: '15/06/2026',
        conclusao: 'LESAO INTRAEPITELIAL DE BAIXO GRAU (LSIL)'
    },
    {
        nome: 'REBECA DIAS MENEZES DA SILVA',
        cartaoSUS: '700000000000007',
        nascimento: '19/09/1991',
        telefone: '77988230007',
        dataResultado: '10/06/2026',
        conclusao: 'CELULAS ATIPICAS DE SIGNIFICADO INDETERMINADO (ASC-US)'
    },
    PACIENTES_EXEMPLO_5[3],
    PACIENTES_EXEMPLO_5[4],
    {
        nome: 'VANECIA DIAS DOS SANTOS',
        cartaoSUS: '700000000000008',
        nascimento: '03/02/1985',
        telefone: '77988230008',
        dataResultado: '22/05/2026',
        conclusao: 'LESAO INTRAEPITELIAL DE ALTO GRAU (HSIL)'
    }
];

const PAGINA_LAUDO_NORMAL = criarPaginaLaudo({
    nome: 'PACIENTE RESULTADO NORMAL',
    cartaoSUS: '700000000000099',
    nascimento: '01/01/1990',
    telefone: '77988000099',
    dataResultado: '15/07/2026',
    conclusao: 'DENTRO DOS LIMITES DA NORMALIDADE NO MATERIAL EXAMINADO'
});

export function obterCaminhoOuGerarPdfTeste(_caminhoOriginal, quantidadeAtipicos = 5) {
    const lista = quantidadeAtipicos === 8 ? PACIENTES_EXEMPLO_8 : PACIENTES_EXEMPLO_5;
    const paginas = [...lista.map(criarPaginaLaudo), PAGINA_LAUDO_NORMAL];
    const buffer = gerarBufferPdfSintetico(paginas);
    const destinoTemp = path.join(os.tmpdir(), `fixture_laudos_${quantidadeAtipicos}_atipicos.pdf`);
    fs.writeFileSync(destinoTemp, buffer);
    return destinoTemp;
}
