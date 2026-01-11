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
      this.scarti.push(carta);
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

  conquistaBoss(boss) {
    if (!boss) return false;
    const player = this.giocatoreCorrente();
    const ok = player.decidiConquistaBoss(boss);
    if (ok) {
      player.boss_conquistati.push(boss);
      this.boss_disponibili.shift();
      this._log("conquista_boss", `${player.nome} conquista ${boss.nome}`, { giocatore: player.nome, boss: boss.nome });
      if (this.onAzione) {
        this.onAzione(player.nome, "Conquista il boss!");
      }
      this._emit("azione", { giocatore: player.nome, azione: `Conquista ${boss.nome}` });
    }
    if (!ok) {
      this._log("conquista_boss_fallita", `${player.nome} fallisce ${boss?.nome || "boss"}`, { giocatore: player.nome, boss: boss?.nome || null });
    }
    this.tentativo_conquista_fatto = true;
    return ok;
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
    this._log("evoca_da_limbo", `${giocatore.nome} evoca ${demone.nome} dal Limbo`, {
      giocatore: giocatore.nome,
      demone: demone.nome,
      costo,
    });
    this._emit("azione", { giocatore: giocatore.nome, azione: `Evoca ${demone.nome}` });
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
    this.scarti.push(...carte);
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
          if (c) this.scarti.push(c);
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
