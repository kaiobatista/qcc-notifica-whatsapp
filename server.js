import 'dotenv/config';
import express from 'express';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import jwt from 'jsonwebtoken';
import cron from 'node-cron';
import { automatizarPesquisaLaudo } from './integracao.js'; //[cite: 2]
import { analisarLaudos } from './analisar_laudos.js'; //[cite: 1]

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACIENTES_FILE = path.join(__dirname, 'pacientes.json');

if (!/^[a-fA-F0-9]{64}$/.test(process.env.SECRET_KEY || '')) {
    console.error('CRITICAL ERROR: SECRET_KEY must be a 64-character hexadecimal string in .env.');
    process.exit(1);
}

const SECRET_KEY = Buffer.from(process.env.SECRET_KEY, 'hex');
const IV_LENGTH = 16;

const aguardandoConfirmacao = new Map();

function criptografar(texto) {
    if (!texto) return "";
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', SECRET_KEY, iv);
    let encrypted = cipher.update(texto);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function descriptografar(texto) {
    if (!texto || !texto.includes(':')) return "";
    const textParts = texto.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', SECRET_KEY, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

function descriptografarPaciente(paciente) {
    return {
        ...paciente,
        nome: descriptografar(paciente.nome),
        numero: descriptografar(paciente.numero),
        nascimento: descriptografar(paciente.nascimento),
        cpf: descriptografar(paciente.cpf),
        endereco: descriptografar(paciente.endereco)
    };
}

let pacientes = [];
if (fs.existsSync(PACIENTES_FILE)) {
    try {
        pacientes = JSON.parse(fs.readFileSync(PACIENTES_FILE, 'utf-8'));
    } catch (e) {
        pacientes = [];
    }
}

function salvarPacientes() {
    fs.writeFileSync(PACIENTES_FILE, JSON.stringify(pacientes, null, 2));
}

app.use(express.static(path.join(__dirname, 'public')));

let sock;
async function iniciarWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'error' }),
    });

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) qrcode.generate(qr, { small: true });

        if (connection === 'close') {
            const deveReconectar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (deveReconectar) iniciarWhatsApp();
        } else if (connection === 'open') {
            console.log('\nWHATSAPP CONECTADO COM SUCESSO!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        let remetenteJid = msg.key.remoteJid;

        if (remetenteJid.includes('@lid') && msg.key.remoteJidAlt) {
            console.log(`[DESMASCARANDO] Convertendo LID ${remetenteJid} para o número real: ${msg.key.remoteJidAlt}`);
            remetenteJid = msg.key.remoteJidAlt;
        }

        if (remetenteJid.includes(':')) {
            remetenteJid = remetenteJid.split(':')[0] + '@s.whatsapp.net';
        }

        const textoResposta = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const resposta = textoResposta.trim();

        if (aguardandoConfirmacao.has(remetenteJid)) {
            const dados = aguardandoConfirmacao.get(remetenteJid);

            if (resposta === '1') {
                await sock.sendMessage(remetenteJid, { text: dados.mensagemFinal });
                aguardandoConfirmacao.delete(remetenteJid);

                const index = pacientes.findIndex(p => p.id == dados.idPaciente);
                if (index !== -1) {
                    pacientes[index].status = "Enviado";
                    pacientes[index].dataEnvio = new Date().toLocaleString();
                    salvarPacientes();
                    console.log(`Resultado entregue com sucesso para ${dados.nome}`);
                }

            } else if (resposta === '0') {
                await sock.sendMessage(remetenteJid, { text: "Pedimos desculpas pelo incômodo. Por favor, desconsidere esta mensagem. Iremos atualizar o cadastro na USF." });
                aguardandoConfirmacao.delete(remetenteJid);

                const index = pacientes.findIndex(p => p.id == dados.idPaciente);
                if (index !== -1) {
                    pacientes[index].status = "Número Incorreto";
                    salvarPacientes();
                    console.log(`Número incorreto reportado para o cadastro de ${dados.nome}`);
                }
            } else {
                await sock.sendMessage(remetenteJid, { text: "Por favor, responda apenas com *1* para *Sim* ou *0* para *Não*." });
            }
        }
    });
}

const verificarToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: "Acesso negado. Faça login novamente." });

    jwt.verify(token, process.env.SENHA_PAINEL, (err, decoded) => {
        if (err) return res.status(401).json({ error: "Sessão expirada. O acesso foi resetado." });
        next();
    });
};

// --- ROTAS DO SERVIDOR ---

app.post('/login', (req, res) => {
    const { senha } = req.body;
    if (senha === process.env.SENHA_PAINEL) {
        const token = jwt.sign({ autorizado: true }, process.env.SENHA_PAINEL, { expiresIn: '5m' });
        res.json({ autorizado: true, token });
    } else {
        res.status(401).json({ autorizado: false, error: "Senha incorreta" });
    }
});

app.post('/cadastrar-paciente', verificarToken, (req, res) => {
    const { nome, numero, nascimento, cpf, endereco, unidade } = req.body;

    const novo = {
        id: Date.now(),
        nome: criptografar(nome),
        numero: criptografar(numero),
        nascimento: criptografar(nascimento),
        cpf: criptografar(cpf),
        endereco: criptografar(endereco),
        unidade,
        status: "Pendente",
        dataCadastro: new Date().toLocaleString()
    };

    pacientes.push(novo);
    salvarPacientes();
    res.json({ status: "sucesso" });
});

app.get('/pacientes', verificarToken, (req, res) => {
    const list = pacientes.map(descriptografarPaciente);
    res.json(list);
});

async function dispararMensagemPaciente(p) {
    if (!sock?.user) {
        console.log('WhatsApp não conectado para o disparo automático.');
        return;
    }

    let numeroLimpo = descriptografar(p.numero).replace(/\D/g, '');

    if (!numeroLimpo.startsWith('55')) {
        numeroLimpo = '5577' + numeroLimpo;
    }

    numeroLimpo = '5571991168815'

    if (numeroLimpo.length === 13) {
        const ddd = parseInt(numeroLimpo.substring(2, 4));
        if (ddd > 31) {
            numeroLimpo = numeroLimpo.substring(0, 4) + numeroLimpo.substring(5);
        }
    }

    const jid = `${numeroLimpo}@s.whatsapp.net`;
    const nome = descriptografar(p.nome);

    const msgPergunta = `Olá, esse é o número de contato da ${p.unidade}. Você é *${nome}*?\n[0] - Não\n[1] - Sim`;
    const msgFinal = `Olá, ${nome}! 🌸 O resultado do seu exame preventivo já está disponível na **${p.unidade}**. ✅\n\nConclusão: ${p.conclusao || 'Verificar na unidade'}.\n\nPara continuarmos cuidando da sua saúde, compareça à unidade. 💙`;

    aguardandoConfirmacao.set(jid, {
        idPaciente: p.id,
        nome: nome,
        mensagemFinal: msgFinal
    });

    setTimeout(() => {
        if (aguardandoConfirmacao.has(jid)) {
            aguardandoConfirmacao.delete(jid);
        }
    }, 86400000);

    await sock.sendMessage(jid, { text: msgPergunta });

    p.status = "Aguardando Confirmação";
    salvarPacientes();
    console.log(`[WHATSAPP] Mensagem de confirmação enviada para: ${nome} (${jid})`);
}

// --- FLUXO COMPLETO DE INTEGRAÇÃO (SISCAN + IA + CADASTRO + WHATSAPP) ---
async function executarFluxoCompletoSemanal() {
    console.log('\n[⚙️ INTEGRAÇÃO] Iniciando varredura semanal no SISCAN...');

    // 1. Executa automação para baixar o PDF do SISCAN[cite: 2]
    await automatizarPesquisaLaudo();
    
    const mesAno = process.env.SISCAN_MES_ANO_INICIO || '07/2026';
    const nomeArquivoPdf = `relatorio_laudos_${mesAno.replace('/', '_')}.pdf`;

    if (!fs.existsSync(nomeArquivoPdf)) {
        throw new Error(`O arquivo PDF '${nomeArquivoPdf}' não foi encontrado para análise.`);
    }

    // 2. Analisa o PDF utilizando a IA do Gemini para filtrar atipias[cite: 1]
    const pacientesAtipicos = await analisarLaudos(nomeArquivoPdf);

    if (!pacientesAtipicos || pacientesAtipicos.length === 0) {
        console.log('[⚙️ INTEGRAÇÃO] Nenhum laudo com atipia encontrado nesta execução.');
        return [];
    }

    const cadastrados = [];

    // 3. Cadastra automaticamente os pacientes encontrados no banco local criptografado[cite: 3]
    for (const pacienteAI of pacientesAtipicos) {
        const novoRegistro = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            nome: criptografar(pacienteAI.nome || 'Desconhecido'),
            numero: criptografar(pacienteAI.telefone || ''),
            nascimento: criptografar(''), 
            cpf: criptografar(pacienteAI.cartaoSUS || ''),
            endereco: criptografar(''),
            unidade: process.env.SISCAN_UNIDADE_PADRAO || 'USF Principal',
            conclusao: pacienteAI.conclusao || '',
            status: "Pendente",
            dataCadastro: new Date().toLocaleString()
        };

        pacientes.push(novoRegistro);
        cadastrados.push(novoRegistro);
    }

    salvarPacientes();
    console.log(`[⚙️ INTEGRAÇÃO] ${cadastrados.length} pacientes cadastrados com sucesso no sistema.`);

    // 4. Dispara a mensagem via WhatsApp para os números cadastrados[cite: 3]
    for (const pacienteCadastrado of cadastrados) {
        try {
            await dispararMensagemPaciente(pacienteCadastrado);
        } catch (erroDisparo) {
            console.error(`[❌ ERRO WHATSAPP] Falha ao enviar para o paciente ID ${pacienteCadastrado.id}:`, erroDisparo);
        }
    }

    return cadastrados;
}

app.get('/sincronizar-ministerio', verificarToken, async (req, res) => {
    try {
        const pacientesProcessados = await executarFluxoCompletoSemanal();

        res.json({
            status: "sucesso",
            mensagem: "Sincronização, análise por IA e disparos concluídos com sucesso!",
            totalEncontrados: pacientesProcessados.length,
            dados: pacientesProcessados
        });
    } catch (erro) {
        console.error("Falha ao sincronizar:", erro);
        res.status(500).json({ error: "O portal do Ministério está indisponível ou ocorreu um erro: " + (erro.message || erro) });
    }
});

app.delete('/pacientes/:id', verificarToken, (req, res) => {
    pacientes = pacientes.filter(p => p.id != req.params.id);
    salvarPacientes();
    res.json({ status: "removido" });
});

app.put('/editar-paciente/:id', verificarToken, (req, res) => {
    const { id } = req.params;
    const { nome, numero, nascimento, cpf, endereco, unidade } = req.body;

    const index = pacientes.findIndex(p => p.id == id);

    if (index !== -1) {
        pacientes[index] = {
            ...pacientes[index],
            nome: criptografar(nome),
            numero: criptografar(numero),
            nascimento: criptografar(nascimento),
            cpf: criptografar(cpf),
            endereco: criptografar(endereco),
            unidade
        };

        salvarPacientes();
        res.json({ status: "sucesso" });
    } else {
        res.status(404).json({ error: "Paciente não encontrada" });
    }
});

// --- AGENDAMENTO SEMANAL (CRON) ---
// Roda toda segunda-feira às 03:00 da manhã[cite: 3]
cron.schedule('0 3 * * 1', async () => {
    console.log('\n[⚙️ CRON] Iniciando a varredura automática semanal no SISCAN...');

    try {
        await executarFluxoCompletoSemanal();
        console.log('[⚙️ CRON] Varredura semanal concluída com sucesso.');
    } catch (erro) {
        console.error('[⚙️ CRON] Erro crítico na varredura programada:', erro.message);
    }
});

app.listen(3000, () => {
    console.log('Servidor rodando na porta 3000');
    iniciarWhatsApp();
});