"""Busca BM25 implementada do zero, com filtro de spoiler.

BM25 é o algoritmo clássico de busca por palavras-chave (é a base de motores
como Elasticsearch). Ele dá nota alta a um trecho quando:
  * o trecho contém os termos da pergunta;
  * esses termos são raros na coleção (um termo que aparece em tudo vale pouco);
  * o trecho não é enorme (trechos longos são "penalizados" na medida certa).

Por que BM25 e não embeddings? A wiki é cheia de nomes próprios (Benício,
Atolados, Corporação Chico), e busca por palavra-chave acerta nomes muito bem,
sem precisar de outra API nem de GPU. A interface ``Buscador`` deixa trocar
por uma busca vetorial ou híbrida no futuro sem mexer no resto.
"""

from __future__ import annotations

import json
import math
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path

from .documentos import Trecho
from .episodios import Episodio
from .texto import tokenizar

PESO_TITULO = 3  # termos do título/apelidos contam como se aparecessem 3 vezes


@dataclass
class Resultado:
    trecho: Trecho
    nota: float
    cobertura: float = 1.0  # quanto da pergunta (pesado pela raridade dos termos) o trecho cobre


class IndiceBM25:
    def __init__(self, trechos: list[Trecho], k1: float = 1.5, b: float = 0.75):
        self.trechos = trechos
        self.k1, self.b = k1, b
        self._termos: list[Counter] = []
        for t in trechos:
            cabecalho = tokenizar(" ".join([t.titulo, *t.apelidos])) * PESO_TITULO
            self._termos.append(Counter(cabecalho + tokenizar(t.secao) + tokenizar(t.texto)))
        self._tamanhos = [sum(c.values()) for c in self._termos]
        self._media = sum(self._tamanhos) / max(len(self._tamanhos), 1)
        frequencia_doc: Counter = Counter()
        for contagem in self._termos:
            frequencia_doc.update(contagem.keys())
        n = len(trechos)
        # IDF com suavização (+1) para nunca ficar negativo.
        self._idf = {termo: math.log(1 + (n - df + 0.5) / (df + 0.5)) for termo, df in frequencia_doc.items()}

    def _nota(self, i: int, termos_pergunta: list[str]) -> float:
        contagem, tamanho = self._termos[i], self._tamanhos[i]
        nota = 0.0
        for termo in termos_pergunta:
            tf = contagem.get(termo, 0)
            if not tf:
                continue
            norma = self.k1 * (1 - self.b + self.b * tamanho / self._media)
            nota += self._idf[termo] * tf * (self.k1 + 1) / (tf + norma)
        return nota

    def buscar(
        self,
        pergunta: str,
        k: int = 6,
        assistiu_ate: Episodio | None = None,
        max_por_pagina: int = 2,
    ) -> list[Resultado]:
        """Devolve os ``k`` melhores trechos que o leitor já pode ver.

        ``max_por_pagina`` evita que uma única página ocupe todo o contexto:
        respostas melhores costumam juntar fontes diferentes.
        """
        termos = tokenizar(pergunta)
        if not termos:
            return []
        # Peso de cada termo = sua raridade (IDF). Termo que não existe na wiki
        # ("Copa", "2002") recebe o peso máximo: se ele faltar, a cobertura cai muito.
        n = len(self.trechos)
        idf_ausente = math.log(1 + (n + 0.5) / 0.5)
        pesos = {x: self._idf.get(x, idf_ausente) for x in set(termos)}
        total = sum(pesos.values())

        def cobertura(i: int) -> float:
            return sum(p for x, p in pesos.items() if x in self._termos[i]) / total

        candidatos = [
            Resultado(t, self._nota(i, termos), cobertura(i))
            for i, t in enumerate(self.trechos)
            if t.liberado_para(assistiu_ate)
        ]
        candidatos = sorted((c for c in candidatos if c.nota > 0), key=lambda r: r.nota, reverse=True)
        escolhidos, por_pagina = [], Counter()
        for r in candidatos:
            if por_pagina[r.trecho.pagina] >= max_por_pagina:
                continue
            escolhidos.append(r)
            por_pagina[r.trecho.pagina] += 1
            if len(escolhidos) == k:
                break
        return escolhidos

    # Persistência: o índice é refeito a partir dos trechos (é rápido), então só eles são salvos.
    def salvar(self, caminho: str | Path) -> None:
        dados = [asdict(t) for t in self.trechos]
        Path(caminho).write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")

    @classmethod
    def carregar(cls, caminho: str | Path) -> "IndiceBM25":
        dados = json.loads(Path(caminho).read_text(encoding="utf-8"))
        return cls([Trecho(**d) for d in dados])
