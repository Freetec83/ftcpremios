// === FTC PRÊMIOS — Code.gs (ATUALIZADO: BLOQUEIO AUTOMÁTICO + OVERRIDE ADMIN) ===

const PROP_SORTEIO = 'SORTEIO_PUBLICO';

function getEstadoSorteio() {
  const p = PropertiesService.getScriptProperties();
  const raw = p.getProperty(PROP_SORTEIO);
  return raw ? JSON.parse(raw) : { status: 'IDLE' };
}

function setEstadoSorteio(obj) {
  PropertiesService.getScriptProperties()
    .setProperty(PROP_SORTEIO, JSON.stringify(obj));
}

function getSenhaAdmin() {
  const senha = PropertiesService.getScriptProperties().getProperty('SENHA_ADMIN');
  if (!senha) {
    throw new Error('Senha admin não configurada.');
  }
  return senha;
}

const PIX_CHAVE = '9ce163ce-4d97-425a-9a99-445802f3e871';

// ---------------------------
// doGet
// ---------------------------
function doGet(e) {
  const publico = e && e.parameter && e.parameter.publico === '1';

  const html = HtmlService.createTemplateFromFile('index');
  html.PUBLICO = publico;

  return html.evaluate()
    .setTitle('FTC Prêmios — Sorteio Público')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---------------------------
// Helper: checa override admin (libera reservas temporariamente)
// ---------------------------
function reservasLiberadas() {
  try {
    const prop = PropertiesService.getScriptProperties().getProperty('reservas_liberadas_ate');
    if (!prop) return false;
    const until = Number(prop);
    if (isNaN(until)) return false;
    return Date.now() <= until;
  } catch (e) {
    return false;
  }
}

// ---------------------------
// ADMIN: libera reservas temporariamente (minutos opcional, padrão 10)
// ---------------------------
function liberarReservasTemporariamente(senha, minutos) {
  if (String(senha) !== String(getSenhaAdmin())) {
    return { success: false, message: 'Senha incorreta.' };
  }
  const mins = (minutos && Number(minutos)) ? Number(minutos) : 10;
  const until = Date.now() + Math.max(1, mins) * 60000;
  PropertiesService.getScriptProperties().setProperty('reservas_liberadas_ate', String(until));
  return { success: true, message: `Reservas liberadas por ${mins} minuto(s).` };
}

// ---------------------------
// ADMIN: cancela override e volta ao comportamento normal
// ---------------------------
function desbloquearReservas(senha) {
  if (String(senha) !== String(getSenhaAdmin())) {
    return { success: false, message: 'Senha incorreta.' };
  }
  PropertiesService.getScriptProperties().deleteProperty('reservas_liberadas_ate');
  return { success: true, message: 'Override removido. Sistema volta ao bloqueio por meta normalmente.' };
}

// ---------------------------
// LISTAR NÚMEROS (normal)
// ---------------------------
function listarNumeros() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('rifa');
  if (!sheet) return [];
  const dados = sheet.getRange('A2:C101').getValues();
  return dados.map(r => ({
    numero: String(r[0]).padStart(2,"0"),
    status: r[1] || 'Disponível',
    nome: r[2] || ''
  }));
}

// ---------------------------
// RESERVAR NÚMERO (verifica meta P/Q e override admin)
// ---------------------------
function reservarNumero(numero, nome, email, contato) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('rifa');
  if (!sheet) return { success: false, message: 'Planilha "rifa" não encontrada.' };

  try {
    // Checar meta (P2) e total vendidos (Q2)
    const metaRaw = sheet.getRange('P2').getValue();
    const totalRaw = sheet.getRange('Q2').getValue();
    const meta = Number(metaRaw) || 0;
    const total = Number(totalRaw) || 0;

    // Se meta configurada e atingida — bloquear, a menos que override exista
    if (meta > 0 && total >= meta) {
      if (!reservasLiberadas()) {
        return { success: false, message: 'Reservas temporariamente bloqueadas: meta de vendas atingida.' };
      }
      // se reservasLiberadas() true — continua o fluxo normalmente
    }

    const numeroFormatado = String(numero).padStart(2, "0");
    const numeros = sheet.getRange('A2:A101').getValues().map(r => String(r[0]).padStart(2, "0"));

    for (let i = 0; i < numeros.length; i++) {
      if (numeros[i] === numeroFormatado) {
        const linha = i + 2;

        const status = sheet.getRange(`B${linha}`).getValue() || 'Disponível';
        if (String(status).toLowerCase().indexOf('disp') === -1 && String(status).toLowerCase().indexOf('dispon') === -1) {
          return { success: false, message: `Número ${numeroFormatado} já reservado ou pago.` };
        }

        const codigo = gerarCodigo();
        sheet.getRange(`B${linha}`).setValue('Reservado');
        sheet.getRange(`C${linha}`).setValue(nome || '');
        sheet.getRange(`D${linha}`).setValue(email || '');
        sheet.getRange(`E${linha}`).setValue(String(contato || '').replace(/\s+/g,''));
        sheet.getRange(`F${linha}`).setValue(codigo);
        sheet.getRange(`G${linha}`).setValue(new Date());
        sheet.getRange(`H${linha}`).setValue('Não');

        return {
          success: true,
          message: `Número ${numeroFormatado} reservado com sucesso!`,
          reserva: { numero: numeroFormatado, codigo, nome, email, contato },
          pix: PIX_CHAVE,
          grupoWhatsapp: ''
        };
      }
    }

    return { success: false, message: 'Número não encontrado.' };
  } catch (err) {
    console.error('Erro reservarNumero:', err);
    return { success: false, message: 'Erro interno: ' + err.message };
  }
}

// ---------------------------
// CONFIRMAR PAGAMENTO (ATUALIZADO: incrementa Q apenas se não estava Pago)
// ---------------------------
function confirmarPagamento(numero, senha) {
  try {
    if (String(senha) !== String(getSenhaAdmin())) {
      return { sucesso: false, mensagem: 'Senha incorreta.' };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('rifa');
    if (!sheet) return { sucesso: false, mensagem: 'Planilha "rifa" não encontrada.' };

    const numeroFormatado = String(numero).padStart(2, "0");
    const numeros = sheet.getRange('A2:A101').getValues().map(r => String(r[0]).padStart(2,"0"));

    for (let i = 0; i < numeros.length; i++) {
      if (numeros[i] === numeroFormatado) {
        const linha = i + 2;

        // lê status atual e flag pago (coluna B e H)
        const statusAtual = String(sheet.getRange(`B${linha}`).getValue() || '').trim();
        const flagPago = String(sheet.getRange(`H${linha}`).getValue() || '').trim();

        // se já estava pago, não incrementa Q novamente
        const jaEstavaPago = statusAtual.toLowerCase().indexOf('pag') !== -1 || flagPago.toLowerCase() === 'sim';

        // marca como Pago
        sheet.getRange(`B${linha}`).setValue('Pago');
        sheet.getRange(`H${linha}`).setValue('Sim');

        // se não estava pago antes, incrementa Q
        if (!jaEstavaPago) {
          try {
            const qRange = sheet.getRange('Q2');
            const qValRaw = qRange.getValue();
            let qVal = Number(qValRaw);
            if (isNaN(qVal)) qVal = 0;
            qRange.setValue(qVal + 1);
          } catch (err) {
            console.error('Erro atualizando Q:', err);
            // não falhar a confirmação por causa do contador; apenas log
          }
        }

        return { sucesso: true, mensagem: `Pagamento do número ${numeroFormatado} confirmado.` };
      }
    }

    return { sucesso: false, mensagem: 'Número não encontrado.' };

  } catch (err) {
    console.error('Erro confirmarPagamento:', err);
    return { sucesso: false, mensagem: 'Erro interno: ' + err.message };
  }
}

// ---------------------------
// DADOS J → Q (painel central público/admin)
// ---------------------------
function dadosJQ() {
  const ss = SpreadsheetApp.getActive();
  const s = ss.getSheetByName('rifa');
  if (!s) {
    return { J: "--", K: "--", L: "--", M: "--", N: "--", O: "--", P: "--", Q: "--" };
  }
  const J = s.getRange("J2").getDisplayValue() || "";
  const K = s.getRange("K2").getDisplayValue() || "";
  const L = s.getRange("L2").getDisplayValue() || "";
  const M = s.getRange("M2").getDisplayValue() || "";
  const N = s.getRange("N2").getDisplayValue() || "";
  const O = s.getRange("O2").getDisplayValue() || "";
  const P = s.getRange("P2").getDisplayValue() || "";
  const Q = s.getRange("Q2").getDisplayValue() || "";
  return { J, K, L, M, N, O, P, Q };
}

// ---------------------------
// salvarDadosSorteio (grava J..Q linha 2)
// ---------------------------
function salvarDadosSorteio(numeroSorteado, codigoGanhador, numeroSorteio, valorCobrado, premio, metaVendas, totalVendido) {
  const ss = SpreadsheetApp.getActive();
  const s = ss.getSheetByName('rifa');
  if (!s) return { success: false, message: "Aba 'rifa' não encontrada." };

  try {
    const agora = new Date(); 
    const tz = ss.getSpreadsheetTimeZone();
    const dataHoraLocal = Utilities.formatDate(agora, tz, "yyyy-MM-dd'T'HH:mm");

    s.getRange("J2").setValue(numeroSorteado || "");
    s.getRange("K2").setValue(codigoGanhador || "");
    s.getRange("L2").setValue(numeroSorteio || "");
    s.getRange("M2").setValue(valorCobrado || "");
    s.getRange("N2").setValue(dataHoraLocal);
    s.getRange("O2").setValue(premio || "");
    s.getRange("P2").setValue(metaVendas || "");
    s.getRange("Q2").setValue(totalVendido || "");

    return { success: true, message: "Dados gravados com sucesso." };
  } catch (e) {
    console.error('Erro salvarDadosSorteio:', e);
    return { success: false, message: e.toString() };
  }
}

// ---------------------------
// registrarResultadoSorteio (marca vencedor e grava J..Q)
// ---------------------------
function registrarResultadoSorteio(finalNum, numeroSorteio, valor, dataHora, premio, metaVendas, totalVendido) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('rifa');
    if (!sheet) return { success: false, message: 'Planilha "rifa" não encontrada.' };

    const numeros = sheet.getRange('A2:A101').getValues().map(r => String(r[0]).padStart(2,'0'));
    const linhaIdx = numeros.findIndex(n => n === String(finalNum).padStart(2,'0'));
    if (linhaIdx === -1) return { success: false, message: 'Número não encontrado.' };

    const linha = linhaIdx + 2;
    const codigoCheio = sheet.getRange(`F${linha}`).getValue() || '';
    const nomeGanhador = sheet.getRange(`C${linha}`).getValue() || '';

    const codigo3 = String(codigoCheio).substring(0,3);

    const numSorteio = numeroSorteio || sheet.getRange('L2').getValue() || '';
    const valorSorteio = (valor !== undefined && valor !== null) ? valor : sheet.getRange('M2').getValue() || '';
    const dataSorteio = dataHora || sheet.getRange('N2').getValue() || new Date();
    const premioSorteio = premio || sheet.getRange('O2').getValue() || '';

    // grava J..Q na linha 2
    sheet.getRange('J2').setValue(String(finalNum).padStart(2,'0'));
    sheet.getRange('K2').setValue(codigo3);
    sheet.getRange('L2').setValue(numSorteio);
    sheet.getRange('M2').setValue(valorSorteio);
    sheet.getRange('N2').setValue(dataSorteio);
    sheet.getRange('O2').setValue(premioSorteio);

    if (metaVendas !== undefined) sheet.getRange('P2').setValue(metaVendas);
    if (totalVendido !== undefined) sheet.getRange('Q2').setValue(totalVendido);

    // marca vencedor na linha do número
    sheet.getRange(`I${linha}`).setValue('Vencedor');

    return { success: true, numero: String(finalNum).padStart(2,'0'), codigo: codigo3, nome: nomeGanhador };
  } catch (err) {
    console.error('Erro registrarResultadoSorteio:', err);
    return { success: false, message: err.message };
  }
}

// ---------------------------
// reset / util / debug (mantidos e robustos)
// ---------------------------
function resetarReservasNaoPagas() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('rifa');
    if (!sheet) return { success: false, message: 'Planilha "rifa" não encontrada.' };

    const dados = sheet.getRange('A2:H101').getValues();
    dados.forEach((row, i) => {
      if (row[1] === 'Reservado' && row[7] !== 'Sim') {
        sheet.getRange(`B${i+2}`).setValue('Disponível');
        sheet.getRange(`C${i+2}:G${i+2}`).clearContent();
      }
    });
    return { success: true, message: 'Reservas não pagas resetadas com sucesso!' };
  } catch (err) {
    console.error('Erro resetarReservasNaoPagas:', err);
    return { success: false, message: 'Erro interno: ' + err.message };
  }
}

function resetarRifaCompleta() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('rifa');
    if (!sheet) return { success: false, message: 'Planilha "rifa" não encontrada.' };
    sheet.getRange('B2:I101').clearContent();
    return { success: true, message: 'Rifa completa resetada com sucesso!' };
  } catch (err) {
    console.error('Erro resetarRifaCompleta:', err);
    return { success: false, message: 'Erro interno: ' + err.message };
  }
}

function resetNumeroIndividual(numero, senha) {
  try {
    if (String(senha) !== String(getSenhaAdmin())) {
  return { success: false, message: 'Senha incorreta.' };
}
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('rifa');
    if (!sheet) return { success: false, message: 'Planilha "rifa" não encontrada.' };

    const numeros = sheet.getRange('A2:A101').getValues().map(r => String(r[0]).padStart(2,'0'));
    const linha = numeros.findIndex(n => n === String(numero).padStart(2,'0'));
    if (linha === -1) return { success: false, message: 'Número não encontrado.' };

    sheet.getRange(`B${linha+2}`).setValue('Disponível');
    sheet.getRange(`C${linha+2}:G${linha+2}`).clearContent();
    sheet.getRange(`H${linha+2}`).setValue('Não');
    return { success: true, message: `Número ${String(numero).padStart(2,'0')} liberado com sucesso.` };
  } catch (err) {
    console.error('Erro resetNumeroIndividual:', err);
    return { success: false, message: 'Erro interno: ' + err.message };
  }
}

function listarPagos() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('rifa');
    if (!sheet) return [];
    const dados = sheet.getRange('A2:H101').getValues();
    return dados
      .map((row,i) => ({ numero: String(row[0]).padStart(2,'0'), status: row[1], pago: row[7] }))
      .filter(r => String(r.status).toLowerCase().indexOf('pag') !== -1 || String(r.pago).toLowerCase() === 'sim')
      .map(r => r.numero);
  } catch (err) {
    console.error('Erro listarPagos:', err);
    return [];
  }
}

function debugInfo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetNames = ss.getSheets().map(s => s.getName());
  const sheet = ss.getSheetByName('rifa');
  if (!sheet) return { ok: false, message: 'Planilha "rifa" NAO encontrada', sheets: sheetNames };
  return { ok: true, sheets: sheetNames, header: sheet.getRange('A1:Q1').getValues()[0], sample: sheet.getRange('A2:Q6').getValues() };
}

function gerarCodigo() {
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numeros = Math.floor(Math.random() * 9000) + 1000;
  return letras.charAt(Math.floor(Math.random() * letras.length)) + numeros;
}

// ---------------------------
// SORTEIO COM PESOS + EMBARALHAMENTO REAL
// ---------------------------
function iniciarSorteio() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('rifa');
    if (!sheet) return { success:false, message:"Aba 'rifa' não encontrada." };

    const dados = sheet.getRange('A2:H101').getValues(); // 1–100
    let numeros = [];

    for (let i = 0; i < dados.length; i++) {
      const num = String(dados[i][0]).padStart(2,'0');
      const nome = dados[i][2] || '';
      const status = (dados[i][7] || '').toString().toLowerCase().trim(); // pago?
      const reservado = (dados[i][6] || '').toString(); // reservado/pendente?

      // 🏆 Sistema de pesos:
      // Pago: maior chance, mas não é absoluto
      // Reservado/Pendente: chance média
      // Livre: chance mínima (só para evitar padrão)
      let peso = 1;
      if (status === 'sim') peso = 10;            // pago
      else if (reservado) peso = 3;               // reservado
      else peso = 1;                              // livre

      for (let p = 0; p < peso; p++) numeros.push(num);
    }

    if (numeros.length === 0) {
      return { success:false, message:"Nenhum número disponível." };
    }

    // 🔐 Fisher-Yates com ruído criptográfico
    for (let i = numeros.length - 1; i > 0; i--) {
      const bytes = Utilities.getRandomBytes(2);
      const rand = (bytes[0] << 8) + bytes[1];
      const j = rand % (i + 1);
      [numeros[i], numeros[j]] = [numeros[j], numeros[i]];
    }

    const final = numeros[0]; // resultado altamente imprevisível

    // Localiza dados do ganhador
    const linhaIdx = dados.findIndex(r => String(r[0]).padStart(2,'0') === final);
    const codigo = (dados[linhaIdx][5] || '').toString().substring(0,3);
    const nome = dados[linhaIdx][2] || '';

    return {
      success:true,
      numeroFinal: final,
      codigo,
      nome
    };

  } catch (err) {
    console.error("Erro iniciarSorteio:", err);
    return { success:false, message:err.message };
  }
}

// ===============================
// FUNÇÕES AUXILIARES DO SORTEIO
// (usam dados reais da planilha)
// ===============================

// retorna o número vencedor já sorteado no fluxo público
function getNumeroVencedorPublico() {
  const estado = getEstadoSorteio();
  if (estado && estado.numeroFinal) {
    return estado.numeroFinal;
  }
  throw new Error('Número vencedor não encontrado no estado do sorteio.');
}

// gera um identificador simples do sorteio
function gerarNumeroSorteio() {
  const agora = new Date();
  return Utilities.formatDate(
    agora,
    SpreadsheetApp.getActive().getSpreadsheetTimeZone(),
    'yyyyMMdd-HHmmss'
  );
}

// valor da rifa (coluna M ou fixo se preferir)
function getValorRifa() {
  const s = SpreadsheetApp.getActive().getSheetByName('rifa');
  if (!s) return '';
  return s.getRange('M2').getValue() || '';
}

// prêmio atual (coluna O)
function getPremioAtual() {
  const s = SpreadsheetApp.getActive().getSheetByName('rifa');
  if (!s) return '';
  return s.getRange('O2').getValue() || '';
}

// meta de vendas (coluna P)
function getMetaVendas() {
  const s = SpreadsheetApp.getActive().getSheetByName('rifa');
  if (!s) return '';
  return s.getRange('P2').getValue() || '';
}

// total vendido (coluna Q)
function getTotalVendido() {
  const s = SpreadsheetApp.getActive().getSheetByName('rifa');
  if (!s) return '';
  return s.getRange('Q2').getValue() || '';
}

function finalizarSorteioPublico() {
  const vencedor = getNumeroVencedorPublico(); // o número sorteado

if (!vencedor) {
    throw new Error('Tentativa de finalizar sorteio sem vencedor.');
  }

  const numeroSorteio = gerarNumeroSorteio();
  const valor = getValorRifa();
  const dataHora = new Date();
  const premio = getPremioAtual();
  const metaVendas = getMetaVendas();
  const totalVendido = getTotalVendido();

  registrarResultadoSorteio(
    vencedor,
    numeroSorteio,
    valor,
    dataHora,
    premio,
    metaVendas,
    totalVendido
  );
}




