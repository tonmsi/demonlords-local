// Modelli di base per il motore di gioco (porting da Python).
// Il rendering resta in Phaser, qui gestiamo solo dati e logica.

export const TipoCartaRifornimento = {
  ENERGIA_FUOCO: "ENERGIA_FUOCO",
  ENERGIA_ACQUA: "ENERGIA_ACQUA",
  ENERGIA_TERRA: "ENERGIA_TERRA",
  ENERGIA_ARIA: "ENERGIA_ARIA",
  ENERGIA_ETERE: "ENERGIA_ETERE",
};

export const ElementoSimbolo = {
  F: "fuoco",
  W: "acqua",
  T: "terra",
  A: "aria",
  E: "etere",
};

export function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class Carta {
  constructor(data) {
    this.nome = data?.nome || "Carta";
    this.tipo = data?.tipo || null;
  }
}

export class CartaRifornimento extends Carta {
  constructor(data) {
    super(data);
    this.categoria = (data?.categoria || "energia").toLowerCase();
    this.valore = data?.valore ?? 0;
    this.tipo = data?.tipo || null;
    this.tipi = Array.isArray(data?.tipi) && data.tipi.length ? [...data.tipi] : this.tipo ? [this.tipo] : [];
    this.descrizione = data?.descrizione || "";
    this.azione_boss = data?.azione_boss || {};
    this.tipo_effetto = data?.tipo_effetto || null;
    this.costo_tipo = data?.costo_tipo || null;
    this.costo_tipo_minimo = data?.costo_tipo_minimo || 0;
  }

  isEnergia() {
    return this.categoria === "energia";
  }

  isMagia() {
    return this.categoria === "magia";
  }
}

export class Demone extends Carta {
  constructor(data) {
    super(data);
    this.livello_stella = data?.livello_stella ?? 0;
    this.costo = data?.costo ?? 0;
    this.effetto = data?.effetto || "";
    this.elemento = data?.elemento || null; // es. "F", "W", ...
    this.tipo_effetto = data?.tipo_effetto || "entrata"; // entrata | azione | passivo
    this.costo_tipo = data?.costo_tipo || null; // es. "ENERGIA_TERRA"
    this.costo_tipo_minimo = data?.costo_tipo_minimo ?? 0;
  }
}

export class Artefatto extends Carta {
  constructor(data) {
    super(data);
    this.tipo = data?.tipo || null;
    this.valore = data?.valore ?? 0;
    this.tipo_effetto = data?.tipo_effetto || "passivo";
    this.descrizione = data?.descrizione || "";
  }
}

export class Imprevisto extends Carta {
  constructor(data) {
    super(data);
    this.descrizione = data?.descrizione || "";
  }
}

export class Boss extends Carta {
  constructor(data) {
    super(data);
    this.valori = data?.valori || {}; // requisiti per elemento
    this.livello_stella = data?.livello_stella ?? 0; // usato in probabilità conquista
  }
}

export class Mazzo {
  constructor(carte = []) {
    this.carte = [...carte];
  }

  pesca() {
    return this.carte.pop() || null;
  }

  inserisciInCima(carta) {
    if (carta) this.carte.push(carta);
  }

  inserisciInFondo(carta) {
    if (carta) this.carte.unshift(carta);
  }

  mescola() {
    shuffleInPlace(this.carte);
  }

  get size() {
    return this.carte.length;
  }
}
