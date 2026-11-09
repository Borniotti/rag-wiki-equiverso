// Busca BM25 implementada do zero, com filtro de nível (spoiler), como o busca.py.
// BM25 dá nota alta a um trecho quando ele contém os termos da pergunta, quando esses
// termos são raros na coleção e quando o trecho não é enorme. A wiki é cheia de nomes
// próprios, e busca por palavra-chave acerta nomes muito bem, sem outra API.

import { tokenizar } from "./texto.js"

export const PESO_TITULO = 3 // termos do título e dos apelidos contam como se aparecessem 3 vezes

export class IndiceBM25 {
  /** @param {{t:string,s:string,x:string,a?:string[],p:string}[]} trechos */
  constructor(trechos, { pesoTitulo = PESO_TITULO, k1 = 1.5, b = 0.75 } = {}) {
    this.trechos = trechos
    this.k1 = k1
    this.b = b
    this.termos = trechos.map((t) => {
      const contagem = new Map()
      const somar = (lista, vezes = 1) => {
        for (const termo of lista) contagem.set(termo, (contagem.get(termo) ?? 0) + vezes)
      }
      somar(tokenizar([t.t, ...(t.a ?? [])].join(" ")), pesoTitulo)
      somar(tokenizar(t.s ?? ""))
      somar(tokenizar(t.x))
      return contagem
    })
    this.tamanhos = this.termos.map((c) => [...c.values()].reduce((a, v) => a + v, 0))
    this.media = this.tamanhos.reduce((a, v) => a + v, 0) / Math.max(this.tamanhos.length, 1)
    const frequencia = new Map()
    for (const c of this.termos) for (const termo of c.keys()) frequencia.set(termo, (frequencia.get(termo) ?? 0) + 1)
    const n = trechos.length
    // IDF com suavização (+1) para nunca ficar negativo.
    this.idf = new Map([...frequencia].map(([termo, df]) => [termo, Math.log(1 + (n - df + 0.5) / (df + 0.5))]))
    this.idfAusente = Math.log(1 + (n + 0.5) / 0.5)
  }

  nota(i, termos) {
    const contagem = this.termos[i]
    const norma = this.k1 * (1 - this.b + (this.b * this.tamanhos[i]) / this.media)
    let nota = 0
    for (const termo of termos) {
      const tf = contagem.get(termo)
      if (tf) nota += (this.idf.get(termo) * tf * (this.k1 + 1)) / (tf + norma)
    }
    return nota
  }

  /**
   * Os `k` melhores trechos que o leitor pode ver.
   * `liberado(trecho)` filtra o que é spoiler; `porPagina` evita que uma só página ocupe
   * todo o contexto (respostas melhores juntam fontes diferentes).
   * Cada resultado traz `cobertura`: quanto da pergunta, pesada pela raridade dos termos,
   * o trecho cobre. Termo que não existe na coleção ("Copa", "2002") pesa o máximo.
   */
  buscar(pergunta, { k = 6, porPagina = 2, liberado = () => true } = {}) {
    const termos = tokenizar(pergunta)
    if (!termos.length) return []
    const pesos = new Map([...new Set(termos)].map((t) => [t, this.idf.get(t) ?? this.idfAusente]))
    const total = [...pesos.values()].reduce((a, v) => a + v, 0)
    const candidatos = []
    this.trechos.forEach((trecho, i) => {
      if (!liberado(trecho)) return
      const nota = this.nota(i, termos)
      if (nota <= 0) return
      let coberto = 0
      for (const [termo, peso] of pesos) if (this.termos[i].has(termo)) coberto += peso
      candidatos.push({ trecho, indice: i, nota, cobertura: coberto / total })
    })
    candidatos.sort((a, b) => b.nota - a.nota)
    const escolhidos = []
    const contagem = new Map()
    for (const r of candidatos) {
      if ((contagem.get(r.trecho.p) ?? 0) >= porPagina) continue
      escolhidos.push(r)
      contagem.set(r.trecho.p, (contagem.get(r.trecho.p) ?? 0) + 1)
      if (escolhidos.length === k) break
    }
    return escolhidos
  }
}

/** Se nenhum trecho cobre pelo menos `minima` da pergunta, a coleção provavelmente não fala disso. */
export const coberturaSuficiente = (resultados, minima = 0.5) =>
  resultados.length > 0 && Math.max(...resultados.map((r) => r.cobertura)) >= minima
