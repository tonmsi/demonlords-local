// Costruzione dei mazzi a partire dai JSON originali.
// Le funzioni restituiscono Mazzo o array pronti per il motore JS.

import {
  Artefatto,
  Boss,
  CartaRifornimento,
  Demone,
  Imprevisto,
  Mazzo,
  shuffleInPlace,
} from "./entities.js";

async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Impossibile caricare ${url}: ${res.status}`);
  return res.json();
}

function expandEntries(entries, Factory) {
  const out = [];
  entries.forEach(entry => {
    const qty = entry?.quantita ?? 1;
    for (let i = 0; i < qty; i += 1) {
      out.push(new Factory(entry));
    }
  });
  return out;
}

export async function buildRifornimentiDeck(url = "data/rifornimenti.json") {
  const cfg = await loadJson(url);
  const carte = [];

  cfg.forEach(entry => {
    const categoria = (entry?.categoria || "energia").toLowerCase();
    const qty = entry?.quantita ?? 1;
    if (categoria === "artefatto") {
      for (let i = 0; i < qty; i += 1) {
        carte.push(new Artefatto(entry));
      }
      return;
    }
    for (let i = 0; i < qty; i += 1) {
      carte.push(new CartaRifornimento(entry));
    }
  });

  const deck = new Mazzo(carte);
  deck.mescola();
  return deck;
}

export async function buildEvocazioniDeck(
  demoniUrl = "data/demoni.json",
  imprevistiUrl = "data/imprevisti.json",
) {
  const [demoniCfg, imprevistiCfg] = await Promise.all([
    loadJson(demoniUrl),
    loadJson(imprevistiUrl),
  ]);
  const demoni = expandEntries(demoniCfg, Demone);
  const imprevisti = expandEntries(imprevistiCfg, Imprevisto);
  const carte = demoni.concat(imprevisti);
  const deck = new Mazzo(carte);
  deck.mescola();
  return deck;
}

export async function buildBossList(url = "data/boss.json") {
  const cfg = await loadJson(url);
  const bossList = expandEntries(cfg, Boss);
  bossList.forEach(b => {
    const vals = b?.valori || {};
    const sum = Object.values(vals).reduce((acc, n) => acc + (Number(n) || 0), 0);
    const stimato = Math.max(3, Math.round(sum / 10)); // stima grezza per avere almeno 3 stelle
    b.livello_stella = b.livello_stella || stimato;
  });
  shuffleInPlace(bossList);
  return bossList;
}
