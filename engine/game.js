// Motore JS del gioco: gestisce mazzi, giocatori e stato base.
// Porting semplificato di game/game.py: include setup, pesca e placeholder effetti.

import { Mazzo, Demone, Imprevisto } from "./entities.js";
import { buildRifornimentiDeck, buildEvocazioniDeck, buildBossList } from "./decks.js";
import { Giocatore } from "./player.js";

function assegnaSigilli(giocatori) {
  const lettere = ["A", "B", "C", "D", "E"];
  const pool = [...lettere];
  for (let i = 0; i < giocatori.length; i += 1) {
    const lettera = pool.shift();
    giocatori[i].sigillo = lettera || null;
  }
}

function distribuisciManoIniziale(giocatori, mazzoRifornimenti) {
  giocatori.forEach(g => {
    for (let i = 0; i < 3; i += 1) {
      const c = mazzoRifornimenti.pesca();
      if (c) g.mano.push(c);
    }
  });
}

export class Gioco {
  constructor(giocatori) {
    this.giocatori = giocatori;
    this.turno_corrente = 0;
    this.limbo = [];
    this.scarti = [];
    this.cimitero = [];
    this.azione_corrente = 0;
    this.max_limbo_size = 0;
    this.mazzo_rifornimenti = new Mazzo();
    this.mazzo_evocazioni = new Mazzo();
    this.boss_disponibili = [];
    this.tentativo_conquista_fatto = false;
    this.onAzione = null; // Callback per mostrare i balloon
    this.azioni_per_turno = 2;
    this._listeners = {};
    this.log = [];
    this.fase = "setup"; // setup | turno | azione
    this.current_action = null;
  }

  static async crea(giocatori) {
    const gioco = new Gioco(giocatori);
    await gioco._setup();
    return gioco;
  }

  async _setup() {
    [this.mazzo_rifornimenti, this.mazzo_evocazioni, this.boss_disponibili] =
      await Promise.all([
        buildRifornimentiDeck(),
        buildEvocazioniDeck(),
        buildBossList(),
      ]);
    assegnaSigilli(this.giocatori);
    distribuisciManoIniziale(this.giocatori, this.mazzo_rifornimenti);
  }

  giocatoreCorrente() {
    return this.giocatori[this.turno_corrente % this.giocatori.length];
  }

  prossimoTurno() {
    this.turno_corrente = (this.turno_corrente + 1) % this.giocatori.length;
    this.azione_corrente = 0;
    this.tentativo_conquista_fatto = false;
    this.giocatoreCorrente().resetInizioTurno();
    this.fase = "turno";
    this.current_action = null;
    this._emit("fase", { fase: "turno", turno: this.turno_corrente, giocatore: this.giocatoreCorrente()?.nome });
  }

  puoAgire() {
    const max = this.azioni_per_turno ?? 2;
    return this.azione_corrente < max;
  }

  registraAzione(tipo = "generica") {
    const max = this.azioni_per_turno ?? 2;
    if (this.azione_corrente >= max) return false;
    this.azione_corrente += 1;
    this.current_action = null;
    this.fase = "turno";
    this._emit("azione_consumata", { tipo, azione_corrente: this.azione_corrente });
    return true;
  }

  azioniRimaste() {
    const max = this.azioni_per_turno ?? 2;
    return Math.max(0, max - this.azione_corrente);
  }

  canAct() {
    return this.puoAgire();
  }

  pescaRifornimento(giocatore) {
    const carta = this.mazzo_rifornimenti.pesca();
    if (carta) {
      giocatore.mano.push(carta);
    }
    this._log("pesca_rifornimento", `${giocatore.nome} pesca rifornimento`, {
      giocatore: giocatore.nome,
      carta: carta?.nome || null,
    });
    this._emit("pesca_rifornimento", { giocatore, carta });
    this._emit("azione", { giocatore: giocatore.nome, azione: "Pesca rifornimento", carta: carta?.nome || null });
    if (this.onAzione) {
      this.onAzione(giocatore.nome, "Pesca un rifornimento");
    }
    return carta;
  }

  pescaEvocazione(giocatore) {
    const carta = this.mazzo_evocazioni.pesca();
    if (!carta) return null;
    if (carta instanceof Imprevisto) {
      // TODO: gestire effetti imprevisti; per ora la scartiamo in pila scarti
      this.scartaCarteDi(giocatore, [carta]);
      this._emit("pesca_imprevisto", { giocatore, carta });
    }
    this._log("pesca_evocazione", `${giocatore.nome} rivela evocazione`, {
      giocatore: giocatore.nome,
      carta: carta?.nome || null,
      tipo: carta instanceof Demone ? "demone" : carta instanceof Imprevisto ? "imprevisto" : "altro",
    });
    this._emit("azione", { giocatore: giocatore.nome, azione: "Rivela un'evocazione", carta: carta?.nome || null });
    if (this.onAzione) {
      this.onAzione(giocatore.nome, "Rivela un'evocazione");
    }
    return carta;
  }

  async conquistaBoss(boss) {
    if (!boss) return false;
    const player = this.giocatoreCorrente();
    const sig = player?.sigillo;
    const attackerIsHuman = !!(player && player.nome === "Player" && !player.isBot);
    const askHumanSposta = async (modo = "attacco") => {
      if (!attackerIsHuman || typeof this.askHumanSpostastelle !== "function") return null;
      try {
        return await this.askHumanSpostastelle({ boss, attacker: player, modo });
      } catch (_) {
        return null;
      }
    };
    const prevOffset = boss._offset || 0;
    const prevVals = { ...(boss.valori || {}) };

    let requisito = boss.requisitoPer ? boss.requisitoPer(sig) : Infinity;
    const stelle = player?.totale_stelle ?? 0;
    const sigAtt = sig;
    const stelleAtt = stelle;

    const computeReq = (vals, offset) => {
      const savedOffset = boss._offset;
      const savedVals = { ...(boss.valori || {}) };
      boss._offset = offset;
      boss.valori = { ...vals };
      const r = boss.requisitoPer(sigAtt);
      boss._offset = savedOffset;
      boss.valori = savedVals;
      return r;
    };

    const players = this.giocatori || [];
    const attackerIdx = Math.max(0, players.indexOf(player));

    let lastStep = null;

    const tryStoppastella = async (rotator, step, beforeOffset, beforeVals) => {
      const reqBefore = computeReq(beforeVals, beforeOffset);
      const reqAfter = boss.requisitoPer(sigAtt);
      let chosenName = null;
      for (const pl of this.giocatori) {
        if (pl === rotator) continue;
        // Se la rotazione è difensiva (rotator non è attaccante), solo l'attaccante può stoppare
        if (rotator !== player && pl !== player) continue;
        // Se la rotazione è offensiva (attaccante), solo i difensori possono stoppare
        if (rotator === player && pl === player) continue;

        const stop = this._findStoppastella(pl);
        if (!stop) continue;

        // Valuta se ha senso usare Stoppastella
        let shouldUse = false;
        if (rotator === player) {
          // Attaccante ha abbassato il requisito: difensori usano stop se ora l'attaccante può conquistare o il requisito è sceso
          if (reqAfter < reqBefore || reqAfter <= stelleAtt) {
            shouldUse = true;
          }
        } else {
          // Difensore ha alzato il requisito: attaccante usa stop se prima poteva conquistare e ora no
          if (reqBefore <= stelleAtt && reqAfter > stelleAtt) {
            shouldUse = true;
          }
        }
        if (!shouldUse) continue;

        let used = false;
        let cardUsed = stop;
        if (pl.nome === "Player") {
          if (typeof this.askHumanSpostastelle === "function") {
            const res = await this.askHumanSpostastelle({ boss, attacker: rotator, modo: "stoppastella", lastStep: step, canStoppastella: true });
            if (!res || !res.stoppa || !res.card) continue;
            cardUsed = res.card;
            const idx = pl.mano.indexOf(cardUsed);
            if (idx >= 0) pl.mano.splice(idx, 1);
            this.scartaCarteDi(pl, [cardUsed]);
            used = true;
          } else {
            // se manca il prompt, non usare automaticamente la carta umana
            continue;
          }
        } else {
          // Bot: uso automatico solo se utile
          const idx = pl.mano.indexOf(stop);
          if (idx >= 0) pl.mano.splice(idx, 1);
          this.scartaCarteDi(pl, [stop]);
          used = true;
        }
        if (!used) continue;
        chosenName = cardUsed?.nome || stop?.nome || "Stoppastella";
        boss._offset = beforeOffset;
        boss.valori = { ...beforeVals };
        this._log("stoppastella", `${pl.nome} annulla lo Spostastelle`, { giocatore: pl.nome, carta: chosenName });
        if (this.onAzione) this.onAzione(pl.nome, "Gioca Stoppastella");
        return true;
      }
      return false;
    };

    const tryRotate = async (pl, step, card, desc, beforeOffset, beforeVals) => {
      if (step === null || step === undefined) return false;
      const prevReq = requisito;
      this._rotateBoss(boss, step, pl);
      lastStep = step;
      requisito = boss.requisitoPer(sig);
      this._consumeSpostastelle(pl, card, desc);
      // Stoppastella può annullare solo quest'ultima rotazione
      await tryStoppastella(pl, step, beforeOffset, beforeVals);
      requisito = boss.requisitoPer(sig);
      this._log("spostastelle_turno", `${pl.nome} Spostastelle: ${prevReq} -> ${requisito}`, {
        giocatore: pl.nome,
        step,
        before: prevReq,
        after: requisito,
      });
      this._emit("spostastelle_rotazione", { giocatore: pl, step, before: prevReq, after: requisito });
      return true; // anche se stoppato, l'azione è stata tentata
    };

    const tryAttackerSposta = async () => {
      const cards = (player?.mano || []).filter(c => c?.azione_boss?.rotazione);
      if (!cards.length) return false;
      if (attackerIsHuman) {
        const choice = await askHumanSposta("attacco");
        if (!choice || !choice.card || choice.step == null) return false;
        const beforeOffset = boss._offset || 0;
        const beforeVals = { ...(boss.valori || {}) };
        return tryRotate(player, choice.step, choice.card, `Spostastelle attacco ${choice.step}`, beforeOffset, beforeVals);
      }
      const card = this._findSpostastelle(player);
      if (!card) return false;
      const step = this._chooseRotationForAttacker(boss, sig, stelle, card);
      if (step === null) return false;
      const beforeOffset = boss._offset || 0;
      const beforeVals = { ...(boss.valori || {}) };
      return tryRotate(player, step, card, `Spostastelle attacco ${step}`, beforeOffset, beforeVals);
    };

    const tryHumanDefender = async () => {
      if (attackerIsHuman) return false;
      const human = this.giocatori.find(p => p.nome === "Player" && !p.isBot);
      if (!human || typeof this.askHumanSpostastelle !== "function") return false;
      const choice = await this.askHumanSpostastelle({ boss, attacker: player, modo: "difesa", lastStep });
      if (!choice || !choice.card) return false;
      const step = choice.step;
      const beforeOffset = boss._offset || 0;
      const beforeVals = { ...(boss.valori || {}) };
      return tryRotate(human, step, choice.card, `Spostastelle difesa ${step} da ${human.nome}`, beforeOffset, beforeVals);
    };

    const tryDefenderSposta = async () => {
      const total = players.length || 0;
      // Prima il giocatore umano, se non è l'attaccante
      const humanUsed = await tryHumanDefender();
      if (humanUsed) return true;

      for (let i = 1; i < total; i += 1) {
        const opp = players[(attackerIdx + i) % total];
        if (!opp || opp === player) continue;
        const card = this._findSpostastelle(opp);
        if (!card) continue;
        const step = this._chooseRotationForDefender(boss, sig, stelle, card);
        if (step === null) continue;
        // I bot difendono con probabilità 90%, così a volte lasciano che risponda chi segue
        if (opp.isBot && Math.random() > 0.9) continue;
        const beforeOffset = boss._offset || 0;
        const beforeVals = { ...(boss.valori || {}) };
        const rotated = await tryRotate(opp, step, card, `Spostastelle difesa ${step} da ${opp.nome}`, beforeOffset, beforeVals);
        return rotated;
      }
      return false;
    };

    // Loop di contrattacco: attaccante prova a vincere, difensori rispondono in ordine
    let guard = 0;
    let ok = sig != null && stelle >= requisito;
    while (guard < 20) {
      guard += 1;
      if (ok) {
        // Attaccante ora conquista: lascia spazio ai difensori in ordine
        const used = await tryDefenderSposta();
        requisito = boss.requisitoPer(sig);
        ok = sig != null && stelle >= requisito;
        if (used) continue; // qualcuno ha ruotato: ripeti il ciclo per consentire risposte
        break; // nessun difensore ha risposto, conquista riuscita
      } else {
        // Attaccante non conquista: prova a usare Spostastelle per ridurre
        const used = await tryAttackerSposta();
        requisito = boss.requisitoPer(sig);
        ok = sig != null && stelle >= requisito;
        if (used) continue; // ruotato, ripeti ciclo
        break; // nessuna carta per migliorare: fallisce
      }
    }

    // reset flag skip spostastelle (umano che ha premuto annulla)
    players.forEach(p => { delete p._skipSpostaThisConquest; });

    this.tentativo_conquista_fatto = true;
    if (ok) {
      player.boss_conquistati.push(boss);
      this.boss_disponibili.shift();
      this._log("conquista_boss", `${player.nome} conquista ${boss.nome}`, {
        giocatore: player.nome,
        boss: boss.nome,
        requisito,
        stelle,
        sigillo: sig,
      });
      if (this.onAzione) {
        this.onAzione(player.nome, "Conquista il boss!");
      }
      this._emit("azione", { giocatore: player.nome, azione: `Conquista ${boss.nome}` });
    } else {
      if (boss) boss.rivelato = true;
      this._log("conquista_boss_fallita", `${player.nome} fallisce ${boss?.nome || "boss"}`, {
        giocatore: player.nome,
        boss: boss?.nome || null,
        requisito,
        stelle,
        sigillo: sig,
      });
      if (this.onAzione) {
        this.onAzione(player.nome, "Conquista fallita");
      }
    }
    return ok;
  }

  giocaMagia(giocatore, carta) {
    if (!giocatore || !carta) return { ok: false, motivo: "Parametri mancanti" };
    if ((carta?.categoria || "").toLowerCase() !== "magia") return { ok: false, motivo: "Non è una magia" };
    const idx = giocatore.mano.indexOf(carta);
    if (idx === -1) return { ok: false, motivo: "Carta non in mano" };

    // Rimuovi dalla mano e metti negli scarti
    giocatore.mano.splice(idx, 1);
    this.scartaCarteDi(giocatore, [carta]);

    const nome = (carta.nome || "").toLowerCase();
    const eff = this._risolviMagia(giocatore, carta, nome);

    this._log("magia", `${giocatore.nome} gioca ${carta.nome}`, {
      giocatore: giocatore.nome,
      carta: carta.nome,
      effetto: eff,
    });
    this._emit("azione", { giocatore: giocatore.nome, azione: `Gioca ${carta.nome}` });
    if (this.onAzione) {
      this.onAzione(giocatore.nome, `Gioca magia ${carta.nome}`);
    }
    return { ok: true, effetto: eff };
  }

  _risolviMagia(giocatore, carta, nome) {
    const bots = this.giocatori.filter(g => g !== giocatore);
    const firstOpponent = () => bots.find(b => b.mano.length || b.cerchia.length) || bots[0] || null;
    const pickOpponentWithMostCards = () => bots.slice().sort((a,b)=>b.mano.length - a.mano.length)[0] || firstOpponent();
    const pickOpponentWithStrongestDemon = () => {
      return bots
        .map(b => ({ b, d: (b.cerchia || []).slice().sort((x,y)=> (y?.livello_stella||0)-(x?.livello_stella||0))[0] }))
        .filter(o => o.d)
        .sort((a,b)=> (b.d?.livello_stella||0)-(a.d?.livello_stella||0))[0] || null;
    };

    switch (nome) {
      case "patto": {
        const opp = pickOpponentWithMostCards();
        if (opp) {
          const tmp = giocatore.mano;
          giocatore.mano = opp.mano;
          opp.mano = tmp;
          const msg = `Scambia mano con ${opp.nome}`;
          this._log("patto", `${giocatore.nome} ${msg}`, { giocatore: giocatore.nome, target: opp.nome });
          if (this.onAzione) this.onAzione(giocatore.nome, msg);
          this._emit("hand_changed", { players: [giocatore.nome, opp.nome] });
          return msg;
        }
        return "Nessun avversario per scambiare";
      }
      case "roba d'altri": {
        const opp = pickOpponentWithMostCards();
        if (!opp || !opp.mano.length) return "Nessuna carta da rubare";
        const stealOne = () => {
          const c = opp.mano.splice(Math.floor(Math.random() * opp.mano.length), 1)[0];
          if (c) giocatore.mano.push(c);
          return c;
        };
        const c1 = stealOne();
        if (c1 && (c1?.categoria || "").toLowerCase() === "magia" && opp.mano.length) {
          stealOne();
        }
        this._emit("hand_changed", { players: [giocatore.nome, opp.nome] });
        return `Ruba carta da ${opp.nome}`;
      }
      case "bibidibodibibu": {
        const opp = pickOpponentWithStrongestDemon();
        if (!opp) return "Nessun demone avversario";
        const dem = opp.d;
        opp.b.cerchia.splice(opp.b.cerchia.indexOf(dem), 1);
        this.mandaNelLimbo(dem);
        return `Manda nel Limbo ${dem.nome} di ${opp.b.nome}`;
      }
      case "proselitismo": {
        const target = pickOpponentWithStrongestDemon();
        if (!target) return "Nessun demone avversario";
        const dem = target.d;
        const costo = this.calcolaCostoEffettivo(giocatore, dem);
        const pagate = giocatore.pagaEvocazione(dem, costo);
        if (!pagate) return "Pagamento fallito";
        target.b.cerchia.splice(target.b.cerchia.indexOf(dem), 1);
        this.scartaCarteDi(giocatore, pagate);
        giocatore.cerchia.push(dem);
        return `Ruba ${dem.nome} pagando ${costo}`;
      }
      case "trasmutazione": {
        const mio = (giocatore.cerchia || []).find(d => d instanceof Demone);
        const limboDem = this.limbo.find(d => (d instanceof Demone) && mio && d.livello_stella === mio.livello_stella);
        if (!mio || !limboDem) return "Nessun demone compatibile";
        giocatore.cerchia.splice(giocatore.cerchia.indexOf(mio), 1);
        this.limbo.splice(this.limbo.indexOf(limboDem), 1);
        giocatore.cerchia.push(limboDem);
        this.mandaNelLimbo(mio);
        return `Scambia ${mio.nome} con ${limboDem.nome} nel Limbo`;
      }
      case "richiamo": {
        const dem = [...this.cimitero].reverse().find(c => c instanceof Demone);
        if (!dem) return "Nessun demone in cimitero";
        const costo = this.calcolaCostoEffettivo(giocatore, dem);
        const pagate = giocatore.pagaEvocazione(dem, costo);
        if (!pagate) return "Pagamento fallito";
        this.cimitero.splice(this.cimitero.lastIndexOf(dem), 1);
        this.scartaCarteDi(giocatore, pagate);
        giocatore.cerchia.push(dem);
        return `Evoca ${dem.nome} dal cimitero pagando ${costo}`;
      }
      case "rabdomanzia": {
        const best = [...this.scarti].filter(c => c?.valore != null).sort((a,b)=> (b.valore||0)-(a.valore||0))[0];
        if (!best) return "Nessuna carta negli scarti";
        this.scarti.splice(this.scarti.lastIndexOf(best), 1);
        this._emitPrelievoScarti(giocatore, [best]);
        giocatore.mano.push(best);
        return `Recupera ${best.nome} dagli scarti`;
      }
      case "pranayama": {
        const reveal = [];
        for (let i=0; i<3; i+=1) {
          const c = this.mazzo_rifornimenti.pesca();
          if (c) reveal.push(c);
        }
        if (!reveal.length) return "Nessuna carta da rivelare";
        reveal.sort((a,b)=> (b.valore||0)-(a.valore||0));
        const keep = reveal.slice(0,2);
        const give = reveal.slice(2);
        giocatore.mano.push(...keep);
        if (give.length) {
          const other = this.giocatori.filter(g => g!==giocatore).sort((a,b)=> a.mano.length - b.mano.length)[0];
          if (other) other.mano.push(...give);
        }
        return `Rivela ${reveal.length} rifornimenti, tiene 2`;
      }
      case "abracadabra": {
        const myDem = (giocatore.cerchia || []).sort((a,b)=> (b.livello_stella||0)-(a.livello_stella||0))[0];
        const target = pickOpponentWithStrongestDemon();
        if (!myDem || !target) return "Nessun demone da scambiare";
        const oppDem = target.d;
        if (myDem.livello_stella !== oppDem.livello_stella) return "Nessun demone stesso livello";
        giocatore.cerchia.splice(giocatore.cerchia.indexOf(myDem),1);
        target.b.cerchia.splice(target.b.cerchia.indexOf(oppDem),1);
        giocatore.cerchia.push(oppDem);
        target.b.cerchia.push(myDem);
        return `Scambia ${myDem.nome} con ${oppDem.nome}`;
      }
      case "illuminazione": {
        return "Illuminazione: replica l'effetto di un tuo demone";
      }
      default: {
        if (carta.azione_boss && carta.azione_boss.rotazione) {
          const boss = this.prossimoBoss();
          const opts = carta.azione_boss.rotazione.opzioni || [];
          if (boss && opts.length) {
        const step = carta._rotationChoice != null ? carta._rotationChoice : opts[0];
        this._rotateBoss(boss, step, giocatore);
        return `Ruota boss di ${step}`;
      }
    }
        if (carta.azione_boss && carta.azione_boss.annulla) {
          this.stoppastella_shield = true;
          return "Attiva Stoppastella: blocca il prossimo tentativo di conquista";
        }
        return "Effetto non implementato";
      }
    }
  }

  _findSpostastelle(giocatore) {
    if (!giocatore?.mano) return null;
    if (giocatore._skipSpostaThisConquest) return null;
    return giocatore.mano.find(c => c?.azione_boss?.rotazione);
  }

  _consumeSpostastelle(giocatore, carta, logMsg = "") {
    const idx = giocatore.mano.indexOf(carta);
    if (idx >= 0) giocatore.mano.splice(idx, 1);
    this.scartaCarteDi(giocatore, [carta]);
    if (logMsg) this._log("spostastelle", logMsg, { giocatore: giocatore.nome, carta: carta.nome });
    if (this.onAzione && logMsg) this.onAzione(giocatore.nome, logMsg);
  }

  _chooseRotationForAttacker(boss, sigillo, stelle, carta) {
    const opts = carta?.azione_boss?.rotazione?.opzioni || [];
    if (!opts.length || !boss) return null;
    const reqCurrent = boss.requisitoPer(sigillo);
    let best = null;
    opts.forEach(step => {
      const reqBefore = boss.requisitoPer(sigillo);
      boss.ruota(step);
      const newReq = boss.requisitoPer(sigillo);
      boss.ruota(-step);
      if (newReq <= stelle && newReq < reqBefore) {
        if (best === null || newReq < best.newReq) {
          best = { step, newReq };
        }
      }
    });
    return best ? best.step : null;
  }

  _chooseRotationForDefender(boss, sigilloAtt, stelleAtt, carta) {
    const opts = carta?.azione_boss?.rotazione?.opzioni || [];
    if (!opts.length || !boss) return null;
    const currentReq = boss.requisitoPer(sigilloAtt);
    let chosen = null;
    opts.forEach(step => {
      boss.ruota(step);
      const newReq = boss.requisitoPer(sigilloAtt);
      boss.ruota(-step);
      if (newReq > stelleAtt && newReq > currentReq) {
          if (!chosen || newReq > chosen.newReq) {
            chosen = { step, newReq };
          }
        }
    });
    return chosen ? chosen.step : null;
  }

  _rotateBoss(boss, step, giocatore) {
    if (!boss || !step) return;
    boss.ruota(step);
    this._emit("boss_ruotato", { boss, step, giocatore });
  }

  _findStoppastella(giocatore) {
    if (!giocatore?.mano) return null;
    return giocatore.mano.find(c => c?.azione_boss?.annulla);
  }

  _tryStoppastella(rotator, boss, prevOffset, prevVals) {
    // Deprecated: gestito direttamente in conquistaBoss con interazione umana/bot
    return false;
  }

  prossimoBoss() {
    return this.boss_disponibili[0] || null;
  }

  calcolaCostoEffettivo(giocatore, demone) {
    const base = demone?.costo ?? 0;
    return base + (giocatore?.costo_extra_evocazione ?? 0);
  }

  requestAction(tipo = "generica") {
    if (this.fase !== "turno") {
      return { ok: false, motivo: "fase_non_valida" };
    }
    if (!this.canAct()) {
      return { ok: false, motivo: "azioni_finite" };
    }
    if (this.current_action) {
      return { ok: false, motivo: "azione_in_corso" };
    }
    this.current_action = tipo;
    this.fase = "azione";
    this._emit("azione_iniziata", { tipo, azione_corrente: this.azione_corrente });
    return { ok: true };
  }

  completeAction(consuma = true) {
    const tipo = this.current_action || "generica";
    this.current_action = null;
    this.fase = "turno";
    if (consuma) {
      this.registraAzione(tipo);
    } else {
      this._emit("azione_annullata", { tipo });
    }
  }

  evocaDaLimbo(index, giocatore) {
    const demone = this.limbo[index];
    if (!demone) return { ok: false, motivo: "Nessun demone" };
    if (giocatore?.blocco_evocazioni_turno) {
      return { ok: false, motivo: "Evocazioni bloccate" };
    }
    const costo = this.calcolaCostoEffettivo(giocatore, demone);
    const pagate = giocatore.pagaEvocazione(demone, costo);
    if (!pagate) return { ok: false, motivo: "Pagamento fallito" };
    this.limbo.splice(index, 1);
    giocatore.cerchia.push(demone);
    this._emit("demone_aggiunto_cerchia", { giocatore, demone, fonte: "limbo" });
    this._log("evoca_da_limbo", `${giocatore.nome} evoca ${demone.nome} dal Limbo`, {
      giocatore: giocatore.nome,
      demone: demone.nome,
      costo,
    });
    this._emit("azione", { giocatore: giocatore.nome, azione: `Evoca ${demone.nome}` });
    this._emit("evoca_da_limbo", { giocatore, demone, pagate });
    if (this.onAzione) {
      this.onAzione(giocatore.nome, `Evoca ${demone.nome}`);
    }
    return { ok: true, demone, pagate };
  }

  evocaDaLimboPerCarta(demone, giocatore) {
    const idx = this.limbo.lastIndexOf(demone);
    if (idx === -1) return { ok: false, motivo: "Non trovato nel Limbo" };
    return this.evocaDaLimbo(idx, giocatore);
  }

  mandaNelLimbo(demone) {
    if (!this.limbo.includes(demone)) {
      this.limbo.push(demone);
    }
  }

  scartaCarte(carte) {
    // Metodo legacy: senza attore
    this.scartaCarteDi(null, carte);
  }

  _emitPrelievoScarti(giocatore, carte = []) {
    const list = Array.isArray(carte) ? carte.filter(Boolean) : [];
    this._emit("scarti_prelevati", { giocatore, carte: list });
  }

  scartaCarteDi(giocatore, carte) {
    const list = Array.isArray(carte) ? carte.filter(Boolean) : [];
    if (!list.length) return;
    // Rimuovi anche dalla mano del giocatore (se presenti)
    if (giocatore?.mano) {
      list.forEach(c => {
        const idx = giocatore.mano.indexOf(c);
        if (idx >= 0) giocatore.mano.splice(idx, 1);
      });
    }
    this.scarti.unshift(...list);
    const count = list.length;
    const nome = giocatore?.nome || "Sistema";
    this._log("scarta", `${nome} scarta ${count} carta/e`, { giocatore: giocatore?.nome || null, count, carte: list.map(c=>c.nome) });
    this._emit("azione", { giocatore: giocatore?.nome || "Sistema", azione: `Scarta ${count} carta/e` });
    this._emit("scarta_carte", { giocatore, carte: list });
    if (this.onAzione) {
      this.onAzione(nome, `Scarta ${count} carta/e`);
    }
  }

  processaImprevisto(carta, giocatore) {
    if (!(carta instanceof Imprevisto)) return { handled: false };
    const nome = (carta.nome || "").toLowerCase().replaceAll(" ", "_");
    const res = { handled: true, nome: carta.nome, effetto: null };

    const demoneDaCerchia = (plr) => (plr?.cerchia?.length ? plr.cerchia[0] : null);

    switch (true) {
      case nome.includes("giorno_di_festa"):
        giocatore.costo_extra_evocazione += 1;
        res.effetto = "costo_extra";
        break;
      case nome.includes("lezione_morale"):
        giocatore.blocco_evocazioni_turno = true;
        res.effetto = "blocco_evocazioni";
        break;
      case nome.includes("scomunica"):
        res.effetto = "fine_turno";
        break;
      case nome.includes("santa_inquisizione"): {
        const d = demoneDaCerchia(giocatore);
        if (d) {
          giocatore.cerchia.splice(giocatore.cerchia.indexOf(d), 1);
          this.cimitero.push(d);
          res.effetto = "cimitero";
        }
        break;
      }
      case nome.includes("buon_samaritano"): {
        if (giocatore.mano.length) {
          const c = giocatore.mano.shift();
          if (c) this.scartaCarteDi(giocatore, [c]);
        }
        res.effetto = "scarta";
        break;
      }
      case nome.includes("esorcista"): {
        const d = demoneDaCerchia(giocatore);
        if (d) {
          giocatore.cerchia.splice(giocatore.cerchia.indexOf(d), 1);
          this.mandaNelLimbo(d);
          res.effetto = "limbo";
        }
        break;
      }
      case nome.includes("balbettio"):
        res.effetto = "nulla";
        break;
      case nome.includes("deus_ex_machina"):
        res.effetto = "conquista_immediata";
        break;
      case nome.includes("videocall_nostalgica"): {
        if (this.cimitero.length) {
          const d = this.cimitero.pop();
          if (d) this.mandaNelLimbo(d);
          res.effetto = "limbo";
        }
        break;
      }
      case nome.includes("colpo_di_fulmine"):
        res.effetto = "conquista_immediata";
        break;
      case nome.includes("culto_dell'agnello"): {
        const dem = (giocatore.cerchia || []).slice().sort((a,b)=> (a?.livello_stella||0)-(b?.livello_stella||0))[0];
        if (dem) {
          const lvl = dem.livello_stella || 0;
          giocatore.cerchia.splice(giocatore.cerchia.indexOf(dem), 1);
          this.cimitero.push(dem);
          res.effetto = "culto_agnello";
          res.sacrificato = dem;
          res.livello = lvl;
          for (let i = 0; i < lvl; i += 1) {
            const c = this.mazzo_rifornimenti.pesca();
            if (c) giocatore.mano.push(c);
          }
        } else {
          res.effetto = "nulla";
        }
        break;
      }
      case nome.includes("novo_ordine_mentale"): {
        const pick = [...this.scarti].sort((a,b)=> (b?.valore||0)-(a?.valore||0))[0];
        if (pick) {
          this.scarti.splice(this.scarti.lastIndexOf(pick), 1);
          this._emitPrelievoScarti(giocatore, [pick]);
          giocatore.mano.push(pick);
          res.effetto = "scarti_recuperati";
          res.carta = pick;
        } else {
          res.effetto = "nulla";
        }
        break;
      }
      default:
        res.effetto = "non_gestito";
    }
    this._log("imprevisto", `${giocatore.nome} pesca imprevisto ${carta.nome} -> ${res.effetto || "?"}`, {
      giocatore: giocatore.nome,
      carta: carta.nome,
      effetto: res.effetto,
    });
    if (this.onAzione) {
      this.onAzione(giocatore.nome, `Imprevisto: ${carta.nome}`);
    }
    this._emit("azione", { giocatore: giocatore.nome, azione: `Imprevisto: ${carta.nome}` });
    return res;
  }

  addListener(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = new Set();
    this._listeners[event].add(fn);
    return () => this.removeListener(event, fn);
  }

  removeListener(event, fn) {
    const set = this._listeners[event];
    if (set) set.delete(fn);
  }

  _emit(event, payload) {
    const set = this._listeners[event];
    if (!set) return;
    set.forEach(fn => {
      try { fn(payload); } catch (_) { /* ignore */ }
    });
  }

  _log(type, message, detail = {}) {
    const entry = { ts: Date.now(), type, message, detail };
    this.log.push(entry);
    if (this.log.length > 200) this.log.shift();
    this._emit("log", entry);
  }
}

// Helper rapido: crea partita con un giocatore umano (nome) e N bot placeholder.
export async function creaPartita(
  nomeGiocatore = "Player",
  botCountOrNames = 0,
  onAzione = null
) {
  const giocatori = [new Giocatore(nomeGiocatore)];
  if (Array.isArray(botCountOrNames)) {
    botCountOrNames.forEach((n, idx) => {
      const g = new Giocatore(n || `Bot ${idx + 1}`);
      g.isBot = true;
      giocatori.push(g);
    });
  } else {
    for (let i = 0; i < botCountOrNames; i += 1) {
      const g = new Giocatore(`Bot ${i + 1}`);
      g.isBot = true;
      giocatori.push(g);
    }
  }
  const gioco = await Gioco.crea(giocatori);
  if (onAzione) {
    gioco.onAzione = onAzione;
  }
  return gioco;
}
