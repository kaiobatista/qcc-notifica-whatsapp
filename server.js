import 'dotenv/config'
import express from 'express';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import jwt from 'jsonwebtoken';

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACIENTES_FILE = path.join(__dirname, 'pacientes.json');

const SECRET_KEY = Buffer.from(process.env.SECRET_KEY, 'hex');
const IV_LENGTH = 16;

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

let pacientes = [];
if (fs.existsSync(PACIENTES_FILE)) {
    try {
        pacientes = JSON.parse(fs.readFileSync(PACIENTES_FILE, 'utf-8'));
    } catch (e) {
        pacientes = [];
    }
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
}

const verificarToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: "Acesso negado. Faça login novamente." });

    jwt.verify(token, process.env.SENHA_PAINEL, (err, decoded) => {
        if (err) return res.status(401).json({ error: "Sessão expirada. O acesso foi resetado." });
        next();
    });
};

// rotas

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
    fs.writeFileSync(PACIENTES_FILE, JSON.stringify(pacientes, null, 2));
    res.json({ status: "sucesso" });
});

app.get('/pacientes', verificarToken, (req, res) => {
    const list = pacientes.map(p => ({
        ...p,
        nome: descriptografar(p.nome),
        numero: descriptografar(p.numero),
        nascimento: descriptografar(p.nascimento),
        cpf: descriptografar(p.cpf),
        endereco: descriptografar(p.endereco)
    }));
    res.json(list);
});

app.post('/enviar-notificacao/:id', verificarToken, async (req, res) => {
    const p = pacientes.find(x => x.id == req.params.id);
    if (!p || !sock?.user) return res.status(500).json({ error: "WhatsApp não conectado ou paciente não encontrado." });
    
    try {

        let numeroLimpo = descriptografar(p.numero).replace(/\D/g, '');

        
        if (!numeroLimpo.startsWith('55')) {
            numeroLimpo = '55' + numeroLimpo;
        }

        
        if (numeroLimpo.length === 13) {
            const ddd = parseInt(numeroLimpo.substring(2, 4));
            if (ddd > 31) {
                numeroLimpo = numeroLimpo.substring(0, 4) + numeroLimpo.substring(5);
                console.log(`🔧 Ajustando JID para ${ddd}: ${numeroLimpo}`);
            }
        }

        const jid = `${numeroLimpo}@s.whatsapp.net`;
        const nome = descriptografar(p.nome);
        const msg = `Olá, ${nome}! 🌸 O resultado do seu preventivo já está disponível na **${p.unidade}**. ✅\n\nPor favor, compareça à unidade com seu documento para retirar o laudo.`;
        
        console.log(`🚀 Tentando enviar para: ${jid}`);
        await sock.sendMessage(jid, { text: msg });
        
        p.status = "Enviado";
        p.dataEnvio = new Date().toLocaleString();
        fs.writeFileSync(PACIENTES_FILE, JSON.stringify(pacientes, null, 2));
        
        console.log(`Mensagem enviada com sucesso para ${nome}`);
        res.json({ status: "sucesso" });

    } catch (err) {
        console.error("Erro no disparo:", err);
        res.status(500).json({ error: "Falha ao enviar mensagem via WhatsApp." });
    }
});

app.delete('/pacientes/:id', (req, res) => {
    pacientes = pacientes.filter(p => p.id != req.params.id);
    fs.writeFileSync(PACIENTES_FILE, JSON.stringify(pacientes, null, 2));
    res.json({ status: "removido" });
});

app.put('/editar-paciente/:id', (req, res) => {
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
        
        fs.writeFileSync(PACIENTES_FILE, JSON.stringify(pacientes, null, 2));
        res.json({ status: "sucesso" });
    } else {
        res.status(404).json({ error: "Paciente não encontrada" });
    }
});

app.listen(3000, () => { 
    console.log('Servidor rodando na porta 3000'); 
    iniciarWhatsApp(); 
});