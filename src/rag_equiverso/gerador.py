"""Geração da resposta com o Claude, a partir dos trechos encontrados.

Fluxo (RAG = Retrieval-Augmented Generation, "geração aumentada por busca"):
  1. a busca acha os trechos relevantes da wiki;
  2. os trechos vão numerados para o modelo, junto com a pergunta;
  3. o modelo responde **só** com base neles e diz quais números usou;
  4. o programa confere se as fontes citadas existem antes de mostrar.

A saída vem em JSON validado por esquema (structured outputs), então o
programa nunca precisa "adivinhar" onde está a resposta no texto.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Protocol

from .busca import IndiceBM25, Resultado
from .episodios import Episodio

MODELO = "claude-opus-5-5"

INSTRUCOES = """Você é o assistente da Wiki do Equiverso, o universo de uma campanha de RPG.
Responda em português do Brasil, em tom de wiki, usando SOMENTE os trechos numerados enviados.
Cada afirmação da resposta precisa vir de algum trecho; liste em "fontes" os números usados.
Se os trechos não bastarem para responder, diga isso com honestidade, marque
"encontrou_resposta" como false e não complete com conhecimento de fora.
Os trechos já foram filtrados para não ter spoilers além do que o leitor assistiu:
nunca especule sobre o que acontece depois."""

ESQUEMA = {
    "type": "object",
    "properties": {
        "resposta": {"type": "string"},
        "fontes": {"type": "array", "items": {"type": "integer"}},
        "encontrou_resposta": {"type": "boolean"},
    },
    "required": ["resposta", "fontes", "encontrou_resposta"],
    "additionalProperties": False,
}


class ClienteMensagens(Protocol):
    """O pedaço do SDK da Anthropic que usamos (permite trocar por um falso nos testes)."""

    @property
    def beta(self): ...


@dataclass
class Resposta:
    texto: str
    fontes: list[Resultado] = field(default_factory=list)
    encontrou: bool = True
    modo: str = "claude"
    uso: dict = field(default_factory=dict)

    def formatar(self) -> str:
        linhas = [self.texto]
        if self.fontes:
            linhas.append("\nFontes:")
            for i, r in enumerate(self.fontes, 1):
                ep = f" (a partir de {r.trecho.visivel_desde})" if r.trecho.visivel_desde else ""
                linhas.append(f"  [{i}] {r.trecho.referencia()}{ep}")
        return "\n".join(linhas)


def montar_contexto(resultados: list[Resultado]) -> str:
    blocos = []
    for i, r in enumerate(resultados, 1):
        t = r.trecho
        blocos.append(f"<trecho numero=\"{i}\" pagina=\"{t.titulo}\" secao=\"{t.secao}\">\n{t.texto}\n</trecho>")
    return "\n\n".join(blocos)


class Assistente:
    def __init__(
        self,
        indice: IndiceBM25,
        cliente: ClienteMensagens | None = None,
        modelo: str = MODELO,
        esforco: str = "medium",
        k: int = 6,
        cobertura_minima: float = 0.4,
    ):
        self.indice = indice
        self.cliente = cliente
        self.modelo = modelo
        self.esforco = esforco
        self.k = k
        # Se nenhum trecho tem pelo menos metade dos termos da pergunta, a wiki
        # provavelmente não fala disso: responde "não sei" sem gastar uma chamada à API.
        self.cobertura_minima = cobertura_minima

    def perguntar(self, pergunta: str, assistiu_ate: Episodio | None = None) -> Resposta:
        resultados = self.indice.buscar(pergunta, k=self.k, assistiu_ate=assistiu_ate)
        if not resultados or max(r.cobertura for r in resultados) < self.cobertura_minima:
            return Resposta(
                "Não achei nada na wiki sobre isso (ou só há informação depois do episódio que você marcou).",
                encontrou=False,
                modo="busca",
            )
        if self.cliente is None:
            return self._modo_sem_ia(resultados)
        return self._gerar(pergunta, resultados)

    def _modo_sem_ia(self, resultados: list[Resultado]) -> Resposta:
        """Sem chave de API: mostra os trechos mais relevantes em vez de redigir uma resposta."""
        melhor = resultados[0].trecho.texto
        resumo = melhor if len(melhor) < 500 else melhor[:500].rsplit(" ", 1)[0] + "…"
        return Resposta(f"(modo sem IA: trecho mais relevante)\n{resumo}", resultados[:3], modo="busca")

    def _gerar(self, pergunta: str, resultados: list[Resultado]) -> Resposta:
        mensagem = f"{montar_contexto(resultados)}\n\nPergunta do leitor: {pergunta}"
        resposta = self.cliente.beta.messages.create(
            model=self.modelo,
            max_tokens=16000,
            system=INSTRUCOES,
            messages=[{"role": "user", "content": mensagem}],
            output_config={"effort": self.esforco, "format": {"type": "json_schema", "schema": ESQUEMA}},
            # Se o filtro de segurança recusar por engano, a API tenta de novo em outro modelo.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        uso = {
            "entrada": getattr(resposta.usage, "input_tokens", 0),
            "saida": getattr(resposta.usage, "output_tokens", 0),
        }
        if resposta.stop_reason == "refusal":
            return Resposta("O modelo não quis responder a esta pergunta.", encontrou=False, uso=uso)
        if resposta.stop_reason == "max_tokens":
            return Resposta("A resposta ficou longa demais e foi cortada. Tente uma pergunta mais específica.", encontrou=False, uso=uso)

        texto = next((b.text for b in resposta.content if b.type == "text"), "")
        try:
            dados = json.loads(texto)
        except json.JSONDecodeError:
            return Resposta("Não consegui entender a resposta do modelo.", encontrou=False, uso=uso)

        # Só aceita fontes que existem de verdade (o modelo poderia inventar um número).
        fontes = [resultados[n - 1] for n in dict.fromkeys(dados.get("fontes", [])) if 1 <= n <= len(resultados)]
        encontrou = bool(dados.get("encontrou_resposta")) and bool(fontes)
        return Resposta(dados.get("resposta", "").strip(), fontes, encontrou, uso=uso)
