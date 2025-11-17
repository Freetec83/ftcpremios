// === FTC PRÊMIOS - SISTEMA DE RIFAS ===
// Substitua todo o seu Code.gs por este conteúdo

const SENHA_SORTEIO = '8378';

// ---------------------------
// doGet -> exibe index.html
// ---------------------------
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('FTC Prêmios - Rifa Online');
}

// ---------------------------
// Listar números (A2:B101)
// ---------------------------
function listarNumeros() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('rifa');
  if (!sheet) return [];
  const dados = sheet.getRange('A2:B101').getValues();
  return dados.map(r => ({ numero: r[0], status: r[1] }));
}

// ---------------------------
// Reserva (verifica 1 aposta por telefone)
// ---------------------------
function reservarNumero(numero, nome, email, contato) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('rifa');
  if (!sheet) return { success: false, message: 'Planilha "rifa" não encontrada.' };

  // normaliza contato (remove espaços)
  const contatoNorm = String(contato || '').replace(/\s+/g, '');

  // 1) checar se telefone já tem aposta ativa (Reservado ou Pago)
  const contatos = sheet.getRange('E2:E101').getValues().map(r => String(r[0] || '').replace(/\s+/g, ''));
  const statusTodas = sheet.getRange('B2:B101').getValues().map(r => String(r[0] || ''));

  for (let i = 0; i < contatos.length; i++) {
    if (contatos[i] && contatos[i] === contatoNorm && (statusTodas[i] === 'Reservado' || statusTodas[i] === 'Pago')) {
      return { success: false, message: '⚠️ Este telefone já possui uma aposta ativa.' };
    }
  }

  // 2) localizar o número e reservar
  const numeros = sheet.getRange('A2:A101').getValues().map(r => String(r[0]));
  for (let i = 0; i < numeros.length; i++) {
    if (String(numeros[i]) === String(numero)) {
      const linha = i + 2;
      const status = sheet.getRange(`B${linha}`).getValue() || 'Disponível';
      if (status === 'Disponível') {
        const codigo = gerarCodigo();
        sheet.getRange(`B${linha}`).setValue('Reservado');
        sheet.getRange(`C${linha}`).setValue(nome);
        sheet.getRange(`D${linha}`).setValue(email);
        sheet.getRange(`E${linha}`).setValue(contatoNorm);
        sheet.getRange(`F${linha}`).setValue(codigo);
        sheet.getRange(`G${linha}`).setValue(new Date());
        sheet.getRange(`H${linha}`).setValue('Não');

        // Retornar dados úteis ao frontend para construir mensagem whatsapp
        return {
          success: true,
          message: `✅ Número ${numero} reservado com sucesso! Código: ${codigo}`,
          reserva: {
            numero: String(numero),
            codigo: codigo,
            nome: nome,
            email: email,
            contato: contatoNorm
          },
          grupoWhatsapp: 'https://chat.whatsapp.com/KzozjpPbC3UHIIEkTYuQrg'
        };
      } else {
        return { success: false, message: `⚠️ O número ${numero} já foi reservado ou pago.` };
      }
    }
  }

  return { success: false, message: '❌ Número não encontrado.' };
}

// ---------------------------
// Confirmar pagamento (marca Pago) - mantive caso queira usar manualmente no admin
// ---------------------------
function confirmarPagamentoNoSheet(numero) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('rifa');
  if (!sheet) return { success: false, message: 'Planilha "rifa" não encontrada.' };

  const numeros = sheet.getRange('A2:A101').getValues().map(r => String(r[0]));
  for (let i = 0; i < numeros.length; i++) {
    if (String(numeros[i]) === String(numero)) {
      const linha = i + 2;
      sheet.getRange(`B${linha}`).setValue('Pago');
      sheet.getRange(`H${linha}`).setValue('Sim');
      // Não usamos coluna I no seu layout; se quiser registrar data, pode usar outra coluna
      return { success: true, message: `✅ Número ${numero} marcado como Pago.` };
    }
  }
  return { success: false, message: 'Número não encontrado.' };
}

// ---------------------------
// Dados do sorteio (K2..N2)
// ---------------------------
function dadosSorteio() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('rifa');
  if (!sheet) return { numeroSorteio: "--", dataHora: "--", valor: "--", premio: "--" };
  return {
    numeroSorteio: sheet.getRange("K2").getValue() || "",
    dataHora: sheet.getRange("L2").getValue() || "",
    valor: sheet.getRange("M2").getValue() || "",
    premio: sheet.getRange("N2").getValue() || ""
  };
}

// ---------------------------
// Salvar dados do sorteio (editáveis pelo admin)
// ---------------------------
function salvarDadosSorteio(numero, dataHora, valor, premio) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('rifa');
  if (!sheet) return { success: false };
  sheet.getRange("K2").setValue(numero || "");
  sheet.getRange("L2").setValue(dataHora || "");
  sheet.getRange("M2").setValue(valor || "");
  sheet.getRange("N2").setValue(premio || "");
  return { success: true };
}

// ---------------------------
// Realizar Sorteio (apenas números Pago) - valida senha server-side
// ---------------------------
function realizarSorteio(senha) {
  if (String(senha) !== SENHA_SORTEIO) return { erro: "Senha incorreta." };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('rifa');
  if (!sheet) return { erro: 'Planilha "rifa" não encontrada.' };

  const dados = sheet.getRange('A2:B101').getValues();
  const pagos = [];
  for (let i = 0; i < dados.length; i++) {
    const num = dados[i][0];
    const status = dados[i][1];
    if (String(status).toLowerCase() === 'pago') {
      pagos.push(num);
    }
  }

  if (pagos.length === 0) return { erro: "Não há números pagos para sortear." };

  const vencedor = pagos[Math.floor(Math.random() * pagos.length)];

  // Gravar resultado em K2..N2 (data/hora atual, manter valor e prêmio já salvos)
  sheet.getRange("K2").setValue(sheet.getRange("K2").getValue() || "");
  sheet.getRange("L2").setValue(new Date());
  return { sucesso: true, numero: vencedor.toString() };
}

// ---------------------------
// Resetar reservas NÃO pagas (mantém Pago intactos)
// ---------------------------
function resetarReservasNaoPagas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('rifa');
  if (!sheet) return { success: false, message: 'Planilha não encontrada.' };

  const dadosStatus = sheet.getRange('B2:B101').getValues();
  for (let i = 0; i < dadosStatus.length; i++) {
    const status = String(dadosStatus[i][0] || '');
    const linha = i + 2;
    if (status === 'Reservado') {
      // Limpa colunas C..G e seta Disponível + H = Não
      sheet.getRange(`B${linha}`).setValue('Disponível');
      sheet.getRange(`C${linha}:G${linha}`).clearContent();
      sheet.getRange(`H${linha}`).setValue('Não');
    }
  }
  return { success: true, message: 'Reservas não pagas foram resetadas.' };
}


// ---------------------------
// RESET INDIVIDUAL (somente se Reservado e senha correta)
// ---------------------------
function resetNumeroIndividual(numero, senha) {
  const SENHA_CORRETA = SENHA_SORTEIO;
  if (String(senha) !== String(SENHA_CORRETA)) {
    return { sucesso: false, mensagem: 'Senha incorreta!' };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('rifa');
  if (!sheet) return { sucesso: false, mensagem: 'Planilha "rifa" não encontrada.' };

  // Lê linhas A2:H101
  const dados = sheet.getRange(2, 1, 100, 8).getValues(); // 100 linhas: 2..101

  for (let i = 0; i < dados.length; i++) {
    const num = dados[i][0];
    const status = String(dados[i][1] || '').toLowerCase();
    if (String(num) === String(numero)) {
      // Se já estiver pago (coluna H = 'Sim') -> bloqueado
      const pago = String(dados[i][7] || '').toLowerCase();
      if (pago === 'sim' || status.indexOf('pag') !== -1) {
        return { sucesso: false, mensagem: 'Não é possível resetar um número já pago!' };
      }

      // Só resetamos se estiver Reservado (ou outro status que não seja Pago)
      sheet.getRange(i + 2, 2).setValue('Disponível'); // B
      sheet.getRange(i + 2, 3).setValue(''); // C nome
      sheet.getRange(i + 2, 4).setValue(''); // D email
      sheet.getRange(i + 2, 5).setValue(''); // E contato
      sheet.getRange(i + 2, 6).setValue(''); // F codigo reserva
      sheet.getRange(i + 2, 7).setValue(''); // G data/hora reserva
      sheet.getRange(i + 2, 8).setValue('Não'); // H pagamento confirmado? -> Não

      return { sucesso: true, mensagem: 'Número liberado com sucesso!' };
    }
  }

  return { sucesso: false, mensagem: 'Número não encontrado!' };
}

// ---------------------------
// Resetar rifa completa (volta tudo a Disponível e limpa dados)
// ---------------------------
function resetarRifaCompleta() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('rifa');
  if (!sheet) return { success: false, message: 'Planilha não encontrada.' };

  for (let i = 2; i <= 101; i++) {
    sheet.getRange(`B${i}`).setValue('Disponível');
    sheet.getRange(`C${i}:G${i}`).clearContent();
    sheet.getRange(`H${i}`).setValue('Não');
  }
  // Limpar dados do sorteio K2..N2
  sheet.getRange("K2:N2").clearContent();
  return { success: true, message: 'Rifa resetada completamente.' };
}

// ---------------------------
// Util: gerar código aleatório
// ---------------------------
function gerarCodigo() {
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numeros = Math.floor(Math.random() * 9000) + 1000;
  const letra = letras.charAt(Math.floor(Math.random() * letras.length));
  return letra + numeros;
}
