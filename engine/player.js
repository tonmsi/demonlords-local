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
    this._sibilla_used_turn = false;
    this._ora_used = false;
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
   * Seleziona la combinazione col totale più basso che soddisfa costo e requisito di tipo.
   * In caso di parità sul totale, preferisce la combinazione con meno carte.
   */
  trovaPagamento(costoRichiesto, costoTipo = null, costoTipoMinimo = 0) {
    const valoreCarta = (c) => {
      if (!c) return 0;
      if (typeof c.valore === "number") return c.valore;
      if ((c?.categoria || "").toLowerCase() === "magia") return 2; // magie/spostastelle valgono 2
      return 0;
    };

    const includeBossMagic = !!this.isBot; // i bot possono usare anche spostastelle/stoppastella per pagare
    const energieGrezz = this.mano.filter(c => {
      const cat = (c?.categoria || "").toLowerCase();
      const isBossMagic = cat === "magia" && c?.azione_boss;
      const isMagic = cat === "magia" && !c?.azione_boss;
      // Usa energie e magie; per i bot consenti anche spostastelle/stoppastella quando serve pagare
      if (cat === "energia" || isMagic) return true;
      if (includeBossMagic && isBossMagic) return true;
      return false;
    });
    if (!energieGrezz.length) return [];

    // Limita a 16 carte per evitare esplosione combinatoria
    const energie = energieGrezz
      .map((c, idx) => ({ c, v: valoreCarta(c), idx }))
      .sort((a, b) => a.v - b.v)
      .slice(0, 16);

    const N = energie.length;
    let best = null;
    const totalMasks = 1 << N;

    const satisfiesTipo = (subset) => {
      if (!costoTipo) return true;
      const tipoVal = subset.reduce((sum, entry) => {
        const c = entry.c;
        const tipi = c?.tipi || [];
        const match = tipi.includes(costoTipo) || c?.tipo === costoTipo || c?.tipo === "ENERGIA_ETERE" || tipi.includes("ENERGIA_ETERE");
        return match ? sum + entry.v : sum;
      }, 0);
      return tipoVal >= costoTipoMinimo;
    };

    // Esplora le combinazioni e scegli quella con overshoot minimo
    for (let mask = 1; mask < totalMasks; mask += 1) {
      let total = 0;
      const subset = [];
      for (let i = 0; i < N; i += 1) {
        if (mask & (1 << i)) {
          subset.push(energie[i]);
          total += energie[i].v;
        }
      }
      if (total < costoRichiesto) continue;
      if (!satisfiesTipo(subset)) continue;

      if (
        !best ||
        total < best.total ||
        (total === best.total && subset.length < best.len)
      ) {
        best = { total, len: subset.length, cards: subset.map(e => e.c) };
      }
    }

    return best ? best.cards : [];
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
