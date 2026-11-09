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
