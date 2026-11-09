// Motor de perguntas e respostas sobre pastas de Markdown (RAG):
//   1. dividirPagina: páginas -> trechos, cada um com o seu nível (spoiler);
//   2. IndiceBM25.buscar: acha os trechos certos, só entre os liberados;
//   3. responder: pede a resposta a um gerador (Cloudflare grátis, Claude...) e confere as
//      fontes; sem gerador, ou se ele falhar, responde com as frases dos próprios trechos.
// As peças também podem ser usadas separadas (na wiki, a busca roda no navegador e a
// geração no worker).

import { IndiceBM25, coberturaSuficiente } from "./busca.js"
import { INSTRUCOES, ESQUEMA, montarMensagem, conferirSaida, respostaExtrativa } from "./resposta.js"

export * from "./texto.js"
export * from "./trechos.js"
export * from "./busca.js"
export * from "./resposta.js"
export * from "./geradores.js"

export const NAO_ACHEI = "Não achei nada sobre isso (ou só há informação depois do ponto que você marcou)."

/**
 * Responde a uma pergunta de ponta a ponta.
 * @param {IndiceBM25} indice
 * @param {string} pergunta
 * @param {object} opcoes { liberado, gerador, instrucoes, k, porPagina, coberturaMinima }
 */
export async function responder(indice, pergunta, opcoes = {}) {
  const { liberado, gerador, instrucoes = INSTRUCOES, k = 6, porPagina = 2, coberturaMinima = 0.5 } = opcoes
  const resultados = indice.buscar(pergunta, { k, porPagina, liberado })
  if (!coberturaSuficiente(resultados, coberturaMinima)) return { resposta: NAO_ACHEI, fontes: [], encontrou: false, modo: "busca" }
  const trechos = resultados.map((r) => r.trecho)
  if (gerador) {
    try {
      const { saida, uso } = await gerador({ sistema: instrucoes, mensagem: montarMensagem(trechos, pergunta), esquema: ESQUEMA })
      const conferida = conferirSaida(saida, trechos)
      if (conferida) return { ...conferida, modo: "ia", uso }
    } catch {}
  }
  return { ...respostaExtrativa(pergunta, trechos), modo: "trechos" }
}

export { IndiceBM25 }
