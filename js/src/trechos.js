// Divisão de páginas Markdown em trechos ("chunks"), como o documentos.py.
// Cada página é dividida pelas seções (## e ###) e, se uma seção for longa, em blocos de
// parágrafos inteiros. A ficha em YAML (frontmatter "ficha") também vira trecho.
//
// O "nível" de um trecho é a partir de quando ele pode ser mostrado (na wiki do
// Equiverso, o episódio mais avançado que ele cita). O motor não sabe o que é episódio:
// quem usa passa a regra em `nivel` (veja episodios.js). Sem regra, nada é escondido.

import { limparMarkdown } from "./texto.js"

export const TAMANHO_MAXIMO = 1400 // caracteres por trecho: cabe folgado no contexto e mantém o foco

/** Divide um texto longo em blocos de parágrafos inteiros. */
export function janelas(texto, limite = TAMANHO_MAXIMO) {
  const blocos = []
  let atual = ""
  for (const paragrafo of texto.split("\n\n").map((p) => p.trim())) {
    if (!paragrafo) continue
    if (atual && atual.length + paragrafo.length > limite) {
      blocos.push(atual)
      atual = ""
    }
    atual = `${atual}\n\n${paragrafo}`.trim()
  }
  if (atual) blocos.push(atual)
  return blocos
}

/** Separa o frontmatter (entre linhas "---") do corpo; o frontmatter volta como texto. */
export function separarFrontmatter(conteudo) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(conteudo.replace(/\r\n/g, "\n"))
  return m ? [m[1], conteudo.replace(/\r\n/g, "\n").slice(m[0].length)] : ["", conteudo.replace(/\r\n/g, "\n")]
}

/**
 * Trechos de uma página.
 * @param {object} pagina { slug, titulo, apelidos?, corpo, ficha? }: corpo sem o frontmatter;
 *   ficha é o objeto já lido do YAML (seção -> campo -> texto ou lista).
 * @param {object} opcoes
 *   nivelBase: nível da página inteira (na wiki, a primeira aparição ou o próprio episódio);
 *   nivel: { citacoes(texto) -> níveis citados, maisAvancado(lista) -> nível, marcaFicha? };
 *   secoesIgnoradas: nomes de seção (minúsculas) que não viram trecho;
 *   tamanhoMaximo, minimo: limites de tamanho do trecho.
 * @returns {{p:string,t:string,s:string,x:string,e:string|null,a?:string[]}[]}
 */
export function dividirPagina(pagina, opcoes = {}) {
  const { nivelBase = null, nivel = null, secoesIgnoradas = [], tamanhoMaximo = TAMANHO_MAXIMO, minimo = 40 } = opcoes
  const ignoradas = new Set(secoesIgnoradas.map((s) => s.toLowerCase()))
  const juntar = (lista) => (nivel ? nivel.maisAvancado(lista) : null)
  const citados = (texto) => (nivel ? nivel.citacoes(texto) : [])
  const apelidos = (pagina.apelidos ?? []).map(String)
  const trechos = []
  const adicionar = (secao, md, e, min = minimo) => {
    const texto = limparMarkdown(md)
    if (texto.length < min) return // descarta restos sem conteúdo (legendas, linhas soltas)
    trechos.push({ p: pagina.slug, t: pagina.titulo, s: secao, x: texto, e: e ?? null, ...(apelidos.length ? { a: apelidos } : {}) })
  }

  // Partes da página: o texto antes do primeiro título é o resumo.
  const corpo = pagina.corpo.replace(/\r\n/g, "\n")
  const marcas = [...corpo.matchAll(/^(#{2,3})\s+(.*)$/gm)]
  const partes = [["Resumo", marcas.length ? corpo.slice(0, marcas[0].index) : corpo]]
  let pai = ""
  marcas.forEach((m, i) => {
    const fim = i + 1 < marcas.length ? marcas[i + 1].index : corpo.length
    const nome = m[2].replace(/\s*\(contém spoilers[^)]*\)/, "").trim()
    let rotulo = nome
    if (m[1] === "##") pai = nome
    else if (pai) rotulo = `${pai} › ${nome}`
    partes.push([rotulo, corpo.slice(m.index + m[0].length, fim)])
  })
  for (const [secao, md] of partes) {
    if (ignoradas.has(secao.split(" › ")[0].toLowerCase())) continue
    for (const bloco of janelas(md, tamanhoMaximo)) adicionar(secao, bloco, juntar([nivelBase, ...citados(bloco)]))
  }

  // Ficha: as linhas de cada seção são agrupadas pelo nível em que foram reveladas
  // (na wiki, o código entre chaves no fim do valor, como "{xdq-04}").
  const marca = nivel?.marcaFicha ?? /\{([^{}]+)\}\s*$/
  if (pagina.ficha && typeof pagina.ficha === "object") {
    for (const [secao, campos] of Object.entries(pagina.ficha)) {
      const porNivel = new Map()
      for (const [campo, valor] of Object.entries(campos ?? {})) {
        for (const v of Array.isArray(valor) ? valor : [valor]) {
          const texto = String(v)
          const m = marca.exec(texto)
          const e = juntar([m ? m[1] : nivelBase, nivelBase, ...citados(texto)])
          const linhas = porNivel.get(e) ?? []
          linhas.push(`${campo}: ${texto.replace(marca, "").trim()}`)
          porNivel.set(e, linhas)
        }
      }
      for (const [e, linhas] of porNivel) adicionar(`Ficha: ${secao}`, linhas.join("\n"), e, 1)
    }
  }
  return trechos
}
