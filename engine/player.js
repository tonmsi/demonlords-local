// Stato e decisioni del giocatore (porting semplificato da game/player.py).

export class Giocatore {
  constructor(nome) {
    this.nome = nome;
    this.mano = [];
    this.cerchia = [];
    this.boss_conquistati = [];
    this.boss_conosciuti = new Set();
    this.artefatto_attivo = null;
    this.artefatto_azione_usata = false;
    this.artefatto_passiva_usata = false;
    this.terra_jolly = false;
    this.sigillo = null;
    this.azioni_extra = 0;
    this.costo_extra_evocazione = 0;
    this.blocco_evocazioni_turno = false;
    this.stelle_bonus = 1; // bonus permanente iniziale
  }

  resetInizioTurno() {
    this.artefatto_azione_usata = false;
    this.artefatto_passiva_usata = false;
    this.terra_jolly = false;
    this.azioni_extra = 0;
    this.costo_extra_evocazione = 0;
    this.blocco_evocazioni_turno = false;
    this.cerchia.forEach(d => {
      d._azione_usata_turno = false;
    });
  }

  livelloEffettivo(demone) {
    const livello = demone?.livello_stella ?? 0;
    const override = demone?._livello_override;
    const bonus = demone?._bonus_stelle ?? 0;
    let eff = override != null ? override : livello + bonus;
    if (
      this.artefatto_attivo &&
      this.artefatto_attivo.nome === "Lancia Divina" &&
      this.cerchia.includes(demone) &&
      eff === 1
    ) {
      eff = 2;
    }
    return Math.max(0, eff);
  }

  get totale_stelle() {
    const sumStelle = this.cerchia.reduce((acc, d) => acc + this.livelloEffettivo(d), 0);
    return sumStelle - this.boss_conquistati.length + this.stelle_bonus;
  }

  probabilitaConquistaBoss(boss) {
    const numStelle = boss?.livello_stella ?? 0;
    if (numStelle < 3) return 0;
    let prob = 1.4 ** (numStelle + 1);
    const haSpostastelle = this.mano.some(c => c?.azione_boss);
    if (haSpostastelle) prob *= 1.25;
    const soglia = 3;
    if (prob < soglia) prob = 0;
    return prob;
  }

  decidiConquistaBoss(boss) {
    const prob = this.probabilitaConquistaBoss(boss);
    if (prob === 0) return false;
    return Math.random() < Math.min(prob / 100, 1);
  }

  decidiSeEvocare() {
    return true;
  }

  decidiCartaDaScartare() {
    if (!this.mano.length) return null;
    // Scegli la carta con valore più basso come fallback semplice
    let best = this.mano[0];
    let bestVal = best?.valore ?? 0;
    this.mano.forEach(c => {
      const val = c?.valore ?? 0;
      if (val < bestVal) {
        best = c;
        bestVal = val;
      }
    });
    return best;
  }

  /**
   * Trova una combinazione di carte energia per pagare un costo.
   * Semplice greedy: soddisfa prima il requisito di tipo, poi somma per valore.
   */
  trovaPagamento(costoRichiesto, costoTipo = null, costoTipoMinimo = 0) {
    const energie = this.mano.filter(c => c?.categoria === "energia");
    if (!energie.length) return [];

    const byValue = [...energie].sort((a, b) => (b?.valore ?? 0) - (a?.valore ?? 0));
    const pagamento = [];
    let totale = 0;
    let contatoreTipo = 0;

    // Prima soddisfa il requisito di tipo specifico
    if (costoTipo) {
      for (const c of byValue) {
        if (contatoreTipo >= costoTipoMinimo) break;
        if (c?.tipi?.includes?.(costoTipo) || c?.tipo === costoTipo) {
          pagamento.push(c);
          totale += c?.valore ?? 0;
          contatoreTipo += 1;
        }
      }
    }

    // Poi aggiungi le carte più alte fino a coprire il costo
    for (const c of byValue) {
      if (pagamento.includes(c)) continue;
      if (totale >= costoRichiesto) break;
      pagamento.push(c);
      totale += c?.valore ?? 0;
    }

    if (totale < costoRichiesto) {
      return [];
    }
    if (costoTipo && contatoreTipo < costoTipoMinimo) {
      return [];
    }
    return pagamento;
  }

  pagaEvocazione(demone, costoEffettivo) {
    const combo = this.trovaPagamento(
      costoEffettivo,
      demone?.costo_tipo || null,
      demone?.costo_tipo_minimo || 0
    );
    if (!combo.length) return null;
    // Rimuovi dal mano
    combo.forEach(c => {
      const idx = this.mano.indexOf(c);
      if (idx >= 0) this.mano.splice(idx, 1);
    });
    return combo;
  }
}
