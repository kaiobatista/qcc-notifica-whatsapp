let monitor_de_acesso;
let pacientesCarregados = [];

function escaparHtml(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function mostrarToast(mensagem, tipo = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) {
        alert(mensagem);
        return;
    }

    const estilos = {
        sucesso: 'bg-emerald-600 text-white border-emerald-700',
        erro: 'bg-red-600 text-white border-red-700',
        aviso: 'bg-amber-500 text-white border-amber-600',
        info: 'bg-slate-800 text-white border-slate-900'
    };

    const icones = {
        sucesso: 'fa-check-circle',
        erro: 'fa-exclamation-circle',
        aviso: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };

    const toast = document.createElement('div');
    toast.className = `pointer-events-auto flex items-center gap-3 px-4 py-3.5 rounded-2xl shadow-xl border text-xs sm:text-sm font-semibold transition-all duration-300 ${estilos[tipo] || estilos.info}`;
    toast.innerHTML = `
        <i class="fas ${icones[tipo] || icones.info} text-base"></i>
        <span class="flex-1">${escaparHtml(mensagem)}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-x-4');
        setTimeout(() => toast.remove(), 300);
    }, 4500);
}

function alternarVisibilidadeSenha() {
    const input = document.getElementById('senha-acesso');
    const icone = document.getElementById('icone-olho-senha');
    if (!input) return;

    if (input.type === 'password') {
        input.type = 'text';
        icone?.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password';
        icone?.classList.replace('fa-eye-slash', 'fa-eye');
    }
}

function tokenSessaoValido(token) {
    if (!token || typeof token !== 'string') return false;
    try {
        const partes = token.split('.');
        if (partes.length !== 3) return false;
        const payload = JSON.parse(atob(partes[1]));
        return Boolean(payload.exp && Date.now() < payload.exp * 1000);
    } catch {
        return false;
    }
}

function atualizarContadorSessao(token) {
    const timerEl = document.getElementById('timer-sessao');
    if (!timerEl || !token) return;
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const restanteSeg = Math.max(0, Math.floor((payload.exp * 1000 - Date.now()) / 1000));
        const min = String(Math.floor(restanteSeg / 60)).padStart(2, '0');
        const seg = String(restanteSeg % 60).padStart(2, '0');
        timerEl.textContent = `${min}:${seg}`;
    } catch {
        timerEl.textContent = '--:--';
    }
}

// AUTH
function iniciarVigilanciaToken() {
    if (monitor_de_acesso) clearInterval(monitor_de_acesso);

    monitor_de_acesso = setInterval(() => {
        const token = sessionStorage.getItem('token');
        if (!tokenSessaoValido(token)) {
            bloquearSistema();
            return;
        }
        atualizarContadorSessao(token);
    }, 1000);
}

function bloquearSistema() {
    clearInterval(monitor_de_acesso);
    sessionStorage.clear();
    location.reload();
}

async function realizarLogin() {
    const senha = document.getElementById('senha-acesso').value;
    const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha })
    });

    if (res.ok) {
        const data = await res.json();
        sessionStorage.setItem('token', data.token);
        sessionStorage.setItem('autenticado', 'true');
        document.getElementById('tela-login').classList.add('opacity-0', 'pointer-events-none', 'hidden');
        iniciarVigilanciaToken();
        carregarPacientes();
        atualizarStatusSistema();
        mostrarToast('Acesso liberado com sucesso!', 'sucesso');
    } else {
        const dadosErro = await res.json().catch(() => ({}));
        const erro = document.getElementById('erro-login');
        if (erro) {
            erro.textContent = dadosErro.error || 'Senha inválida. Tente novamente.';
            erro.classList.remove('hidden');
        }
        document.getElementById('senha-acesso').value = '';
    }
}

// NAVEGAÇÃO E UI
function mudarAba(aba) {
    document.querySelectorAll('.aba-conteudo').forEach(el => {
        el.classList.remove('block');
        el.classList.add('hidden');
    });
    const alvo = document.getElementById(`aba-${aba}`);
    if (alvo) {
        alvo.classList.remove('hidden');
        alvo.classList.add('block');
    }

    const btnCad = document.getElementById('btn-aba-cadastro');
    const btnGer = document.getElementById('btn-aba-gerenciar');

    if (aba === 'cadastro') {
        btnCad?.classList.add('bg-white', 'text-blue-800', 'shadow', 'font-bold');
        btnCad?.classList.remove('text-white');
        btnGer?.classList.remove('bg-white', 'text-blue-800', 'shadow', 'font-bold');
        btnGer?.classList.add('text-white');
    } else {
        btnGer?.classList.add('bg-white', 'text-blue-800', 'shadow', 'font-bold');
        btnGer?.classList.remove('text-white');
        btnCad?.classList.remove('bg-white', 'text-blue-800', 'shadow', 'font-bold');
        btnCad?.classList.add('text-white');
        carregarPacientes();
        atualizarStatusSistema();
    }
}

function aplicarMascaraData(inputEl) {
    inputEl?.addEventListener('input', function (e) {
        let v = e.target.value.replace(/\D/g, '').slice(0, 8);
        if (v.length >= 5) v = `${v.slice(0, 2)}/${v.slice(2, 4)}/${v.slice(4)}`;
        else if (v.length >= 3) v = `${v.slice(0, 2)}/${v.slice(2)}`;
        e.target.value = v;
    });
}

window.onload = () => {
    const tokenSalvo = sessionStorage.getItem('token');
    if (sessionStorage.getItem('autenticado') === 'true' && tokenSessaoValido(tokenSalvo)) {
        document.getElementById('tela-login').classList.add('hidden');
        iniciarVigilanciaToken();
        atualizarContadorSessao(tokenSalvo);
        carregarPacientes();
        atualizarStatusSistema();
    } else {
        sessionStorage.clear();
    }

    document.getElementById('senha-acesso')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') realizarLogin();
    });

    aplicarMascaraData(document.getElementById('nascimento'));
    aplicarMascaraData(document.getElementById('dataColeta'));
    aplicarMascaraData(document.getElementById('dataResultado'));
    aplicarMascaraData(document.getElementById('edit-nascimento'));
    aplicarMascaraData(document.getElementById('edit-dataColeta'));
    aplicarMascaraData(document.getElementById('edit-dataResultado'));
};

document.getElementById('formCadastro').onsubmit = async (e) => {
    e.preventDefault();
    const dados = {
        nome: document.getElementById('nome').value,
        numero: "55" + document.getElementById('numero').value.replace(/\D/g, ''),
        cpf: document.getElementById('cpf').value,
        nascimento: document.getElementById('nascimento').value,
        dataColeta: document.getElementById('dataColeta')?.value || '',
        dataResultado: document.getElementById('dataResultado')?.value || '',
        conclusao: document.getElementById('conclusao')?.value || '',
        observacoes: document.getElementById('observacoes')?.value || '',
        endereco: document.getElementById('endereco').value,
        unidade: document.getElementById('unidade').value
    };

    const res = await fetch('/cadastrar-paciente', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': sessionStorage.getItem('token')
        },
        body: JSON.stringify(dados)
    });

    if (res.ok) {
        mostrarToast("Paciente cadastrado com sucesso!", "sucesso");
        e.target.reset();
        document.getElementById('unidade').value = 'USF Vila América';
        mudarAba('gerenciar');
    } else {
        mostrarToast("Erro ao cadastrar. Verifique a sessão.", "erro");
    }
};

function converterDataBrParaTimestamp(dataStr) {
    if (!dataStr || typeof dataStr !== 'string') return null;
    const match = dataStr.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return null;
    const dia = Number(match[1]);
    const mes = Number(match[2]);
    const ano = Number(match[3]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    return Date.UTC(ano, mes - 1, dia);
}

function calcularIdade(dataBr) {
    const ts = converterDataBrParaTimestamp(dataBr);
    if (ts === null) return '';
    const nasc = new Date(ts);
    const hoje = new Date();
    let idade = hoje.getUTCFullYear() - nasc.getUTCFullYear();
    const m = hoje.getUTCMonth() - nasc.getUTCMonth();
    if (m < 0 || (m === 0 && hoje.getUTCDate() < nasc.getUTCDate())) {
        idade--;
    }
    return idade >= 0 && idade < 130 ? `${idade} anos` : '';
}

function formatarTelefoneExibicao(numero) {
    const digitos = String(numero || '').replace(/\D/g, '');
    if (!digitos) return '';
    const semDdi = digitos.startsWith('55') && digitos.length >= 12 ? digitos.slice(2) : digitos;
    if (semDdi.length === 11) {
        return `(${semDdi.slice(0, 2)}) ${semDdi.slice(2, 7)}-${semDdi.slice(7)}`;
    }
    if (semDdi.length === 10) {
        return `(${semDdi.slice(0, 2)}) ${semDdi.slice(2, 6)}-${semDdi.slice(6)}`;
    }
    return digitos;
}

function classificarPrioridadeLocal(conclusao) {
    if (!conclusao || typeof conclusao !== 'string') return 'Rotina';
    if (/\b(?:hsil|asc-h|agc|alto\s+grau|n[aã]o\s+se\s+pode\s+afastar\s+alto\s+grau|carcinoma|adenocarcinoma|glandulares|invasor)\b/i.test(conclusao)) {
        return 'Alta';
    }
    if (/\b(?:lsil|asc-us|baixo\s+grau|at[ií]pi(?:a|as|ca|cas)|les[aã]o\s+intraepitelial)\b/i.test(conclusao)) {
        return 'Moderada';
    }
    return 'Rotina';
}

function ordenarPacientesLista(lista, criterio = 'dataResultado', ordem = 'desc') {
    if (!Array.isArray(lista)) return [];
    const pesoPrioridade = { Alta: 3, Moderada: 2, Rotina: 1 };

    return [...lista].sort((a, b) => {
        if (criterio === 'prioridade') {
            const pA = pesoPrioridade[a.prioridade || classificarPrioridadeLocal(a.conclusao)] || 1;
            const pB = pesoPrioridade[b.prioridade || classificarPrioridadeLocal(b.conclusao)] || 1;
            if (pA !== pB) return ordem === 'asc' ? pA - pB : pB - pA;
            const tsA = converterDataBrParaTimestamp(a.dataResultado) || 0;
            const tsB = converterDataBrParaTimestamp(b.dataResultado) || 0;
            return tsB - tsA;
        }

        if (criterio === 'dataResultado' || criterio === 'dataColeta' || criterio === 'nascimento') {
            const tsA = converterDataBrParaTimestamp(a[criterio]);
            const tsB = converterDataBrParaTimestamp(b[criterio]);

            if (tsA === null && tsB === null) {
                return (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' });
            }
            if (tsA === null) return 1;
            if (tsB === null) return -1;
            if (tsA !== tsB) {
                return ordem === 'asc' ? tsA - tsB : tsB - tsA;
            }
            return (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' });
        }

        if (criterio === 'nome') {
            const cmp = (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' });
            return ordem === 'asc' ? cmp : -cmp;
        }

        if (criterio === 'status') {
            const cmp = (a.status || '').localeCompare(b.status || '', 'pt-BR', { sensitivity: 'base' });
            if (cmp !== 0) return ordem === 'asc' ? cmp : -cmp;
            return (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' });
        }

        const idA = Number(a.id) || 0;
        const idB = Number(b.id) || 0;
        return ordem === 'asc' ? idA - idB : idB - idA;
    });
}

function obterCriterioOrdenacaoAtual() {
    const seletor = document.getElementById('criterioOrdenacao');
    const valor = seletor?.value || 'dataResultado:desc';
    const [criterio = 'dataResultado', ordem = 'desc'] = valor.split(':');
    return { criterio, ordem };
}

function obterClasseBadgeStatus(status) {
    switch (status) {
        case 'Enviado':
            return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
        case 'Compareceu à USF':
            return 'bg-teal-100 text-teal-800 border border-teal-200';
        case 'Busca Ativa (ACS)':
            return 'bg-purple-100 text-purple-700 border border-purple-200';
        case 'Número Incorreto':
            return 'bg-red-100 text-red-700 border border-red-200';
        case 'Aguardando Confirmação':
            return 'bg-blue-100 text-blue-700 border border-blue-200';
        default:
            return 'bg-amber-100 text-amber-800 border border-amber-200';
    }
}

function atualizarIndicadoresLocais(lista) {
    const total = lista.length;
    let pendentes = 0;
    let enviados = 0;
    let compareceram = 0;
    let buscaAtiva = 0;
    let prioridadeAlta = 0;

    for (const p of lista) {
        const status = p.status || 'Pendente';
        if (status === 'Pendente') pendentes++;
        if (status === 'Enviado' || status === 'Aguardando Confirmação') enviados++;
        if (status === 'Compareceu à USF') compareceram++;

        const foneLimpo = String(p.numero || '').replace(/\D/g, '');
        if (status === 'Busca Ativa (ACS)' || status === 'Número Incorreto' || foneLimpo.length < 8) {
            buscaAtiva++;
        }

        const prio = p.prioridade || classificarPrioridadeLocal(p.conclusao);
        if (prio === 'Alta') prioridadeAlta++;
    }

    const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(val);
    };

    setEl('kpi-total', total);
    setEl('kpi-prioridade-alta', prioridadeAlta);
    setEl('kpi-pendentes', pendentes);
    setEl('kpi-enviados', enviados);
    setEl('kpi-compareceram', compareceram);
    setEl('kpi-busca-ativa', buscaAtiva);
}

let estadoEnviosWhatsApp = true;
let timerPollingQrWhatsApp = null;

function renderizarBadgeWhatsApp(whatsappConectado, enviosAtivos) {
    estadoEnviosWhatsApp = Boolean(enviosAtivos);
    const badge = document.getElementById('badge-whatsapp');
    const ponto = document.getElementById('ponto-whatsapp');
    const texto = document.getElementById('texto-whatsapp');

    const btnConexao = document.getElementById('btn-conexao-whatsapp');
    const iconeConexao = document.getElementById('icone-conexao-whatsapp');
    const textoConexao = document.getElementById('texto-conexao-whatsapp');

    if (btnConexao && iconeConexao && textoConexao) {
        if (whatsappConectado) {
            btnConexao.className = 'flex items-center gap-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-300/40 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer shadow-sm';
            iconeConexao.className = 'fas fa-check-circle text-sm text-emerald-300';
            textoConexao.textContent = 'Aparelho Conectado';
        } else {
            btnConexao.className = 'flex items-center gap-2 bg-rose-500/80 hover:bg-rose-500 border border-rose-300 px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer shadow';
            iconeConexao.className = 'fas fa-qrcode text-sm text-white';
            textoConexao.textContent = 'Conectar WhatsApp (QR)';
        }
    }

    if (!ponto || !texto || !badge) return;

    if (!enviosAtivos) {
        ponto.className = 'w-2.5 h-2.5 rounded-full bg-amber-300';
        badge.className = 'flex items-center gap-2 bg-amber-500/90 hover:bg-amber-500 text-slate-950 border border-amber-300 px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer shadow';
        texto.innerHTML = '<i class="fas fa-pause-circle mr-1"></i>Modo Teste (Envios Pausados)';
        return;
    }

    badge.className = 'flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer shadow-sm';
    if (whatsappConectado) {
        ponto.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
        texto.textContent = 'Envios Ativos (Conectado)';
    } else {
        ponto.className = 'w-2.5 h-2.5 rounded-full bg-rose-400';
        texto.textContent = 'Envios Ativos (Sem Aparelho)';
    }
}

async function consultarQrCodeWhatsApp() {
    try {
        const res = await fetch('/whatsapp/qrcode', {
            headers: { 'Authorization': sessionStorage.getItem('token') }
        });
        if (res.status === 401) return bloquearSistema();
        if (!res.ok) return;

        const dados = await res.json();
        renderizarBadgeWhatsApp(dados.conectado, dados.enviosWhatsAppAtivos);

        const divConectado = document.getElementById('wa-modal-conectado');
        const divDesconectado = document.getElementById('wa-modal-desconectado');
        const imgQr = document.getElementById('img-qrcode-whatsapp');
        const loadingQr = document.getElementById('loading-qrcode-whatsapp');

        if (dados.conectado) {
            divConectado?.classList.remove('hidden');
            divDesconectado?.classList.add('hidden');
        } else {
            divConectado?.classList.add('hidden');
            divDesconectado?.classList.remove('hidden');

            if (dados.qrDisponivel && dados.qrSvgDataUrl && imgQr && loadingQr) {
                imgQr.src = dados.qrSvgDataUrl;
                imgQr.classList.remove('hidden');
                loadingQr.classList.add('hidden');
            } else if (imgQr && loadingQr) {
                imgQr.classList.add('hidden');
                loadingQr.classList.remove('hidden');
            }
        }
    } catch {
        // Ignora falhas de rede temporárias
    }
}

function abrirModalWhatsApp() {
    const modal = document.getElementById('modalWhatsApp');
    if (!modal) return;
    modal.classList.remove('hidden');
    consultarQrCodeWhatsApp();

    if (timerPollingQrWhatsApp) clearInterval(timerPollingQrWhatsApp);
    timerPollingQrWhatsApp = setInterval(consultarQrCodeWhatsApp, 3000);
}

function fecharModalWhatsApp() {
    const modal = document.getElementById('modalWhatsApp');
    if (modal) modal.classList.add('hidden');
    if (timerPollingQrWhatsApp) {
        clearInterval(timerPollingQrWhatsApp);
        timerPollingQrWhatsApp = null;
    }
}

async function reconectarWhatsApp(novaSessao = false) {
    if (novaSessao) {
        if (!confirm('Deseja desconectar o aparelho atual e gerar um novo QR Code?')) return;
    }

    const imgQr = document.getElementById('img-qrcode-whatsapp');
    const loadingQr = document.getElementById('loading-qrcode-whatsapp');
    const divConectado = document.getElementById('wa-modal-conectado');
    const divDesconectado = document.getElementById('wa-modal-desconectado');

    divConectado?.classList.add('hidden');
    divDesconectado?.classList.remove('hidden');
    imgQr?.classList.add('hidden');
    loadingQr?.classList.remove('hidden');

    try {
        const res = await fetch('/whatsapp/reconectar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': sessionStorage.getItem('token')
            },
            body: JSON.stringify({ novaSessao })
        });
        if (!res.ok) {
            mostrarToast('Não foi possível solicitar novo QR Code.', 'erro');
            return;
        }
        mostrarToast('Gerando novo QR Code seguro...', 'info');
        setTimeout(consultarQrCodeWhatsApp, 1500);
    } catch {
        mostrarToast('Erro de conexão com o servidor.', 'erro');
    }
}

async function alternarEnviosWhatsApp() {
    const novoEstado = !estadoEnviosWhatsApp;
    if (novoEstado) {
        if (!confirm("Deseja ATIVAR o envio real de mensagens de WhatsApp para os pacientes?")) return;
    }

    try {
        const res = await fetch('/configurar-envios-whatsapp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': sessionStorage.getItem('token')
            },
            body: JSON.stringify({ ativo: novoEstado })
        });
        if (!res.ok) return;
        const dados = await res.json();
        renderizarBadgeWhatsApp(dados.whatsappConectado, dados.enviosWhatsAppAtivos);
        if (dados.enviosWhatsAppAtivos) {
            mostrarToast('Envio real de notificações WhatsApp ATIVADO.', 'sucesso');
        } else {
            mostrarToast('Modo de Teste ATIVADO: nenhum WhatsApp será enviado aos pacientes.', 'aviso');
        }
    } catch {
        mostrarToast('Erro ao alterar configuração de envios.', 'erro');
    }
}

async function atualizarStatusSistema() {
    try {
        const res = await fetch('/status-sistema', {
            headers: { 'Authorization': sessionStorage.getItem('token') }
        });
        if (!res.ok) return;
        const dados = await res.json();
        renderizarBadgeWhatsApp(dados.whatsappConectado, dados.enviosWhatsAppAtivos);
    } catch {
        // Ignora silenciosamente falhas de rede pontuais
    }
}

function renderizarTabelaPacientes(lista) {
    const corpo = document.getElementById('tabelaPacientes');
    if (!corpo) return;

    if (lista.length === 0) {
        corpo.innerHTML = `
            <tr>
                <td colspan="7" class="px-6 py-12 text-center text-slate-400">
                    <i class="fas fa-folder-open text-3xl mb-2 block text-slate-300"></i>
                    Nenhum paciente cadastrado encontrado.
                </td>
            </tr>
        `;
        filtrarTabela();
        return;
    }

    corpo.innerHTML = lista.map(p => {
        const idSeguro = Number(p.id) || 0;
        const nomeSeguro = escaparHtml(p.nome);
        const cpfSeguro = escaparHtml(p.cpf || 'Sem CNS/CPF');
        const nascSeguro = escaparHtml(p.nascimento || '--/--/----');
        const idadeTexto = calcularIdade(p.nascimento);
        const dataColSeguro = escaparHtml(p.dataColeta || 'Sem data');
        const dataResSeguro = escaparHtml(p.dataResultado || 'Sem data');
        const foneFormatado = formatarTelefoneExibicao(p.numero);
        const numeroSeguro = escaparHtml(foneFormatado);
        const enderecoSeguro = escaparHtml(p.endereco || 'Endereço não informado');
        const statusSeguro = escaparHtml(p.status || 'Pendente');
        const conclusaoSegura = escaparHtml(p.conclusao || 'Aguardando laudo...');
        const observacoesSeguras = escaparHtml(p.observacoes || '');
        const prioridade = p.prioridade || classificarPrioridadeLocal(p.conclusao);

        const badgePrioridade = prioridade === 'Alta'
            ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-rose-100 text-rose-700 border border-rose-200"><i class="fas fa-exclamation-circle mr-1"></i>Prioridade Alta</span>`
            : prioridade === 'Moderada'
                ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-50 text-amber-700 border border-amber-200">Prioridade Moderada</span>`
                : '';

        const htmlTelefone = foneFormatado
            ? `<div class="font-semibold text-slate-700"><i class="fab fa-whatsapp text-emerald-500 mr-1"></i>${numeroSeguro}</div>`
            : `<span class="inline-flex items-center gap-1 text-[11px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-md"><i class="fas fa-phone-slash"></i> Sem telefone</span>`;

        const htmlObservacoes = observacoesSeguras
            ? `<div class="mt-1 text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-2.5 py-1"><i class="fas fa-sticky-note mr-1"></i>${observacoesSeguras}</div>`
            : '';

        return `
        <tr class="hover:bg-slate-50/90 transition border-b border-slate-100"
            data-status="${statusSeguro}"
            data-prioridade="${escaparHtml(prioridade)}"
            data-sem-telefone="${foneFormatado ? 'false' : 'true'}">
            <td class="px-6 py-4 font-bold align-top">
                <div class="text-slate-800">${nomeSeguro}</div>
                <span class="text-[11px] font-medium text-slate-400">CNS/CPF: ${cpfSeguro}</span>
            </td>
            
            <!-- CÉLULA: DATA DE NASCIMENTO -->
            <td class="px-6 py-4 text-sm align-top whitespace-nowrap">
                <div class="text-slate-700 font-medium"><i class="fas fa-birthday-cake text-slate-300 mr-1"></i> ${nascSeguro}</div>
                ${idadeTexto ? `<span class="text-[11px] text-slate-400">${escaparHtml(idadeTexto)}</span>` : ''}
            </td>

            <!-- CÉLULA: DATA DA COLETA -->
            <td class="px-6 py-4 text-sm align-top whitespace-nowrap">
                <div class="text-[11px] font-bold text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-2.5 py-1 inline-block whitespace-nowrap" title="Data da Coleta do Exame">
                    <i class="fas fa-vial mr-1"></i> ${dataColSeguro}
                </div>
            </td>

            <!-- CÉLULA: DATA DO LAUDO -->
            <td class="px-6 py-4 text-sm align-top whitespace-nowrap">
                <div class="text-[11px] font-bold text-blue-700 bg-blue-100 border border-blue-200 rounded-lg px-2.5 py-1 inline-block whitespace-nowrap" title="Data do Resultado">
                    <i class="far fa-calendar-check mr-1"></i> ${dataResSeguro}
                </div>
            </td>

            <td class="px-6 py-4 text-sm align-top max-w-xs">
                ${htmlTelefone}
                <div class="text-[11px] text-slate-500 mt-1 leading-snug"><i class="fas fa-map-marker-alt text-slate-300 mr-1"></i>${enderecoSeguro}</div>
            </td>
            <td class="px-6 py-4 flex flex-col items-start gap-1.5">
                <div class="flex flex-wrap items-center gap-1.5">
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${obterClasseBadgeStatus(p.status)}">
                        ${statusSeguro}
                    </span>
                    ${badgePrioridade}
                </div>
                <!-- TEXTO DO LAUDO COM QUEBRA DE LINHA ATIVADA -->
                <div class="text-[11px] font-medium text-slate-600 bg-slate-100 p-2.5 rounded-xl max-w-sm break-words leading-relaxed whitespace-normal border border-slate-200" title="Laudo completo">
                    <i class="fas fa-microscope text-blue-500 mr-1"></i> ${conclusaoSegura}
                </div>
                ${htmlObservacoes}
            </td>
            <td class="px-6 py-4 text-center align-top whitespace-nowrap">
                <div class="flex justify-center items-center gap-1.5">
                    <button onclick="enviarMensagem(${idSeguro})" class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white transition flex items-center justify-center" title="Enviar Notificação por WhatsApp">
                        <i class="fas fa-paper-plane text-xs"></i>
                    </button>
                    <button onclick="alterarStatusRapido(${idSeguro}, 'Compareceu à USF')" class="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 hover:bg-teal-600 hover:text-white transition flex items-center justify-center" title="Marcar que a paciente compareceu à USF">
                        <i class="fas fa-check-double text-xs"></i>
                    </button>
                    <button onclick="alterarStatusRapido(${idSeguro}, 'Busca Ativa (ACS)')" class="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 hover:bg-purple-600 hover:text-white transition flex items-center justify-center" title="Encaminhar para Busca Ativa Domiciliar (ACS)">
                        <i class="fas fa-walking text-xs"></i>
                    </button>
                    <button onclick="abrirEdicaoPorId(${idSeguro})" class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white transition flex items-center justify-center" title="Editar Cadastro e Observações">
                        <i class="fas fa-edit text-xs"></i>
                    </button>
                    <button onclick="excluirPaciente(${idSeguro})" class="w-8 h-8 rounded-lg bg-slate-100 text-slate-400 hover:bg-red-600 hover:text-white transition flex items-center justify-center" title="Excluir Cadastro">
                        <i class="fas fa-trash text-xs"></i>
                    </button>
                </div>
            </td>
        </tr>
    `;
    }).join('');

    filtrarTabela();
}

function aplicarOrdenacao() {
    const { criterio, ordem } = obterCriterioOrdenacaoAtual();
    const listaOrdenada = ordenarPacientesLista(pacientesCarregados, criterio, ordem);
    atualizarIndicadoresLocais(pacientesCarregados);
    renderizarTabelaPacientes(listaOrdenada);
}

async function carregarPacientes() {
    const { criterio, ordem } = obterCriterioOrdenacaoAtual();
    const res = await fetch(`/pacientes?ordenarPor=${encodeURIComponent(criterio)}&ordem=${encodeURIComponent(ordem)}`, {
        headers: { 'Authorization': sessionStorage.getItem('token') }
    });

    if (res.status === 401 || res.status === 403) return bloquearSistema();

    pacientesCarregados = await res.json();
    aplicarOrdenacao();
}

function selecionarFiltroRapido(valorFiltro) {
    const selectFiltro = document.getElementById('filtroStatus');
    if (selectFiltro) {
        selectFiltro.value = valorFiltro;
    }

    document.querySelectorAll('.kpi-card').forEach(card => {
        card.classList.remove('border-2', 'border-blue-500');
        card.classList.add('border', 'border-slate-200');
    });

    const mapaCard = {
        'todos': 'card-kpi-todos',
        'prioridade:Alta': 'card-kpi-alta',
        'Pendente': 'card-kpi-pendentes',
        'Enviado': 'card-kpi-enviados',
        'Compareceu à USF': 'card-kpi-compareceram',
        'buscaAtiva': 'card-kpi-busca-ativa'
    };

    const cardAtivo = document.getElementById(mapaCard[valorFiltro]);
    if (cardAtivo) {
        cardAtivo.classList.remove('border', 'border-slate-200');
        cardAtivo.classList.add('border-2', 'border-blue-500');
    }

    filtrarTabela();
}

function filtrarTabela() {
    const termo = (document.getElementById('busca')?.value || '').toLowerCase();
    const filtroStatus = document.getElementById('filtroStatus')?.value || 'todos';
    let visiveis = 0;

    document.querySelectorAll('#tabelaPacientes tr').forEach(tr => {
        if (!tr.dataset.status) return;
        const textoLinha = tr.innerText.toLowerCase();
        const bateTexto = !termo || textoLinha.includes(termo);

        let bateStatus = true;
        if (filtroStatus === 'prioridade:Alta') {
            bateStatus = tr.dataset.prioridade === 'Alta';
        } else if (filtroStatus === 'prioridade:Moderada') {
            bateStatus = tr.dataset.prioridade === 'Moderada';
        } else if (filtroStatus === 'buscaAtiva') {
            bateStatus =
                tr.dataset.status === 'Busca Ativa (ACS)' ||
                tr.dataset.status === 'Número Incorreto' ||
                tr.dataset.semTelefone === 'true';
        } else if (filtroStatus !== 'todos') {
            bateStatus = tr.dataset.status === filtroStatus;
        }

        const exibir = bateTexto && bateStatus;
        tr.style.display = exibir ? '' : 'none';
        if (exibir) visiveis++;
    });

    const contadorEl = document.getElementById('contador-registros');
    if (contadorEl) {
        contadorEl.textContent = `${visiveis}`;
    }
}

async function dispararSincronizacao() {
    if (!confirm("Deseja iniciar a varredura dos últimos 6 meses de laudos no SISCAN?")) return;

    const btn = event.currentTarget;
    const textoOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Sincronizando...';

    try {
        const res = await fetch('/sincronizar-ministerio', {
            method: 'GET',
            headers: { 'Authorization': sessionStorage.getItem('token') }
        });

        if (res.status === 401) return bloquearSistema();

        const data = await res.json();
        if (res.ok) {
            mostrarToast(`Sincronização SISCAN concluída! ${data.totalEncontrados || 0} laudos com atipia processados.`, "sucesso");
            carregarPacientes();
        } else {
            mostrarToast(`Erro na sincronização: ${data.error || 'Erro desconhecido'}`, "erro");
        }
    } catch (err) {
        mostrarToast("Falha de conexão com o servidor.", "erro");
        console.error(err);
    } finally {
        btn.disabled = false;
        btn.innerHTML = textoOriginal;
    }
}

async function dispararSincronizacaoPec() {
    if (!confirm("Deseja consultar o PEC do município para atualizar telefone e endereço dos pacientes cadastrados?")) return;

    const btn = event.currentTarget;
    const textoOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Consultando PEC...';

    try {
        const res = await fetch('/sincronizar-pec', {
            method: 'POST',
            headers: { 'Authorization': sessionStorage.getItem('token') }
        });

        if (res.status === 401) return bloquearSistema();

        const data = await res.json();
        if (res.ok) {
            mostrarToast(`Consulta ao PEC concluída! Contatos atualizados: ${data.totalAtualizados || 0} de ${data.totalAnalisados || 0} pacientes.`, "sucesso");
            carregarPacientes();
        } else {
            mostrarToast(`Não foi possível atualizar pelo PEC: ${data.error || 'Erro desconhecido'}`, "aviso");
        }
    } catch (err) {
        mostrarToast("Falha de conexão com o servidor.", "erro");
        console.error(err);
    } finally {
        btn.disabled = false;
        btn.innerHTML = textoOriginal;
    }
}

async function dispararLotePendentes() {
    if (!confirm("Deseja enviar notificação via WhatsApp para todas as pacientes com status 'Pendente' que possuem telefone?")) return;

    const btn = event.currentTarget;
    const textoOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Enviando...';

    try {
        const res = await fetch('/enviar-notificacoes-pendentes', {
            method: 'POST',
            headers: { 'Authorization': sessionStorage.getItem('token') }
        });

        if (res.status === 401) return bloquearSistema();

        const data = await res.json();
        if (res.ok) {
            mostrarToast(`Disparo concluído: ${data.enviados} enviada(s), ${data.ignoradosSemTelefone} sem telefone.`, "sucesso");
            carregarPacientes();
        } else {
            mostrarToast(`Erro no disparo em lote: ${data.error || 'Falha'}`, "erro");
        }
    } catch {
        mostrarToast("Falha ao comunicar com o servidor.", "erro");
    } finally {
        btn.disabled = false;
        btn.innerHTML = textoOriginal;
    }
}

async function importarArquivoPdfLocal(event) {
    const arquivo = event.target.files?.[0];
    if (!arquivo) return;

    mostrarToast(`Analisando localmente o arquivo ${arquivo.name}...`, "info");

    try {
        const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(arquivo);
        });

        const res = await fetch('/importar-pdf-laudos', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': sessionStorage.getItem('token')
            },
            body: JSON.stringify({ nomeArquivo: arquivo.name, conteudoBase64: base64 })
        });

        if (res.status === 401) return bloquearSistema();

        const data = await res.json();
        if (res.ok) {
            mostrarToast(`PDF processado! ${data.totalAtipicosEncontrados} laudo(s) com atipia (${data.novosCadastros} novos, ${data.atualizados} atualizados).`, "sucesso");
            carregarPacientes();
        } else {
            mostrarToast(`Erro ao importar PDF: ${data.error || 'Arquivo inválido'}`, "erro");
        }
    } catch {
        mostrarToast("Erro ao ler o arquivo PDF selecionado.", "erro");
    } finally {
        event.target.value = '';
    }
}

async function enviarMensagem(id) {
    const res = await fetch(`/enviar-notificacao/${id}`, {
        method: 'POST',
        headers: { 'Authorization': sessionStorage.getItem('token') }
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
        mostrarToast("Mensagem de confirmação enviada via WhatsApp!", "sucesso");
    } else {
        mostrarToast(data.error || "Não foi possível enviar a mensagem.", "aviso");
    }
    carregarPacientes();
}

async function alterarStatusRapido(id, novoStatus) {
    const res = await fetch(`/pacientes/${id}/status`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': sessionStorage.getItem('token')
        },
        body: JSON.stringify({ status: novoStatus })
    });

    if (res.ok) {
        mostrarToast(`Status atualizado para "${novoStatus}".`, "sucesso");
        carregarPacientes();
    } else {
        mostrarToast("Erro ao atualizar status da paciente.", "erro");
    }
}

async function excluirPaciente(id) {
    if (confirm("Deseja realmente excluir este cadastro de forma permanente?")) {
        await fetch(`/pacientes/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': sessionStorage.getItem('token') }
        });
        mostrarToast("Cadastro removido.", "info");
        carregarPacientes();
    }
}

// Modal de Edição
function abrirEdicaoPorId(id) {
    const p = pacientesCarregados.find(item => Number(item.id) === Number(id));
    if (p) abrirEdicao(p);
}

function abrirEdicao(p) {
    document.getElementById('edit-id').value = p.id;
    document.getElementById('edit-nome').value = p.nome || '';
    document.getElementById('edit-numero').value = (p.numero || '').replace(/^55/, '');
    document.getElementById('edit-cpf').value = p.cpf || '';
    document.getElementById('edit-nascimento').value = p.nascimento || '';
    if (document.getElementById('edit-dataColeta')) {
        document.getElementById('edit-dataColeta').value = p.dataColeta || '';
    }
    if (document.getElementById('edit-dataResultado')) {
        document.getElementById('edit-dataResultado').value = p.dataResultado || '';
    }
    if (document.getElementById('edit-status')) {
        document.getElementById('edit-status').value = p.status || 'Pendente';
    }
    if (document.getElementById('edit-observacoes')) {
        document.getElementById('edit-observacoes').value = p.observacoes || '';
    }
    document.getElementById('edit-endereco').value = p.endereco || '';
    document.getElementById('edit-unidade').value = p.unidade || 'USF Vila América';
    document.getElementById('modalEdicao').classList.remove('hidden');
}

function fecharModal() {
    document.getElementById('modalEdicao').classList.add('hidden');
}

document.getElementById('formEdicao').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-id').value;
    const foneDigitado = document.getElementById('edit-numero').value.replace(/\D/g, '');
    const dados = {
        nome: document.getElementById('edit-nome').value,
        numero: foneDigitado ? (foneDigitado.startsWith('55') ? foneDigitado : "55" + foneDigitado) : '',
        cpf: document.getElementById('edit-cpf').value,
        nascimento: document.getElementById('edit-nascimento').value,
        dataColeta: document.getElementById('edit-dataColeta')?.value || '',
        dataResultado: document.getElementById('edit-dataResultado')?.value || '',
        status: document.getElementById('edit-status')?.value || 'Pendente',
        observacoes: document.getElementById('edit-observacoes')?.value || '',
        endereco: document.getElementById('edit-endereco').value,
        unidade: document.getElementById('edit-unidade').value
    };
    const res = await fetch(`/editar-paciente/${id}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': sessionStorage.getItem('token')
        },
        body: JSON.stringify(dados)
    });
    fecharModal();
    if (res.ok) {
        mostrarToast("Dados da paciente atualizados com sucesso!", "sucesso");
    }
    carregarPacientes();
};

// Modal de Relatório de Busca Ativa Domiciliar (ACS) - LGPD Safe (sem expor diagnóstico detalhado na folha impressa)
function abrirModalBuscaAtiva() {
    const corpo = document.getElementById('tabelaBuscaAtiva');
    if (!corpo) return;

    const listaBusca = pacientesCarregados.filter(p => {
        const foneLimpo = String(p.numero || '').replace(/\D/g, '');
        return (
            p.status !== 'Compareceu à USF' &&
            (p.status === 'Busca Ativa (ACS)' || p.status === 'Número Incorreto' || p.status === 'Pendente' || foneLimpo.length < 8)
        );
    });

    if (listaBusca.length === 0) {
        corpo.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">Nenhuma paciente pendente para busca ativa no momento.</td></tr>`;
    } else {
        corpo.innerHTML = listaBusca.map(p => {
            const prio = p.prioridade || classificarPrioridadeLocal(p.conclusao);
            return `
                <tr>
                    <td class="p-3 border-b font-bold text-slate-800">
                        ${escaparHtml(p.nome)}<br>
                        <span class="text-[10px] font-normal text-slate-500">CNS/CPF: ${escaparHtml(p.cpf || '--')}</span>
                    </td>
                    <td class="p-3 border-b whitespace-nowrap">${escaparHtml(p.nascimento || '--/--/----')}</td>
                    <td class="p-3 border-b whitespace-nowrap">
                        <span class="font-bold ${prio === 'Alta' ? 'text-rose-600' : 'text-amber-700'}">Prioridade ${escaparHtml(prio)}</span><br>
                        <span class="text-[10px] text-slate-500">Laudo: ${escaparHtml(p.dataResultado || '--')}</span>
                    </td>
                    <td class="p-3 border-b">
                        <div class="font-semibold">${escaparHtml(formatarTelefoneExibicao(p.numero) || 'Sem telefone')}</div>
                        <div class="text-slate-600">${escaparHtml(p.endereco || 'Consultar prontuário/PEC')}</div>
                    </td>
                    <td class="p-3 border-b text-slate-500">
                        ${escaparHtml(p.observacoes || 'Solicitar comparecimento à USF para resultado de exame.')}
                    </td>
                </tr>
            `;
        }).join('');
    }

    document.getElementById('modalBuscaAtiva').classList.remove('hidden');
}

function fecharModalBuscaAtiva() {
    document.getElementById('modalBuscaAtiva').classList.add('hidden');
}
