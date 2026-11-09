// Ordem cronológica dos episódios do Equiverso: Equinócio (eq) -> Só Assim (sa) ->
// X da Questão (xdq). "xdq-09-5" é um vídeo extra entre os episódios 9 e 10.
// É a "regra de nível" que a wiki passa ao motor: com ela, a busca sabe se um trecho
// é spoiler para quem parou num episódio. Outro projeto pode trocar por outra regra
// (capítulos de um livro, datas, versões de um produto...).

const ORDEM = { eq: 0, sa: 1, xdq: 2 }
const NOMES = { eq: "Eq", sa: "SA", xdq: "XdQ" }
export const CODIGO = /^(eq|sa|xdq)-(\d{2})(?:-(\d))?$/
const CODIGO_NO_TEXTO = /\b(eq|sa|xdq)-\d{2}(?:-\d)?\b/g

/** Número comparável de um código de episódio ("xdq-09-5" -> 20095). */
export function posicao(codigo) {
  const m = CODIGO.exec(String(codigo).trim().toLowerCase())
  if (!m) throw new Error(`código de episódio inválido: ${codigo} (ex.: xdq-03, eq-07-5)`)
  return ORDEM[m[1]] * 10000 + Number(m[2]) * 10 + Number(m[3] ?? 0)
}

export const ehCodigo = (codigo) => CODIGO.test(String(codigo).trim().toLowerCase())

/** "xdq-09-5" -> "XdQ 9,5". */
export function rotulo(codigo) {
  const m = CODIGO.exec(codigo)
  return `${NOMES[m[1]]} ${Number(m[2])}${m[3] ? "," + m[3] : ""}`
}

/** Todos os episódios citados num texto (ex.: "([[xdq-03|XdQ 3]])"), sem repetir, em ordem. */
export function citacoes(texto) {
  const vistos = [...new Set((String(texto).toLowerCase().match(CODIGO_NO_TEXTO) ?? []))]
  return vistos.sort((a, b) => posicao(a) - posicao(b))
}

/** O episódio mais avançado de uma lista (ignora vazios), ou null. */
export function maisAvancado(codigos) {
  const validos = codigos.filter((c) => c && ehCodigo(c))
  return validos.length ? validos.reduce((a, b) => (posicao(b) > posicao(a) ? b : a)) : null
}

/**
 * Regra de spoiler para a busca: devolve a função que diz se um trecho pode ser
 * mostrado para quem assistiu até `ate` ("tudo" ou null libera tudo).
 */
export function liberadoAte(ate) {
  if (!ate || ate === "tudo") return () => true
  const limite = posicao(ate)
  return (trecho) => !trecho.e || posicao(trecho.e) <= limite
}

// ---------- episódios citados na pergunta ----------
// "o que aconteceu no ep 38 de X da Questão?", "XdQ 38", "episódio 5 do Equinócio",
// "so assim 2": a pergunta vira o termo especial "@xdq-38", que casa com os trechos que
// citam o episódio e, com mais peso, com a página do próprio episódio. Sem isso, "ep",
// "38", "x" e "questão" seriam palavras soltas que quase nenhum trecho tem.

const TEMPORADA = String.raw`(xdq|x\s*d[ae]\s*questao|eq|equinocio|sa|so\s*assim)`
const NUMERO = String.raw`(\d{1,2})(?:[.,](\d))?`
const EP = String.raw`(?:ep(?:isodio)?s?\.?|capitulo)`
const PADROES = [
  // "xdq 38", "x da questao ep 38", "equinocio, episodio 5"
  new RegExp(String.raw`\b${TEMPORADA}\s*[,:-]?\s*(?:${EP}\s*)?(?:n[.ºo°]?\s*)?${NUMERO}\b`, "g"),
  // "ep 38 de x da questao", "episodio 5 do equinocio", "ep 2 da temporada so assim"
  new RegExp(String.raw`\b${EP}\s*(?:n[.ºo°]?\s*)?${NUMERO}\s*(?:d[aeo]s?\s+)?(?:temporada\s+)?${TEMPORADA}\b`, "g"),
]
const SO_NUMERO = new RegExp(String.raw`\b${EP}\s*(?:n[.ºo°]?\s*)?${NUMERO}\b`, "g")
const PREFIXO = (nome) => (nome.startsWith("x") ? "xdq" : nome.startsWith("e") ? "eq" : "sa")
const montar = (prefixo, n, d) => `${prefixo}-${String(Number(n)).padStart(2, "0")}${d ? "-" + d : ""}`

/**
 * Acha os episódios mencionados numa pergunta. Devolve `{ texto, termos }`: o texto sem
 * as menções e os termos especiais ("@xdq-38"). "ep 38" sem temporada vira as três
 * possibilidades; a busca ignora as que não existem na wiki.
 */
export function lerPergunta(pergunta) {
  let texto = String(pergunta).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  const termos = []
  const ordem = (m) => (/^\d/.test(m[1]) ? [m[3], m[1], m[2]] : [m[1], m[2], m[3]])
  for (const padrao of PADROES) {
    texto = texto.replace(padrao, (...m) => {
      const [temporada, n, d] = ordem(m)
      termos.push("@" + montar(PREFIXO(temporada.replace(/\s+/g, "")), n, d))
      return " "
    })
  }
  texto = texto.replace(SO_NUMERO, (_, n, d) => {
    for (const prefixo of Object.keys(ORDEM)) termos.push("@" + montar(prefixo, n, d))
    return " "
  })
  return { texto, termos: [...new Set(termos)] }
}

/**
 * Termos especiais de um trecho: um "@código" por episódio que ele cita e, para os
 * trechos da página do próprio episódio, o código com peso de título.
 */
export function termosExtras(trecho, pesoTitulo = 3) {
  const termos = citacoes(`${trecho.s ?? ""} ${trecho.x ?? ""}`).map((c) => "@" + c)
  const fim = String(trecho.p ?? "").split("/").pop()
  if (ehCodigo(fim)) for (let i = 0; i < pesoTitulo; i++) termos.push("@" + fim)
  return termos
}
