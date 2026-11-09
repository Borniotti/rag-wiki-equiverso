// Testes do motor em JavaScript (node --test). Mesmas garantias dos testes em Python:
// texto, ordem dos episódios, divisão das páginas, filtro de spoiler, "não sei" para
// perguntas fora do assunto e conferência das fontes, com geradores falsos (não gastam nada).

import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  tokenizar,
  dividirPagina,
  separarFrontmatter,
  IndiceBM25,
  coberturaSuficiente,
  conferirSaida,
  respostaExtrativa,
  lerSaida,
  responder,
  geradorWorkersAI,
  estimarNeuronios,
  NAO_ACHEI,
  conferirEntendimento,
} from "../src/index.js"
import * as episodios from "../src/episodios.js"

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const WIKI = path.join(AQUI, "..", "..", "dados", "wiki")

// Lê as páginas de exemplo da pasta dados/wiki (só os campos simples do frontmatter).
function carregarWiki() {
  const trechos = []
  const andar = (pasta) => {
    for (const nome of fs.readdirSync(pasta)) {
      const caminho = path.join(pasta, nome)
      if (fs.statSync(caminho).isDirectory()) andar(caminho)
      else if (nome.endsWith(".md") && nome !== "index.md") {
        const [fm, corpo] = separarFrontmatter(fs.readFileSync(caminho, "utf-8"))
        const campo = (k) => fm.match(new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, "m"))?.[1]
        const apelidos = (campo("aliases") ?? "").replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean)
        const slug = nome.replace(/\.md$/, "")
        const base = episodios.ehCodigo(slug) ? slug : campo("primeira_aparicao")
        trechos.push(
          ...dividirPagina(
            { slug, titulo: campo("title") ?? slug, apelidos, corpo },
            { nivelBase: base, nivel: episodios, secoesIgnoradas: ["navegação", "momentos marcantes"] },
          ),
        )
      }
    }
  }
  andar(WIKI)
  return trechos
}

// ---------- texto ----------

test("tokenizar ignora acento, maiúscula e palavras vazias", () => {
  assert.deepEqual(tokenizar("O BENÍCIO e a Nina"), tokenizar("benicio nina"))
})

test("tokenizar junta plural e singular", () => {
  assert.deepEqual(tokenizar("vampiros"), tokenizar("vampiro"))
})

test("tokenizar usa o texto visível dos links", () => {
  assert.ok(tokenizar("[[ayla|Ayla]] chegou").includes("ayla"))
})

// ---------- episódios ----------

test("ordem entre temporadas e vídeo extra entre episódios", () => {
  const p = episodios.posicao
  assert.ok(p("eq-07") < p("sa-01") && p("sa-01") < p("xdq-01"))
  assert.ok(p("xdq-09") < p("xdq-09-5") && p("xdq-09-5") < p("xdq-10"))
  assert.equal(episodios.rotulo("xdq-09-5"), "XdQ 9,5")
  assert.throws(() => p("xdq-3"))
})

test("citações num texto, sem repetir e em ordem", () => {
  const texto = "Foi revelado ([[xdq-12|XdQ 12]]) e lembrado ([[eq-05|Eq 5]]) ([[xdq-12|XdQ 12]])."
  assert.deepEqual(episodios.citacoes(texto), ["eq-05", "xdq-12"])
})

// ---------- divisão das páginas ----------

const PAGINA = {
  slug: "fulana",
  titulo: "Fulana",
  apelidos: ["Fulaninha"],
  corpo: `**Fulana** é uma moradora de Atolados ([[xdq-02|XdQ 2]]), conhecida de todos na cidade.

## Detalhes (contém spoilers até X da Questão, ep. 9)

### O segredo

Fulana escondia um mapa do covil, que só foi descoberto muito depois ([[xdq-09|XdQ 9]]).

## Navegação

- Anterior: [[xdq-01|XdQ 1]]
`,
  ficha: { Identidade: { Nome: "Fulana", Segredo: "Tem um mapa {xdq-09}" } },
}

test("divide por seção, marca o nível e ignora a navegação", () => {
  const trechos = dividirPagina(PAGINA, { nivelBase: "xdq-02", nivel: episodios, secoesIgnoradas: ["navegação"] })
  const resumo = trechos.find((t) => t.s === "Resumo")
  const segredo = trechos.find((t) => t.s === "Detalhes › O segredo")
  assert.equal(resumo.e, "xdq-02")
  assert.equal(segredo.e, "xdq-09")
  assert.ok(!trechos.some((t) => t.s.startsWith("Navegação")))
  assert.deepEqual(resumo.a, ["Fulaninha"])
})

test("a ficha vira trechos separados por episódio de revelação", () => {
  const trechos = dividirPagina(PAGINA, { nivelBase: "xdq-02", nivel: episodios }).filter((t) => t.s.startsWith("Ficha"))
  assert.deepEqual(trechos.map((t) => t.e).sort(), ["xdq-02", "xdq-09"])
  assert.ok(trechos.find((t) => t.e === "xdq-09").x.includes("Tem um mapa"))
  assert.ok(!trechos.find((t) => t.e === "xdq-09").x.includes("{"))
})

test("sem regra de nível, nada é escondido", () => {
  assert.ok(dividirPagina(PAGINA).every((t) => t.e === null))
})

// ---------- busca e filtro de spoiler ----------

const trechosWiki = carregarWiki()
const indice = new IndiceBM25(trechosWiki, { lerPergunta: episodios.lerPergunta, termosExtras: episodios.termosExtras })

test("a busca acha o mosquito gigante", () => {
  const r = indice.buscar("Quem matou o mosquito gigante?")
  assert.ok(r.length > 0)
  assert.ok(r.slice(0, 3).some((x) => /mosquito/i.test(x.trecho.t + x.trecho.x)))
})

test("ninguém recebe trecho de episódio futuro", () => {
  for (const ate of ["xdq-01", "xdq-02", "xdq-03"]) {
    const liberado = episodios.liberadoAte(ate)
    for (const pergunta of ["Quem é a Ayla?", "O que é o Canal 666?", "Quem é Osvaldo?"]) {
      for (const r of indice.buscar(pergunta, { liberado, k: 10 })) {
        assert.ok(!r.trecho.e || episodios.posicao(r.trecho.e) <= episodios.posicao(ate), `${r.trecho.e} > ${ate}`)
      }
    }
  }
})

test("no máximo 2 trechos por página", () => {
  const contagem = {}
  for (const r of indice.buscar("Lucas Benício Nina Ayla", { k: 10 })) contagem[r.trecho.p] = (contagem[r.trecho.p] ?? 0) + 1
  assert.ok(Object.values(contagem).every((n) => n <= 2))
})

test("pergunta fora do assunto tem cobertura baixa", () => {
  assert.equal(coberturaSuficiente(indice.buscar("Quem ganhou a Copa de 2002?")), false)
  assert.equal(coberturaSuficiente(indice.buscar("Quem matou o mosquito gigante?")), true)
})

// ---------- resposta ----------

const T = [
  { p: "a", t: "A", s: "Resumo", x: "Nina cortou a probóscide do mosquito com um punhal.", e: "xdq-01" },
  { p: "b", t: "B", s: "Resumo", x: "Lucas feriu o mosquito com um canivete.", e: "xdq-01" },
]

test("descarta fontes inventadas e não aceita resposta sem fonte", () => {
  assert.deepEqual(conferirSaida({ resposta: "Nina.", fontes: [1, 99, 1], encontrou_resposta: true }, T).fontes, [T[0]])
  assert.equal(conferirSaida({ resposta: "Nina.", fontes: [99], encontrou_resposta: true }, T).encontrou, false)
  assert.equal(conferirSaida({ fontes: [1] }, T), null)
})

test("lê JSON pronto, em texto ou com sobra em volta", () => {
  assert.equal(lerSaida({ resposta: "x" }).resposta, "x")
  assert.equal(lerSaida('{"resposta":"x"}').resposta, "x")
  assert.equal(lerSaida('Claro! {"resposta":"x"} Espero ter ajudado').resposta, "x")
  assert.equal(lerSaida("sem json"), null)
})

test("a resposta sem IA usa frases dos próprios trechos", () => {
  const r = respostaExtrativa("Quem matou o mosquito?", T)
  assert.ok(r.encontrou && r.resposta.includes("probóscide"))
  assert.ok(r.fontes.includes(T[0]))
})

// ---------- de ponta a ponta, com geradores falsos ----------

test("responder: fora do assunto não chama a IA", async () => {
  let chamadas = 0
  const r = await responder(indice, "Quem ganhou a Copa de 2002?", { gerador: async () => (chamadas++, {}) })
  assert.equal(r.resposta, NAO_ACHEI)
  assert.equal(chamadas, 0)
})

test("responder: usa a IA e confere as fontes", async () => {
  const gerador = async ({ mensagem, esquema }) => {
    assert.ok(mensagem.includes("<trecho numero=\"1\"") && mensagem.includes("<pergunta>"))
    assert.deepEqual(esquema.required, ["resposta", "fontes", "encontrou_resposta"])
    return { saida: { resposta: "Foi a Nina.", fontes: [1, 42], encontrou_resposta: true }, uso: { entrada: 10, saida: 5 } }
  }
  const r = await responder(indice, "Quem matou o mosquito gigante?", { gerador, liberado: episodios.liberadoAte("xdq-01") })
  assert.equal(r.modo, "ia")
  assert.equal(r.fontes.length, 1)
})

test("responder: se a IA falhar, responde com os trechos", async () => {
  const gerador = async () => {
    throw new Error("cota acabou")
  }
  const r = await responder(indice, "Quem matou o mosquito gigante?", { gerador })
  assert.equal(r.modo, "trechos")
  assert.ok(r.resposta.length > 0)
})

test("geradorWorkersAI: monta o pedido e lê os dois formatos de resposta", async () => {
  const pedidos = []
  const ai = {
    run: async (modelo, pedido) => {
      pedidos.push({ modelo, pedido })
      return modelo.includes("gpt-oss")
        ? { choices: [{ message: { content: '{"resposta":"ok","fontes":[1],"encontrou_resposta":true}' } }], usage: { prompt_tokens: 3000, completion_tokens: 500 } }
        : { response: { resposta: "ok", fontes: [1], encontrou_resposta: true }, usage: { prompt_tokens: 3000, completion_tokens: 300 } }
    },
  }
  const a = await geradorWorkersAI(ai)({ sistema: "s", mensagem: "m", esquema: { type: "object" } })
  assert.equal(a.saida.resposta, "ok")
  assert.equal(pedidos[0].pedido.response_format.json_schema.name, "resposta")
  assert.equal(pedidos[0].pedido.reasoning_effort, "low")
  const b = await geradorWorkersAI(ai, { modelo: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" })({ sistema: "s", mensagem: "m", esquema: { type: "object" } })
  assert.equal(b.saida.resposta, "ok")
  assert.equal(pedidos[1].pedido.reasoning_effort, undefined)
  assert.ok(estimarNeuronios("@cf/openai/gpt-oss-120b", a.uso) > 100)
})

test("blocos de código (árvores em Mermaid) não entram no texto", () => {
  const t = tokenizar("Família\n```mermaid\nflowchart TD\nwalter --> wilma\n```\nfim")
  assert.ok(!t.includes("flowchart") && t.includes("fim"))
})

test("tokenizar junta conjugações", () => {
  assert.deepEqual(tokenizar("falou"), tokenizar("falando"))
  assert.deepEqual(tokenizar("falou"), tokenizar("falar"))
})

test("episódio citado na pergunta", () => {
  assert.deepEqual(episodios.lerPergunta("o que houve no ep 3 de X da Questão?").termos, ["@xdq-03"])
  assert.deepEqual(episodios.lerPergunta("XdQ 9,5").termos, ["@xdq-09-5"])
  assert.deepEqual(episodios.lerPergunta("episódio 5 do Equinócio").termos, ["@eq-05"])
  assert.deepEqual(episodios.lerPergunta("Quem é a Ayla?").termos, [])
})

test("pergunta com episódio acha a página dele", () => {
  const r = indice.buscar("o que aconteceu no ep 2 de x da questao", { k: 3 })
  assert.ok(r.some((x) => x.trecho.p.endsWith("xdq-02")))
  assert.ok(coberturaSuficiente(r))
})

// ---------- a IA interpreta a pergunta antes da busca ----------

test("entender: a pergunta torta acha os trechos certos", async () => {
  const pedidos = []
  const entendedor = async ({ mensagem, esquema }) => {
    pedidos.push(mensagem)
    assert.deepEqual(esquema.required, ["busca", "episodios", "sobre_o_assunto"])
    return { saida: { busca: "mosquito gigante matou criatura", episodios: ["xdq-01", "xdq-99", "lixo"], sobre_o_assunto: true } }
  }
  const gerador = async ({ mensagem }) => {
    assert.ok(/mosquito/i.test(mensagem))
    return { saida: { resposta: "Foi a Nina.", fontes: [1], encontrou_resposta: true } }
  }
  const r = await responder(indice, "qm detonou aquele bixo q chupava sangue?", {
    gerador,
    entendedor,
    contexto: { nomes: ["Nina", "Mosquito gigante"], episodios: [["xdq-01", "Vampiro"]], valido: (c) => c === "xdq-01" },
  })
  assert.equal(r.modo, "ia")
  assert.ok(pedidos[0].includes("<nomes>Nina; Mosquito gigante</nomes>") && pedidos[0].includes("<pergunta>"))
})

test("entender: fora do assunto não chama o gerador da resposta", async () => {
  let chamadas = 0
  const r = await responder(indice, "receita de bolo", {
    gerador: async () => (chamadas++, {}),
    entendedor: async () => ({ saida: { busca: "bolo receita", episodios: [], sobre_o_assunto: false } }),
  })
  assert.equal(r.resposta, NAO_ACHEI)
  assert.equal(chamadas, 0)
})

test("entender: se a IA falhar, a busca segue sozinha", async () => {
  const r = await responder(indice, "Quem matou o mosquito gigante?", {
    entendedor: async () => {
      throw new Error("fora do ar")
    },
  })
  assert.equal(r.modo, "trechos")
})

test("conferirEntendimento descarta lixo", () => {
  assert.equal(conferirEntendimento(null), null)
  assert.equal(conferirEntendimento({ episodios: [] }), null)
  const e = conferirEntendimento({ busca: "<script>Ayla", episodios: ["XDQ-02 ", 3], sobre_o_assunto: true }, { valido: (c) => c === "xdq-02" })
  assert.deepEqual(e, { busca: "script Ayla", episodios: ["xdq-02"], sobre: true })
})

test("textoDaResposta lê os formatos da Workers AI", async () => {
  const { textoDaResposta } = await import("../src/geradores.js")
  assert.equal(textoDaResposta({ choices: [{ message: { content: "a" } }] }), "a")
  assert.equal(textoDaResposta({ choices: [{ message: { content: [{ type: "text", text: "b" }] } }] }), "b")
  assert.equal(textoDaResposta({ output: [{ type: "reasoning", content: [{ text: "x" }] }, { type: "message", content: [{ type: "output_text", text: "c" }] }] }), "c")
  assert.deepEqual(textoDaResposta({ response: { resposta: "d" } }), { resposta: "d" })
})

test("geradorWorkersAI tenta de novo sem esquema se o modelo recusar o formato", async () => {
  const pedidos = []
  const ai = {
    run: async (modelo, pedido) => {
      pedidos.push(pedido)
      if (pedido.response_format) throw new Error("response_format not supported")
      return { choices: [{ message: { content: 'Aqui: {"resposta":"ok","fontes":[1],"encontrou_resposta":true}' } }] }
    },
  }
  const r = await geradorWorkersAI(ai)({ sistema: "s", mensagem: "m", esquema: {} })
  assert.equal(r.saida.resposta, "ok")
  assert.equal(pedidos.length, 2)
})

test("pergunta sem número de episódio ainda acha o assunto", () => {
  const r = indice.buscar("que episodio o Benício fala com a mãe dele? eu nao lembro")
  assert.ok(r.length > 0)
})
