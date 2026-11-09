// Normalização e tokenização de texto em português (mesmas regras do texto.py).
// A busca trata "Benício", "benicio" e "BENÍCIO" como a mesma palavra e ignora
// palavras muito comuns ("de", "que", "o"), que não ajudam a achar o trecho certo.

// Lista curta e proposital: palavras tão frequentes que só atrapalham o ranking.
export const PALAVRAS_VAZIAS = new Set(
  `a o as os um uma uns umas de do da dos das no na nos nas em por para pra
  pelo pela pelos pelas com sem sob sobre entre ate e ou mas que se nao sim
  ja so mais menos muito muita muitos muitas ao aos isso isto esse essa
  esses essas este esta estes estas aquele aquela aqueles aquelas ele ela
  eles elas eu tu voce voces nos me te lhe seu sua seus suas meu minha meus
  minhas foi era ser sao estao tem tinha ter ha quando como onde quem
  qual quais porque pois tambem depois antes ainda la aqui ali entao`.split(/\s+/),
)

/** Remove acentos: "Benício" -> "Benicio". */
export const semAcento = (texto) => texto.normalize("NFKD").replace(/[̀-ͯ]/g, "")

/** Troca links por seus textos visíveis e tira marcações de Markdown e HTML. */
export const limparMarkdown = (texto) =>
  texto
    .replace(/```[\s\S]*?(```|$)/g, " ") // blocos de código (árvores em Mermaid etc.)
    .replace(/\[\[([^\]|]+)(?:\\?\|([^\]]+))?\]\]/g, (_, alvo, nome) => nome ?? alvo)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\S+/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_`>#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

/**
 * Stemmer bem simples para português: junta plurais e gêneros comuns
 * ("vampiros" ~ "vampiro", "investigadora" ~ "investigador").
 */
export function radical(palavra) {
  if (palavra.length <= 4) return palavra
  for (const [sufixo, troca] of [["coes", "cao"], ["oes", "ao"], ["ais", "al"], ["eis", "el"], ["res", "r"]]) {
    if (palavra.endsWith(sufixo)) return palavra.slice(0, -sufixo.length) + troca
  }
  if (palavra.endsWith("s")) palavra = palavra.slice(0, -1)
  if ((palavra.endsWith("a") || palavra.endsWith("o")) && palavra.length > 4) palavra = palavra.slice(0, -1)
  return palavra
}

/** Texto -> lista de termos normalizados, sem palavras vazias. */
export const tokenizar = (texto) =>
  (semAcento(limparMarkdown(texto)).toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((t) => !PALAVRAS_VAZIAS.has(t))
    .map(radical)
