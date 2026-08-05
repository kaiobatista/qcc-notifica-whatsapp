let monitor_de_acesso;

// AUTH

function iniciarVigilanciaToken() {
    if (monitor_de_acesso) clearInterval(monitor_de_acesso);

    monitor_de_acesso = setInterval(() => {
        const token = sessionStorage.getItem('token');
        if (!token) return;

        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const expiraEmMs = payload.exp * 1000;
            if (Date.now() >= expiraEmMs) {
                bloquearSistema();
            }
        } catch (e) {
            bloquearSistema();
        }
    }, 2000);
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
        document.getElementById('tela-login').classList.add('opacity-0', 'pointer-events-none');
        iniciarVigilanciaToken();
    } else {
        const erro = document.getElementById('erro-login');
        erro.classList.remove('hidden');
        document.getElementById('senha-acesso').value = '';
    }
}

// NAVEGAÇÃO E UI

function mudarAba(aba) {
    document.querySelectorAll('.aba-conteudo').forEach(el => el.classList.replace('block', 'hidden'));
    document.getElementById(`aba-${aba}`).classList.replace('hidden', 'block');
    
    const btnCad = document.getElementById('btn-aba-cadastro');
    const btnGer = document.getElementById('btn-aba-gerenciar');
    
    if(aba === 'cadastro') {
        btnCad.classList.add('bg-blue-800', 'shadow-inner');
        btnGer.classList.remove('bg-blue-800', 'shadow-inner');
    } else {
        btnGer.classList.add('bg-blue-800', 'shadow-inner');
        btnCad.classList.remove('bg-blue-800', 'shadow-inner');
        carregarPacientes();
    }
}


window.onload = () => {
    if (sessionStorage.getItem('autenticado') === 'true') {
        document.getElementById('tela-login').classList.add('hidden');
        iniciarVigilanciaToken();
    }

    document.getElementById('senha-acesso')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') realizarLogin();
    });

    document.getElementById('nascimento')?.addEventListener('input', function(e){
        let v = e.target.value.replace(/\D/g,'').slice(0,8);
        if(v.length >= 5) v = `${v.slice(0,2)}/${v.slice(2,4)}/${v.slice(4)}`;
        else if(v.length >= 3) v = `${v.slice(0,2)}/${v.slice(2)}`;
        e.target.value = v;
    });
};

document.getElementById('formCadastro').onsubmit = async (e) => {
    e.preventDefault();
    const dados = {
        nome: document.getElementById('nome').value,
        numero: "55" + document.getElementById('numero').value.replace(/\D/g, ''),
        cpf: document.getElementById('cpf').value,
        nascimento: document.getElementById('nascimento').value,
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

    if(res.ok) {
        alert("Paciente cadastrado com sucesso!");
        e.target.reset();
    } else {
        alert("Erro ao cadastrar. Verifique a sessão.");
    }
};

async function carregarPacientes() {
    const corpo = document.getElementById('tabelaPacientes');
    const res = await fetch('/pacientes', {
        headers: {'Authorization': sessionStorage.getItem('token')}
    });

    if (res.status === 401) return bloquearSistema();

    const lista = await res.json();
    corpo.innerHTML = lista.reverse().map(p => `
        <tr class="hover:bg-slate-50 border-b border-slate-50">
            <td class="px-6 py-4 font-bold align-top">${p.nome}<br><span class="text-[10px] font-normal">${p.cpf}</span></td>
            <td class="px-6 py-4 text-sm align-top">${p.nascimento}</td>
            <td class="px-6 py-4 text-sm align-top">${p.numero}<br><span class="text-[10px] text-slate-400">${p.endereco}</span></td>
            <td class="px-6 py-4 flex flex-col items-start gap-2">
                <span class="px-2 py-1 rounded-full text-[10px] font-bold uppercase ${p.status === 'Enviado' ? 'bg-emerald-100 text-emerald-700' : p.status === 'Número Incorreto' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}">
                    ${p.status}
                </span>
                <!-- TEXTO DO LAUDO COM QUEBRA DE LINHA ATIVADA -->
                <div class="text-[11px] font-medium text-slate-600 bg-slate-100 p-2 rounded-lg max-w-xs break-words leading-relaxed whitespace-normal border border-slate-200" title="Laudo completo">
                    <i class="fas fa-microscope text-blue-500 mr-1"></i> ${p.conclusao || 'Aguardando laudo...'}
                </div>
            </td>
            <td class="px-6 py-4 text-center align-top">
                <div class="flex justify-center gap-3">
                    <button onclick="enviarMensagem(${p.id})" class="text-emerald-500 hover:scale-110 transition" title="Enviar WhatsApp"><i class="fas fa-paper-plane"></i></button>
                    <button onclick='abrirEdicao(${JSON.stringify(p).replace(/'/g, "&apos;")})' class="text-blue-500 hover:scale-110 transition" title="Editar"><i class="fas fa-edit"></i></button>
                    <button onclick="excluirPaciente(${p.id})" class="text-slate-300 hover:text-red-500 transition" title="Excluir"><i class="fas fa-trash"></i></button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function dispararSincronizacao() {
    if (!confirm("Deseja iniciar a varredura e sincronização manual com o SISCAN?")) return;

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
            alert(`Sincronização concluída com sucesso! Total de laudos processados: ${data.totalEncontrados || 0}`);
            carregarPacientes();
        } else {
            alert(`Erro na sincronização: ${data.error || 'Erro desconhecido'}`);
        }
    } catch (err) {
        alert("Falha de conexão com o servidor.");
        console.error(err);
    } finally {
        btn.disabled = false;
        btn.innerHTML = textoOriginal;
    }
}

async function enviarMensagem(id) { 
    const res = await fetch(`/enviar-notificacao/${id}`, {
        method:'POST', 
        headers: {'Authorization': sessionStorage.getItem('token')}
    }); 
    if(res.ok) alert("Notificação enviada!");
    carregarPacientes(); 
}

async function excluirPaciente(id) { 
    if(confirm("Deseja realmente excluir este cadastro?")){ 
        await fetch(`/pacientes/${id}`, {
            method:'DELETE', 
            headers: {'Authorization': sessionStorage.getItem('token')}
        }); 
        carregarPacientes(); 
    } 
}

function filtrarTabela() {
    const termo = document.getElementById('busca').value.toLowerCase();
    document.querySelectorAll('#tabelaPacientes tr').forEach(tr => tr.style.display = tr.innerText.toLowerCase().includes(termo) ? '' : 'none');
}

// Modal de Edição
function abrirEdicao(p) {
    document.getElementById('edit-id').value = p.id;
    document.getElementById('edit-nome').value = p.nome;
    document.getElementById('edit-numero').value = p.numero.replace('55','');
    document.getElementById('edit-cpf').value = p.cpf;
    document.getElementById('edit-nascimento').value = p.nascimento;
    document.getElementById('edit-endereco').value = p.endereco;
    document.getElementById('edit-unidade').value = p.unidade;
    document.getElementById('modalEdicao').classList.remove('hidden');
}

function fecharModal() { document.getElementById('modalEdicao').classList.add('hidden'); }

document.getElementById('formEdicao').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-id').value;
    const dados = {
        nome: document.getElementById('edit-nome').value,
        numero: "55" + document.getElementById('edit-numero').value.replace(/\D/g, ''),
        cpf: document.getElementById('edit-cpf').value,
        nascimento: document.getElementById('edit-nascimento').value,
        endereco: document.getElementById('edit-endereco').value,
        unidade: document.getElementById('edit-unidade').value
    };
    await fetch(`/editar-paciente/${id}`, { 
        method: 'PUT', 
        headers: {
            'Content-Type': 'application/json',
            'Authorization': sessionStorage.getItem('token')
        }, 
        body: JSON.stringify(dados) 
    });
    fecharModal();
    carregarPacientes();
};