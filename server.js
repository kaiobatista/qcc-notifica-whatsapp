import 'dotenv/config';
import express from 'express';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import jwt from 'jsonwebtoken';
import cron from 'node-cron';
import { automatizarPesquisaLaudo } from './integracao.js'; 
import { analisarLaudos } from './analisar_laudos.js'; 
import { enriquecerPacientesComPec } from './integracao_pec.js'; 

const require = createRequire(import.meta.url);
const QRCode = require('qrcode-terminal/vendor/QRCode');
const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));

// Middleware de Cabeçalhos de Segurança HTTP e Proteção de Cache (LGPD Art. 46)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    if (
        req.path.startsWith('/pacientes') ||
        req.path.startsWith('/login') ||
        req.path.startsWith('/status-sistema') ||
        req.path.startsWith('/whatsapp') ||
        req.path.startsWith('/configurar-envios-whatsapp') ||
        req.path.startsWith('/cadastrar-paciente') ||
        req.path.startsWith('/editar-paciente') ||
        req.path.startsWith('/sincronizar-') ||
        req.path.startsWith('/enviar-notificac') ||
        req.path.startsWith('/importar-pdf-laudos')
    ) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
    }
    next();
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let caminhoArquivoPacientes = path.join(__dirname, 'pacientes.json');

if (!/^[a-fA-F0-9]{64}$/.test(process.env.SECRET_KEY || '')) {
    console.error('CRITICAL ERROR: SECRET_KEY must be a 64-character hexadecimal string in .env.');
    process.exit(1);
}

const SECRET_KEY = Buffer.from(process.env.SECRET_KEY, 'hex');
const IV_LENGTH = 16;

export const aguardandoConfirmacao = new Map();
export const tentativasLogin = new Map();
const MAX_TENTATIVAS_LOGIN = 5;
const JANELA_BLOQUEIO_LOGIN_MS = 15 * 60 * 1000;

export function limparTentativasLogin() {
    tentativasLogin.clear();
}

export function compararSenhasSeguro(senhaInformada, senhaEsperada) {
    if (typeof senhaInformada !== 'string' || typeof senhaEsperada !== 'string' || !senhaEsperada) {
        return false;
    }
    const hashInformada = crypto.createHash('sha256').update(senhaInformada).digest();
    const hashEsperada = crypto.createHash('sha256').update(senhaEsperada).digest();
    return crypto.timingSafeEqual(hashInformada, hashEsperada);
}

export function mascararDadoSensivel(valor) {
    if (!valor || typeof valor !== 'string') return '***';
    const limpo = valor.trim();
    if (limpo.includes('@')) {
        const [user, domain] = limpo.split('@');
        if (user.length <= 4) return `***@${domain}`;
        return `${user.slice(0, 4)}****${user.slice(-2)}@${domain}`;
    }
    if (limpo.length <= 4) return '***';
    return `${limpo.slice(0, 3)}***${limpo.slice(-2)}`;
}

export function criptografar(texto) {
    if (!texto) return "";
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', SECRET_KEY, iv);
    let encrypted = cipher.update(String(texto));
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function descriptografar(texto) {
    // Se estiver vazio ou não for string, retorna vazio
    if (!texto || typeof texto !== 'string') return "";
    
    // Regex que verifica se o formato é EXATAMENTE o da nossa criptografia 
    // (32 letras/números hexadecimais + ':' + restante hexadecimal)
    const regexCriptografia = /^[a-f0-9]{32}:[a-f0-9]+$/;
    
    if (!regexCriptografia.test(texto)) {
        // Se não passar no teste rigoroso, significa que é um texto puro legado do banco antigo.
        return texto; 
    }

    try {
        const textParts = texto.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', SECRET_KEY, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        return texto;
    }
}

export function classificarPrioridadeClinica(conclusao) {
    if (!conclusao || typeof conclusao !== 'string') return 'Rotina';
    const texto = conclusao.toLowerCase();

    if (
        /\b(?:hsil|asc-h|agc|alto\s+grau|n[aã]o\s+se\s+pode\s+afastar\s+alto\s+grau|carcinoma|adenocarcinoma|glandulares|invasor)\b/i.test(texto)
    ) {
        return 'Alta';
    }

    if (
        /\b(?:lsil|asc-us|baixo\s+grau|at[ií]pi(?:a|as|ca|cas)|les[aã]o\s+intraepitelial)\b/i.test(texto)
    ) {
        return 'Moderada';
    }

    return 'Rotina';
}

export function descriptografarPaciente(paciente) {
    const conclusaoLimpa = descriptografar(paciente.conclusao) || 'Aguardando laudo...';
    return {
        ...paciente,
        nome: descriptografar(paciente.nome),
        numero: descriptografar(paciente.numero),
        nascimento: descriptografar(paciente.nascimento),
        cpf: descriptografar(paciente.cpf),
        endereco: descriptografar(paciente.endereco),
        dataResultado: descriptografar(paciente.dataResultado) || '',
        conclusao: conclusaoLimpa,
        observacoes: descriptografar(paciente.observacoes) || '',
        prioridade: classificarPrioridadeClinica(conclusaoLimpa)
    };
}

export function calcularEstatisticasPacientes(listaPacientes = []) {
    const lista = Array.isArray(listaPacientes) ? listaPacientes : [];
    const stats = {
        total: lista.length,
        pendentes: 0,
        aguardandoConfirmacao: 0,
        enviados: 0,
        compareceram: 0,
        buscaAtiva: 0,
        numeroIncorreto: 0,
        semTelefone: 0,
        prioridadeAlta: 0,
        prioridadeModerada: 0
    };

    for (const p of lista) {
        const status = p.status || 'Pendente';
        if (status === 'Pendente') stats.pendentes++;
        else if (status === 'Aguardando Confirmação') stats.aguardandoConfirmacao++;
        else if (status === 'Enviado') stats.enviados++;
        else if (status === 'Compareceu à USF') stats.compareceram++;
        else if (status === 'Busca Ativa (ACS)') stats.buscaAtiva++;
        else if (status === 'Número Incorreto') stats.numeroIncorreto++;

        const digitosFone = String(p.numero || '').replace(/\D/g, '');
        if (digitosFone.length < 8) {
            stats.semTelefone++;
        }

        const prio = p.prioridade || classificarPrioridadeClinica(p.conclusao);
        if (prio === 'Alta') stats.prioridadeAlta++;
        else if (prio === 'Moderada') stats.prioridadeModerada++;
    }

    return stats;
}

export function converterDataBrParaTimestamp(dataStr) {
    if (!dataStr || typeof dataStr !== 'string') return null;
    const match = dataStr.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    const dia = Number(match[1]);
    const mes = Number(match[2]);
    const ano = Number(match[3]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    return Date.UTC(ano, mes - 1, dia);
}

export function ordenarPacientes(lista, criterio = 'dataResultado', ordem) {
    if (!Array.isArray(lista)) return [];
    const criterioNormalizado = ['dataResultado', 'nascimento', 'nome', 'status', 'cadastro', 'prioridade'].includes(criterio)
        ? criterio
        : 'dataResultado';
    const ordemPadrao = (criterioNormalizado === 'nome' || criterioNormalizado === 'status') ? 'asc' : 'desc';
    const direcao = (ordem === 'asc' || ordem === 'desc') ? ordem : ordemPadrao;
    const pesoPrioridade = { Alta: 3, Moderada: 2, Rotina: 1 };

    return [...lista].sort((a, b) => {
        if (criterioNormalizado === 'prioridade') {
            const pA = pesoPrioridade[a.prioridade || classificarPrioridadeClinica(a.conclusao)] || 1;
            const pB = pesoPrioridade[b.prioridade || classificarPrioridadeClinica(b.conclusao)] || 1;
            if (pA !== pB) return direcao === 'asc' ? pA - pB : pB - pA;
            const tsA = converterDataBrParaTimestamp(a.dataResultado) || 0;
            const tsB = converterDataBrParaTimestamp(b.dataResultado) || 0;
            return tsB - tsA;
        }

        if (criterioNormalizado === 'dataResultado' || criterioNormalizado === 'nascimento') {
            const tsA = converterDataBrParaTimestamp(a[criterioNormalizado]);
            const tsB = converterDataBrParaTimestamp(b[criterioNormalizado]);

            if (tsA === null && tsB === null) {
                return (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' });
            }
            if (tsA === null) return 1;
            if (tsB === null) return -1;
            if (tsA !== tsB) {
                return direcao === 'asc' ? tsA - tsB : tsB - tsA;
            }
            return (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' });
        }

        if (criterioNormalizado === 'nome') {
            const cmp = (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' });
            return direcao === 'asc' ? cmp : -cmp;
        }

        if (criterioNormalizado === 'status') {
            const cmp = (a.status || '').localeCompare(b.status || '', 'pt-BR', { sensitivity: 'base' });
            if (cmp !== 0) return direcao === 'asc' ? cmp : -cmp;
            return (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' });
        }

        const idA = Number(a.id) || 0;
        const idB = Number(b.id) || 0;
        return direcao === 'asc' ? idA - idB : idB - idA;
    });
}

function normalizarNomeComparacao(nome) {
    if (!nome || typeof nome !== 'string') return '';
    return nome
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizarDocumentoComparacao(doc) {
    if (!doc || typeof doc !== 'string') return '';
    const digitos = doc.replace(/\D/g, '');
    return digitos.length >= 11 ? digitos : '';
}

function EnderecoValido(end) {
    if (!end || typeof end !== 'string') return false;
    const limpo = end.trim();
    return limpo.length > 0 && !/n[aã]o\s+consta|n[aã]o\s+informad/i.test(limpo);
}

const PESO_STATUS = {
    'Compareceu à USF': 6,
    'Enviado': 5,
    'Busca Ativa (ACS)': 4,
    'Aguardando Confirmação': 3,
    'Número Incorreto': 2,
    'Pendente': 1
};

export function deduplicarPacientes(listaCriptografada) {
    if (!Array.isArray(listaCriptografada) || listaCriptografada.length <= 1) {
        return Array.isArray(listaCriptografada) ? listaCriptografada : [];
    }

    const consolidadosLimpos = [];

    for (const reg of listaCriptografada) {
        const atual = descriptografarPaciente(reg);
        const nomeNorm = normalizarNomeComparacao(atual.nome);
        const docNorm = normalizarDocumentoComparacao(atual.cpf);

        const idx = consolidadosLimpos.findIndex((item) => {
            const itemDoc = normalizarDocumentoComparacao(item.limpo.cpf);
            const itemNome = normalizarNomeComparacao(item.limpo.nome);
            const mesmoDoc = docNorm && itemDoc && docNorm === itemDoc;
            const mesmoNome = nomeNorm && itemNome && nomeNorm === itemNome;
            return Boolean(mesmoDoc || mesmoNome);
        });

        if (idx === -1) {
            consolidadosLimpos.push({ original: { ...reg }, limpo: atual });
            continue;
        }

        const existente = consolidadosLimpos[idx].limpo;
        const origExistente = consolidadosLimpos[idx].original;

        // Escolhe os dados mais completos e o laudo mais recente entre os duplicados
        const tsAtual = converterDataBrParaTimestamp(atual.dataResultado);
        const tsExistente = converterDataBrParaTimestamp(existente.dataResultado);
        const usarLaudoAtual = tsAtual !== null && (tsExistente === null || tsAtual >= tsExistente);

        if (usarLaudoAtual && atual.dataResultado) {
            existente.dataResultado = atual.dataResultado;
            origExistente.dataResultado = criptografar(atual.dataResultado);
        }
        if ((usarLaudoAtual && atual.conclusao) || (!existente.conclusao && atual.conclusao)) {
            existente.conclusao = atual.conclusao;
            origExistente.conclusao = criptografar(atual.conclusao);
        }
        if (!normalizarDocumentoComparacao(existente.cpf) && docNorm) {
            existente.cpf = docNorm;
            origExistente.cpf = criptografar(docNorm);
        }
        if (!existente.nascimento && atual.nascimento) {
            existente.nascimento = atual.nascimento;
            origExistente.nascimento = criptografar(atual.nascimento);
        }
        const telAtual = (atual.numero || '').replace(/\D/g, '');
        const telExistente = (existente.numero || '').replace(/\D/g, '');
        if (telAtual.length >= 8 && (telExistente.length < 8 || usarLaudoAtual)) {
            existente.numero = atual.numero;
            origExistente.numero = criptografar(atual.numero);
        }
        if (EnderecoValido(atual.endereco) && (!EnderecoValido(existente.endereco) || usarLaudoAtual)) {
            existente.endereco = atual.endereco;
            origExistente.endereco = criptografar(atual.endereco);
        }
        if (!existente.observacoes && atual.observacoes) {
            existente.observacoes = atual.observacoes;
            origExistente.observacoes = criptografar(atual.observacoes);
        }

        const pesoAtual = PESO_STATUS[atual.status] || 0;
        const pesoExistente = PESO_STATUS[existente.status] || 0;
        if (pesoAtual > pesoExistente) {
            existente.status = atual.status;
            origExistente.status = atual.status;
            if (atual.dataEnvio) {
                origExistente.dataEnvio = atual.dataEnvio;
            }
        }
    }

    return consolidadosLimpos.map((item) => item.original);
}

let pacientes = [];
if (fs.existsSync(caminhoArquivoPacientes)) {
    try {
        const brutos = JSON.parse(fs.readFileSync(caminhoArquivoPacientes, 'utf-8'));
        pacientes = deduplicarPacientes(brutos);
        if (pacientes.length < brutos.length) {
            fs.writeFileSync(caminhoArquivoPacientes, JSON.stringify(pacientes, null, 2), { mode: 0o600 });
            console.log(`[🧹 DEDUPLICAÇÃO] ${brutos.length - pacientes.length} registros duplicados foram consolidados automaticamente.`);
        }
    } catch (e) {
        pacientes = [];
    }
}

export function salvarPacientes() {
    pacientes = deduplicarPacientes(pacientes);
    fs.writeFileSync(caminhoArquivoPacientes, JSON.stringify(pacientes, null, 2), { mode: 0o600 });
}

export function obterPacientes() {
    return pacientes;
}

export function definirPacientes(novaLista) {
    pacientes = novaLista;
}

export function definirArquivoPacientes(novoCaminho) {
    caminhoArquivoPacientes = novoCaminho;
}

app.use(express.static(path.join(__dirname, 'public')));

let sock;
let enviosWhatsAppAtivos = process.env.WHATSAPP_ENVIOS_ATIVOS !== 'false';
let ultimoQrCode = null;
let qrAtualizadoEm = null;
let logQrEmitido = false;
let conectandoWhatsApp = false;

export function gerarSvgQrCode(texto) {
    if (!texto || typeof texto !== 'string') return null;
    const qr = new QRCode(-1, QRErrorCorrectLevel.M);
    qr.addData(texto);
    qr.make();
    const count = qr.getModuleCount();
    const margin = 4;
    const size = count + margin * 2;
    let paths = '';
    for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
            if (qr.isDark(r, c)) {
                paths += `M${c + margin},${r + margin}h1v1h-1z`;
            }
        }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><path d="${paths}" fill="#0f172a"/></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export function definirSocketWhatsApp(novoSock) {
    sock = novoSock;
}

export function definirQrCodeWhatsApp(qr) {
    ultimoQrCode = qr || null;
    qrAtualizadoEm = qr ? new Date().toISOString() : null;
}

export function obterQrCodeWhatsApp() {
    return ultimoQrCode;
}

export function obterStatusEnviosWhatsApp() {
    return enviosWhatsAppAtivos;
}

export function definirStatusEnviosWhatsApp(ativo) {
    enviosWhatsAppAtivos = Boolean(ativo);
}

export async function processarMensagemRecebida({ messages, type }) {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg?.message || msg.key.fromMe) return;

    let remetenteJid = msg.key.remoteJid;

    if (remetenteJid.includes('@lid') && msg.key.remoteJidAlt) {
        console.log(`[DESMASCARANDO] Convertendo LID para JID autenticado (${mascararDadoSensivel(msg.key.remoteJidAlt)})`);
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
                console.log(`[WHATSAPP] Resultado entregue com sucesso para cadastro ID #${dados.idPaciente} (${mascararDadoSensivel(dados.nome)})`);
            }

        } else if (resposta === '0') {
            await sock.sendMessage(remetenteJid, { text: "Pedimos desculpas pelo incômodo. Por favor, desconsidere esta mensagem. Iremos atualizar o cadastro na USF." });
            aguardandoConfirmacao.delete(remetenteJid);

            const index = pacientes.findIndex(p => p.id == dados.idPaciente);
            if (index !== -1) {
                pacientes[index].status = "Número Incorreto";
                salvarPacientes();
                console.log(`[WHATSAPP] Número incorreto reportado para o cadastro ID #${dados.idPaciente} (${mascararDadoSensivel(dados.nome)})`);
            }
        } else {
            await sock.sendMessage(remetenteJid, { text: "Por favor, responda apenas com *1* para *Sim* ou *0* para *Não*." });
        }
    }
}

export async function iniciarWhatsApp() {
    if (conectandoWhatsApp) return;
    conectandoWhatsApp = true;

    try {
        const pastaAuth = path.join(__dirname, 'auth_info');
        const { state, saveCreds } = await useMultiFileAuthState(pastaAuth);
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'error' }),
            printQRInTerminal: false
        });

        sock.ev.on('connection.update', (u) => {
            const { connection, lastDisconnect, qr } = u;

            if (qr) {
                ultimoQrCode = qr;
                qrAtualizadoEm = new Date().toISOString();
                if (!logQrEmitido) {
                    console.log('[WHATSAPP] QR Code gerado. Acesse o Painel Web da UESB para escanear com segurança.');
                    logQrEmitido = true;
                }
            }

            if (connection === 'close') {
                conectandoWhatsApp = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;

                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('[WHATSAPP] Sessão desconectada pelo aparelho. Limpando credenciais antigas...');
                    ultimoQrCode = null;
                    qrAtualizadoEm = null;
                    sock = null;
                    try {
                        fs.rmSync(pastaAuth, { recursive: true, force: true });
                    } catch {}
                    const t = setTimeout(() => iniciarWhatsApp(), 2000);
                    if (typeof t.unref === 'function') t.unref();
                } else if (statusCode === DisconnectReason.timedOut && !sock?.user) {
                    // Pausa reconexão em loop caso ninguém esteja escaneando o QR Code no momento
                    ultimoQrCode = null;
                    qrAtualizadoEm = null;
                } else {
                    const t = setTimeout(() => iniciarWhatsApp(), 3000);
                    if (typeof t.unref === 'function') t.unref();
                }
            } else if (connection === 'open') {
                conectandoWhatsApp = false;
                ultimoQrCode = null;
                qrAtualizadoEm = null;
                logQrEmitido = false;
                console.log('[WHATSAPP] Conectado com sucesso!');
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', processarMensagemRecebida);
    } catch (erroWa) {
        conectandoWhatsApp = false;
        console.error('[WHATSAPP] Falha ao inicializar cliente:', erroWa.message || erroWa);
    }
}

export const verificarToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(403).json({ error: "Acesso negado. Faça login novamente." });

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader;

    jwt.verify(token, process.env.SENHA_PAINEL, (err, decoded) => {
        if (err) return res.status(401).json({ error: "Sessão expirada. O acesso foi resetado." });
        next();
    });
};

// --- ROTAS DO SERVIDOR ---
app.post('/login', (req, res) => {
    const ipCliente = req.ip || req.socket?.remoteAddress || 'desconhecido';
    const agora = Date.now();
    const registroTentativa = tentativasLogin.get(ipCliente);

    if (registroTentativa) {
        if (agora - registroTentativa.primeiraTentativa > JANELA_BLOQUEIO_LOGIN_MS) {
            tentativasLogin.delete(ipCliente);
        } else if (registroTentativa.contagem >= MAX_TENTATIVAS_LOGIN) {
            return res.status(429).json({
                autorizado: false,
                error: "Muitas tentativas de login. Aguarde 15 minutos antes de tentar novamente."
            });
        }
    }

    const { senha } = req.body || {};
    if (compararSenhasSeguro(senha, process.env.SENHA_PAINEL)) {
        tentativasLogin.delete(ipCliente);
        const token = jwt.sign({ autorizado: true }, process.env.SENHA_PAINEL, { expiresIn: '5m' });
        res.json({ autorizado: true, token });
    } else {
        const atual = tentativasLogin.get(ipCliente) || { contagem: 0, primeiraTentativa: agora };
        atual.contagem += 1;
        tentativasLogin.set(ipCliente, atual);
        res.status(401).json({ autorizado: false, error: "Senha incorreta" });
    }
});

app.post('/cadastrar-paciente', verificarToken, (req, res) => {
    const { nome, numero, nascimento, cpf, endereco, unidade, conclusao, dataResultado, observacoes } = req.body;

    const novo = {
        id: Date.now(),
        nome: criptografar(nome),
        numero: criptografar(numero),
        nascimento: criptografar(nascimento),
        cpf: criptografar(cpf),
        endereco: criptografar(endereco),
        unidade: unidade || 'USF Vila América',
        conclusao: conclusao ? criptografar(conclusao) : '',
        dataResultado: dataResultado ? criptografar(dataResultado) : '',
        observacoes: observacoes ? criptografar(observacoes) : '',
        status: "Pendente",
        dataCadastro: new Date().toLocaleString()
    };

    pacientes.push(novo);
    salvarPacientes();
    res.json({ status: "sucesso", id: novo.id });
});

app.get('/status-sistema', verificarToken, (req, res) => {
    const descriptografados = pacientes.map(descriptografarPaciente);
    const estatisticas = calcularEstatisticasPacientes(descriptografados);

    res.json({
        whatsappConectado: Boolean(sock?.user),
        qrDisponivel: Boolean(!sock?.user && ultimoQrCode),
        enviosWhatsAppAtivos,
        siscanConfigurado: Boolean(process.env.SISCAN_EMAIL && process.env.SISCAN_SENHA),
        pecConfigurado: Boolean(process.env.PEC_USUARIO && process.env.PEC_SENHA),
        unidadePadrao: process.env.SISCAN_UNIDADE_PADRAO || 'USF Vila América',
        estatisticas
    });
});

app.get('/whatsapp/qrcode', verificarToken, (req, res) => {
    const conectado = Boolean(sock?.user);
    if (!conectado && !ultimoQrCode && !conectandoWhatsApp) {
        iniciarWhatsApp();
    }

    res.json({
        conectado,
        qrDisponivel: Boolean(!conectado && ultimoQrCode),
        qrSvgDataUrl: !conectado && ultimoQrCode ? gerarSvgQrCode(ultimoQrCode) : null,
        atualizadoEm: qrAtualizadoEm,
        enviosWhatsAppAtivos
    });
});

app.post('/whatsapp/reconectar', verificarToken, async (req, res) => {
    const { novaSessao } = req.body || {};
    const pastaAuth = path.join(__dirname, 'auth_info');

    try {
        if (sock && typeof sock.end === 'function') {
            try {
                sock.end();
            } catch {}
        }
        sock = null;
        ultimoQrCode = null;
        qrAtualizadoEm = null;
        conectandoWhatsApp = false;

        if (novaSessao) {
            try {
                fs.rmSync(pastaAuth, { recursive: true, force: true });
            } catch {}
        }

        iniciarWhatsApp();
        res.json({
            status: 'sucesso',
            mensagem: novaSessao
                ? 'Sessão anterior encerrada. Gerando novo QR Code para conexão...'
                : 'Solicitando novo QR Code ao WhatsApp...'
        });
    } catch (erro) {
        res.status(500).json({ error: 'Falha ao reiniciar conexão do WhatsApp: ' + (erro.message || erro) });
    }
});

app.post('/configurar-envios-whatsapp', verificarToken, (req, res) => {
    const { ativo } = req.body || {};
    if (typeof ativo === 'boolean') {
        enviosWhatsAppAtivos = ativo;
    } else {
        enviosWhatsAppAtivos = !enviosWhatsAppAtivos;
    }

    res.json({
        status: 'sucesso',
        enviosWhatsAppAtivos,
        whatsappConectado: Boolean(sock?.user)
    });
});

app.get('/pacientes', verificarToken, (req, res) => {
    const criterio = req.query.ordenarPor || 'dataResultado';
    const ordem = req.query.ordem;
    const list = ordenarPacientes(pacientes.map(descriptografarPaciente), criterio, ordem);
    res.json(list);
});

export async function dispararMensagemPaciente(p) {
    if (!enviosWhatsAppAtivos) {
        throw new Error('Envio de notificações desativado (Modo de Teste ativo). Ative os envios no topo do painel para disparar mensagens reais.');
    }

    if (!sock?.user) {
        console.log('WhatsApp não conectado para o disparo automático.');
        return;
    }

    let numeroLimpo = descriptografar(p.numero).replace(/\D/g, '');

    if (process.env.WHATSAPP_NUMERO_TESTE) {
        numeroLimpo = String(process.env.WHATSAPP_NUMERO_TESTE).replace(/\D/g, '');
    }

    if (!numeroLimpo || numeroLimpo.length < 8) {
        throw new Error('Paciente não possui número de telefone válido cadastrado.');
    }

    if (!numeroLimpo.startsWith('55')) {
        numeroLimpo = numeroLimpo.length <= 9 ? '5577' + numeroLimpo : '55' + numeroLimpo;
    }

    if (numeroLimpo.length === 13) {
        const ddd = parseInt(numeroLimpo.substring(2, 4));
        if (ddd > 31) {
            numeroLimpo = numeroLimpo.substring(0, 4) + numeroLimpo.substring(5);
        }
    }

    const jid = `${numeroLimpo}@s.whatsapp.net`;
    const nome = descriptografar(p.nome);
    const conclusao = descriptografar(p.conclusao);

    const msgPergunta = `Olá, esse é o número de contato da ${p.unidade}. Você é *${nome}*?\n[0] - Não\n[1] - Sim`;
    const msgFinal = `Olá, ${nome}! 🌸 O resultado do seu exame preventivo já está disponível na **${p.unidade}**. ✅\n\nConclusão: ${conclusao || 'Verificar na unidade'}.\n\nPara continuarmos cuidando da sua saúde, compareça à unidade. 💙`;

    aguardandoConfirmacao.set(jid, {
        idPaciente: p.id,
        nome: nome,
        mensagemFinal: msgFinal
    });

    const timer = setTimeout(() => {
        if (aguardandoConfirmacao.has(jid)) {
            aguardandoConfirmacao.delete(jid);
        }
    }, 86400000);
    if (typeof timer.unref === 'function') timer.unref();

    await sock.sendMessage(jid, { text: msgPergunta });

    p.status = "Aguardando Confirmação";
    salvarPacientes();
    console.log(`[WHATSAPP] Mensagem de confirmação enviada para cadastro ID #${p.id} (${mascararDadoSensivel(jid)})`);
}

// --- FLUXO COMPLETO DE INTEGRAÇÃO (SISCAN + EXTRAÇÃO LOCAL + PEC + CADASTRO + WHATSAPP) ---
export async function executarFluxoCompletoSemanal({
    buscarLaudo = automatizarPesquisaLaudo,
    extrairLaudos = analisarLaudos,
    enriquecerPec = enriquecerPacientesComPec,
    removerPdfAposExtracao = buscarLaudo === automatizarPesquisaLaudo && process.env.MANTER_PDF_SISCAN !== 'true'
} = {}) {
    console.log('\n[⚙️ INTEGRAÇÃO] Iniciando varredura semanal no SISCAN (6 últimos meses)...');

    const nomeArquivoPdf = await buscarLaudo();
    
    if (!nomeArquivoPdf) {
        console.log('[⚙️ INTEGRAÇÃO] A varredura foi concluída, mas nenhum laudo foi gerado.');
        return [];
    }

    if (!fs.existsSync(nomeArquivoPdf)) {
        throw new Error(`O arquivo PDF '${nomeArquivoPdf}' não foi encontrado para análise após a execução.`);
    }

    let pacientesAtipicos = [];
    try {
        pacientesAtipicos = await extrairLaudos(nomeArquivoPdf);
    } finally {
        if (removerPdfAposExtracao && typeof nomeArquivoPdf === 'string' && fs.existsSync(nomeArquivoPdf)) {
            try {
                fs.unlinkSync(nomeArquivoPdf);
                console.log(`[🔒 LGPD] Arquivo PDF temporário '${nomeArquivoPdf}' removido do disco após extração.`);
            } catch (errUnlink) {
                console.error(`[⚠️ LGPD] Não foi possível remover PDF temporário:`, errUnlink.message);
            }
        }
    }

    if (!pacientesAtipicos || pacientesAtipicos.length === 0) {
        console.log('[⚙️ INTEGRAÇÃO] Nenhum laudo com atipia encontrado nesta execução.');
        return [];
    }

    let listaParaCadastro = pacientesAtipicos.map((p) => ({
        ...p,
        cpf: p.cartaoSUS || p.cpf || '',
        endereco: p.endereco || ''
    }));

    try {
        const resultadoPec = await enriquecerPec(listaParaCadastro, { exigirCredenciais: false });
        if (resultadoPec?.pacientes) {
            listaParaCadastro = resultadoPec.pacientes;
        }
    } catch (erroPec) {
        console.error('[⚠️ PEC] Não foi possível atualizar contatos no PEC durante a sincronização:', erroPec.message);
    }

    const cadastrados = [];

    for (const pacienteExtraido of listaParaCadastro) {
        const docNovo = (pacienteExtraido.cartaoSUS || pacienteExtraido.cpf || '').trim();
        const nomeNovo = (pacienteExtraido.nome || 'Desconhecido').trim();
        const dataResNova = (pacienteExtraido.dataResultado || '').trim();

        // Evita duplicação de registros sensíveis para a mesma paciente (mesmo CNS/CPF ou mesmo nome normalizado)
        const docNormNovo = normalizarDocumentoComparacao(docNovo);
        const nomeNormNovo = normalizarNomeComparacao(nomeNovo);
        const idxExistente = pacientes.findIndex((reg) => {
            const regLimpo = descriptografarPaciente(reg);
            const mesmoDoc = docNormNovo && normalizarDocumentoComparacao(regLimpo.cpf) === docNormNovo;
            const mesmoNome = nomeNormNovo && normalizarNomeComparacao(regLimpo.nome) === nomeNormNovo;
            return Boolean(mesmoDoc || mesmoNome);
        });

        if (idxExistente !== -1) {
            if (pacienteExtraido.telefone) {
                pacientes[idxExistente].numero = criptografar(pacienteExtraido.telefone);
            }
            if (EnderecoValido(pacienteExtraido.endereco)) {
                pacientes[idxExistente].endereco = criptografar(pacienteExtraido.endereco);
            }
            if (pacienteExtraido.nascimento) {
                pacientes[idxExistente].nascimento = criptografar(pacienteExtraido.nascimento);
            }
            if (docNormNovo) {
                pacientes[idxExistente].cpf = criptografar(docNormNovo);
            }
            if (dataResNova) {
                pacientes[idxExistente].dataResultado = criptografar(dataResNova);
            }
            if (pacienteExtraido.conclusao) {
                pacientes[idxExistente].conclusao = criptografar(pacienteExtraido.conclusao);
            }
            cadastrados.push(pacientes[idxExistente]);
            continue;
        }

        const novoRegistro = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            nome: criptografar(nomeNovo),
            numero: criptografar(pacienteExtraido.telefone || ''),
            nascimento: criptografar(pacienteExtraido.nascimento || ''), 
            cpf: criptografar(docNovo),
            endereco: criptografar(pacienteExtraido.endereco || ''),
            unidade: process.env.SISCAN_UNIDADE_PADRAO || 'USF Principal',
            conclusao: criptografar(pacienteExtraido.conclusao || ''),
            dataResultado: criptografar(dataResNova),
            status: "Pendente",
            dataCadastro: new Date().toLocaleString()
        };

        pacientes.push(novoRegistro);
        cadastrados.push(novoRegistro);
    }

    salvarPacientes();
    console.log(`[⚙️ INTEGRAÇÃO] ${cadastrados.length} pacientes cadastrados com sucesso no sistema.`);

    // O envio automático via WhatsApp está documentado para testes, descomente para ativar em massa.
    /*
    for (const pacienteCadastrado of cadastrados) {
        try {
            await dispararMensagemPaciente(pacienteCadastrado);
        } catch (erroDisparo) {
            console.error(`[❌ ERRO WHATSAPP] Falha ao enviar para o paciente ID ${pacienteCadastrado.id}:`, erroDisparo);
        }
    }
    */

    return cadastrados;
}

export async function atualizarContatosPacientesPec({
    enriquecerPec = enriquecerPacientesComPec
} = {}) {
    if (pacientes.length === 0) {
        return { totalAnalisados: 0, totalAtualizados: 0 };
    }

    const descriptografados = pacientes.map(descriptografarPaciente);
    const resultado = await enriquecerPec(descriptografados, { exigirCredenciais: true });

    pacientes = pacientes.map((original, idx) => {
        const enriquecido = resultado.pacientes[idx];
        if (!enriquecido) return original;
        return {
            ...original,
            numero: criptografar(enriquecido.numero || ''),
            endereco: criptografar(enriquecido.endereco || '')
        };
    });

    salvarPacientes();
    return {
        totalAnalisados: resultado.totalAnalisados,
        totalAtualizados: resultado.totalAtualizados
    };
}

let executorFluxoSemanal = executarFluxoCompletoSemanal;
let executorSincronizacaoPec = atualizarContatosPacientesPec;

export function definirFluxoSemanal(fn) {
    executorFluxoSemanal = fn || executarFluxoCompletoSemanal;
}

export function definirSincronizadorPec(fn) {
    executorSincronizacaoPec = fn || atualizarContatosPacientesPec;
}

app.get('/sincronizar-ministerio', verificarToken, async (req, res) => {
    try {
        const pacientesProcessados = await executorFluxoSemanal();

        res.json({
            status: "sucesso",
            mensagem: "Sincronização, análise local de laudos e disparos concluídos com sucesso!",
            totalEncontrados: pacientesProcessados.length,
            dados: pacientesProcessados
        });
    } catch (erro) {
        console.error("Falha ao sincronizar:", erro);
        res.status(500).json({ error: "O portal do Ministério está indisponível ou ocorreu um erro: " + (erro.message || erro) });
    }
});

app.post('/sincronizar-pec', verificarToken, async (req, res) => {
    try {
        const resultado = await executorSincronizacaoPec();
        res.json({
            status: "sucesso",
            mensagem: "Contatos e endereços atualizados via PEC com sucesso!",
            totalAnalisados: resultado.totalAnalisados,
            totalAtualizados: resultado.totalAtualizados
        });
    } catch (erro) {
        console.error("Falha ao sincronizar com PEC:", erro);
        const statusHttp = /PEC_USUARIO|PEC_SENHA|autenticar|Credenciais/i.test(erro.message || '') ? 400 : 500;
        res.status(statusHttp).json({ error: erro.message || "Falha ao consultar o PEC do município." });
    }
});

app.post('/enviar-notificacao/:id', verificarToken, async (req, res) => {
    const p = pacientes.find(x => x.id == req.params.id);
    if (!p) return res.status(404).json({ error: "Paciente não encontrado." });

    try {
        await dispararMensagemPaciente(p);
        res.json({ status: "sucesso", message: "Pergunta de confirmação enviada." });
    } catch (err) {
        console.error("Erro no disparo:", err.message || err);
        res.status(500).json({ error: err.message || "Falha ao enviar mensagem via WhatsApp." });
    }
});

app.post('/enviar-notificacoes-pendentes', verificarToken, async (req, res) => {
    if (!enviosWhatsAppAtivos) {
        return res.status(403).json({
            error: "Envio de notificações desativado (Modo de Teste ativo). Ative os envios no topo do painel para disparar mensagens reais."
        });
    }

    const pendentes = pacientes.filter(p => (p.status || 'Pendente') === 'Pendente');
    let enviados = 0;
    let ignoradosSemTelefone = 0;
    let falhas = 0;

    for (const p of pendentes) {
        const foneLimpo = descriptografar(p.numero).replace(/\D/g, '');
        if (foneLimpo.length < 8 && !process.env.WHATSAPP_NUMERO_TESTE) {
            ignoradosSemTelefone++;
            continue;
        }
        try {
            await dispararMensagemPaciente(p);
            enviados++;
        } catch {
            falhas++;
        }
    }

    res.json({
        status: "sucesso",
        totalPendentes: pendentes.length,
        enviados,
        ignoradosSemTelefone,
        falhas
    });
});

app.post('/importar-pdf-laudos', verificarToken, async (req, res) => {
    const { conteudoBase64 } = req.body || {};
    if (!conteudoBase64 || typeof conteudoBase64 !== 'string') {
        return res.status(400).json({ error: "Arquivo PDF em formato base64 não informado." });
    }

    try {
        const base64Limpo = conteudoBase64.replace(/^data:application\/pdf;base64,/, '');
        const bufferPdf = Buffer.from(base64Limpo, 'base64');
        const pacientesAtipicos = await analisarLaudos(bufferPdf);

        let listaParaCadastro = pacientesAtipicos.map((p) => ({
            ...p,
            cpf: p.cartaoSUS || p.cpf || '',
            endereco: p.endereco || ''
        }));

        try {
            const resultadoPec = await enriquecerPacientesComPec(listaParaCadastro, { exigirCredenciais: false });
            if (resultadoPec?.pacientes) {
                listaParaCadastro = resultadoPec.pacientes;
            }
        } catch (errPec) {
            console.error('[⚠️ PEC] Erro ao enriquecer durante importação de PDF:', errPec.message);
        }

        let novosCadastros = 0;
        let atualizados = 0;

        for (const pacienteExtraido of listaParaCadastro) {
            const docNovo = (pacienteExtraido.cartaoSUS || pacienteExtraido.cpf || '').trim();
            const nomeNovo = (pacienteExtraido.nome || 'Desconhecido').trim();
            const dataResNova = (pacienteExtraido.dataResultado || '').trim();

            const docNormNovo = normalizarDocumentoComparacao(docNovo);
            const nomeNormNovo = normalizarNomeComparacao(nomeNovo);
            const idxExistente = pacientes.findIndex((reg) => {
                const regLimpo = descriptografarPaciente(reg);
                const mesmoDoc = docNormNovo && normalizarDocumentoComparacao(regLimpo.cpf) === docNormNovo;
                const mesmoNome = nomeNormNovo && normalizarNomeComparacao(regLimpo.nome) === nomeNormNovo;
                return Boolean(mesmoDoc || mesmoNome);
            });

            if (idxExistente !== -1) {
                if (pacienteExtraido.telefone) {
                    pacientes[idxExistente].numero = criptografar(pacienteExtraido.telefone);
                }
                if (EnderecoValido(pacienteExtraido.endereco)) {
                    pacientes[idxExistente].endereco = criptografar(pacienteExtraido.endereco);
                }
                if (pacienteExtraido.nascimento) {
                    pacientes[idxExistente].nascimento = criptografar(pacienteExtraido.nascimento);
                }
                if (docNormNovo) {
                    pacientes[idxExistente].cpf = criptografar(docNormNovo);
                }
                if (dataResNova) {
                    pacientes[idxExistente].dataResultado = criptografar(dataResNova);
                }
                if (pacienteExtraido.conclusao) {
                    pacientes[idxExistente].conclusao = criptografar(pacienteExtraido.conclusao);
                }
                atualizados++;
                continue;
            }

            pacientes.push({
                id: Date.now() + Math.floor(Math.random() * 1000),
                nome: criptografar(nomeNovo),
                numero: criptografar(pacienteExtraido.telefone || ''),
                nascimento: criptografar(pacienteExtraido.nascimento || ''),
                cpf: criptografar(docNovo),
                endereco: criptografar(pacienteExtraido.endereco || ''),
                unidade: process.env.SISCAN_UNIDADE_PADRAO || 'USF Vila América',
                conclusao: criptografar(pacienteExtraido.conclusao || ''),
                dataResultado: criptografar(dataResNova),
                status: "Pendente",
                dataCadastro: new Date().toLocaleString()
            });
            novosCadastros++;
        }

        salvarPacientes();
        res.json({
            status: "sucesso",
            totalAtipicosEncontrados: listaParaCadastro.length,
            novosCadastros,
            atualizados
        });
    } catch (erro) {
        res.status(500).json({ error: "Falha ao processar o PDF enviado: " + (erro.message || erro) });
    }
});

app.patch('/pacientes/:id/status', verificarToken, (req, res) => {
    const { id } = req.params;
    const { status, observacoes } = req.body || {};
    const statusPermitidos = [
        'Pendente',
        'Aguardando Confirmação',
        'Enviado',
        'Compareceu à USF',
        'Busca Ativa (ACS)',
        'Número Incorreto'
    ];

    const index = pacientes.findIndex(p => p.id == id);
    if (index === -1) {
        return res.status(404).json({ error: "Paciente não encontrada." });
    }

    if (status && statusPermitidos.includes(status)) {
        pacientes[index].status = status;
        if (status === 'Compareceu à USF') {
            pacientes[index].dataComparecimento = new Date().toLocaleString();
        }
    }

    if (observacoes !== undefined) {
        pacientes[index].observacoes = observacoes ? criptografar(String(observacoes)) : '';
    }

    salvarPacientes();
    res.json({
        status: "sucesso",
        paciente: descriptografarPaciente(pacientes[index])
    });
});

app.delete('/pacientes/:id', verificarToken, (req, res) => {
    pacientes = pacientes.filter(p => p.id != req.params.id);
    salvarPacientes();
    res.json({ status: "removido" });
});

app.put('/editar-paciente/:id', verificarToken, (req, res) => {
    const { id } = req.params;
    const { nome, numero, nascimento, cpf, endereco, unidade, status, observacoes, conclusao, dataResultado } = req.body;

    const index = pacientes.findIndex(p => p.id == id);

    if (index !== -1) {
        pacientes[index] = {
            ...pacientes[index],
            nome: criptografar(nome),
            numero: criptografar(numero),
            nascimento: criptografar(nascimento),
            cpf: criptografar(cpf),
            endereco: criptografar(endereco),
            unidade: unidade || pacientes[index].unidade,
            ...(status ? { status } : {}),
            ...(observacoes !== undefined ? { observacoes: observacoes ? criptografar(observacoes) : '' } : {}),
            ...(conclusao !== undefined ? { conclusao: conclusao ? criptografar(conclusao) : '' } : {}),
            ...(dataResultado !== undefined ? { dataResultado: dataResultado ? criptografar(dataResultado) : '' } : {})
        };

        salvarPacientes();
        res.json({ status: "sucesso" });
    } else {
        res.status(404).json({ error: "Paciente não encontrada" });
    }
});

const executandoEmTeste =
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.execArgv.includes('--test') ||
    process.argv.some((arg) => arg.endsWith('.test.js'));

if (!executandoEmTeste) {
    // --- AGENDAMENTO SEMANAL (CRON) ---
    // Roda toda segunda-feira às 03:00 da manhã
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
}
