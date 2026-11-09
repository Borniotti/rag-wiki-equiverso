// Quem escreve a resposta a partir dos trechos. Todos os geradores têm a mesma forma:
//   const g = geradorX(...); const { saida, uso } = await g({ sistema, mensagem, esquema })
// `saida` é o objeto JSON lido (ou null) e `uso` traz os tokens gastos. Trocar de gerador
// não muda o resto do motor.
//
// - geradorWorkersAI: modelos de código aberto da Cloudflare (Workers AI), que têm uma
//   cota diária grátis. É o que a wiki usa, para ninguém pagar nada.
// - geradorClaude: o Claude, pela API da Anthropic (pago). Recebe o cliente já criado,
//   para o motor não depender do SDK.

import { lerSaida } from "./resposta.js"

// Quanto cada modelo da Cloudflare gasta da cota, em "neurônios" por milhão de tokens.
// São estimativas por cima (para o limite diário errar para menos, nunca para mais);
// confira os valores atuais na página de preços da Workers AI e ajuste se mudarem.
export const NEURONIOS_POR_MILHAO = {
  "@cf/openai/gpt-oss-120b": { entrada: 32000, saida: 69000 },
  "@cf/openai/gpt-oss-20b": { entrada: 19000, saida: 28000 },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { entrada: 27000, saida: 205000 },
  "@cf/meta/llama-3.1-8b-instruct-fp8": { entrada: 14000, saida: 35000 },
}
const NEURONIOS_DESCONHECIDO = { entrada: 40000, saida: 210000 }

/** Estimativa dos neurônios gastos numa chamada. */
export function estimarNeuronios(modelo, uso) {
  const taxa = NEURONIOS_POR_MILHAO[modelo] ?? NEURONIOS_DESCONHECIDO
  return ((uso.entrada ?? 0) * taxa.entrada + (uso.saida ?? 0) * taxa.saida) / 1e6
}

/**
 * Gerador com a Workers AI da Cloudflare.
 * @param ai o binding da Workers AI (env.AI no worker)
 * @param opcoes { modelo, esforco: "low" | "medium" | "high" (só nos gpt-oss), maxTokens }
 */
export function geradorWorkersAI(ai, { modelo = "@cf/openai/gpt-oss-120b", esforco = "low", maxTokens = 2048 } = {}) {
  const estiloOpenAI = modelo.includes("gpt-oss")
  return async ({ sistema, mensagem, esquema }) => {
    const base = {
      messages: [
        { role: "system", content: sistema },
        { role: "user", content: mensagem },
      ],
      max_tokens: maxTokens,
      ...(estiloOpenAI ? { reasoning_effort: esforco } : {}),
    }
    const formato = estiloOpenAI
      ? { type: "json_schema", json_schema: { name: "resposta", schema: esquema, strict: true } }
      : { type: "json_schema", json_schema: esquema }
    const lerUso = (r) => {
      const u = r?.usage ?? {}
      return { entrada: u.prompt_tokens ?? u.input_tokens ?? 0, saida: u.completion_tokens ?? u.output_tokens ?? 0 }
    }
    const semEsquema = { ...base, messages: [base.messages[0], { role: "user", content: mensagem + "\n\nResponda só com o objeto JSON." }] }
    let r
    try {
      r = await ai.run(modelo, { ...base, response_format: formato })
    } catch (erro) {
      // Alguns modelos recusam o formato com esquema. Como as instruções já pedem JSON,
      // tenta de novo sem ele; lerSaida acha o JSON no meio do texto. Erro de cota
      // (4006) ou de modelo fora do ar não adianta repetir.
      if (/4006|neurons|quota|capacity|not found/i.test(String(erro?.message ?? erro))) throw erro
      r = await ai.run(modelo, semEsquema)
      return { saida: lerSaida(textoDaResposta(r)), uso: lerUso(r), modelo, bruto: r }
    }
    let saida = lerSaida(textoDaResposta(r))
    let uso = lerUso(r)
    if (!saida) {
      // Aceitou o formato mas devolveu lixo (acontece com o gpt-oss-20b): mais uma vez, sem esquema.
      const r2 = await ai.run(modelo, semEsquema)
      const u2 = lerUso(r2)
      uso = { entrada: uso.entrada + u2.entrada, saida: uso.saida + u2.saida }
      saida = lerSaida(textoDaResposta(r2))
      r = r2
    }
    return { saida, uso, modelo, bruto: r }
  }
}

/**
 * Texto da resposta em qualquer dos formatos da Workers AI: chat completions
 * (choices[0].message.content, que pode vir em partes), Responses (output[].content[]) ou
 * o formato antigo dos Llama (response, às vezes já como objeto).
 */
export function textoDaResposta(r) {
  if (!r) return ""
  const conteudo = r.choices?.[0]?.message?.content
  if (typeof conteudo === "string" && conteudo.trim()) return conteudo
  if (Array.isArray(conteudo)) return conteudo.map((c) => c?.text ?? "").join("")
  if (Array.isArray(r.output)) {
    const textos = r.output
      .filter((o) => o?.type === "message")
      .flatMap((o) => (Array.isArray(o.content) ? o.content : []))
      .map((c) => c?.text ?? "")
    if (textos.join("").trim()) return textos.join("")
  }
  if (typeof r.output_text === "string") return r.output_text
  if (r.response !== undefined) return r.response
  return ""
}

/**
 * Gerador com o Claude (pago). `client` é um `new Anthropic(...)` do SDK oficial.
 * Usa saída em JSON com esquema e, se o filtro de segurança recusar por engano, a API
 * tenta de novo em outro modelo.
 */
export function geradorClaude(client, { modelo = "claude-opus-5-5", esforco = "medium" } = {}) {
  return async ({ sistema, mensagem, esquema }) => {
    const r = await client.beta.messages.create({
      model: modelo,
      max_tokens: 16000,
      system: sistema,
      messages: [{ role: "user", content: mensagem }],
      output_config: { effort: esforco, format: { type: "json_schema", schema: esquema } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    })
    const uso = { entrada: r.usage?.input_tokens ?? 0, saida: r.usage?.output_tokens ?? 0 }
    if (r.stop_reason === "refusal" || r.stop_reason === "max_tokens") return { saida: null, uso, modelo, parada: r.stop_reason }
    const texto = r.content.find((b) => b.type === "text")?.text ?? ""
    return { saida: lerSaida(texto), uso, modelo }
  }
}
