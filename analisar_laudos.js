import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function analisarLaudos(caminhoPdf) {
    try {
        const pdfBuffer = fs.readFileSync(caminhoPdf);
        const pdfBase64 = pdfBuffer.toString('base64');

        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-lite',
            contents: [
                {
                    inlineData: {
                        mimeType: 'application/pdf',
                        data: pdfBase64
                    }
                },
                {
                    text: `Analise este relatório de laudos em PDF. 
                    Filtre apenas as pacientes cuja CONCLUSÃO contenha termos como "atipia" ou "atípica" (incluindo variações como ASC-US, ASC-H ou baixo/alto grau). 
                    Para cada paciente encontrada, extraia estritamente e retorne um array JSON puro (sem blocos markdown de formatação se possível) contendo objetos com as seguintes chaves exatas: 
                    - "nome" (string)
                    - "nascimento" (string)
                    - "dataResultado" (string)
                    - "cartaoSUS" (string)
                    - "telefone" (string)
                    - "conclusao" (string)`
                }
            ]
        });

        let textoResposta = response.text.trim();
        
        if (textoResposta.startsWith('```json')) {
            textoResposta = textoResposta.replace(/^```json/, '').replace(/```$/, '').trim();
        } else if (textoResposta.startsWith('```')) {
            textoResposta = textoResposta.replace(/^```/, '').replace(/```$/, '').trim();
        }

        const pacientesExtraidos = JSON.parse(textoResposta);
        console.log(`--- IA EXTRAIU ${pacientesExtraidos.length} PACIENTES COM ATIPIS ---`);
        return pacientesExtraidos;

    } catch (error) {
        console.error('Erro ao processar laudos com a IA:', error);
        return [];
    }
}