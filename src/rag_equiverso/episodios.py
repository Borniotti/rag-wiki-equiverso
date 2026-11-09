"""Ordem cronológica dos episódios do Equiverso.

As três temporadas acontecem em sequência: Equinócio (eq) -> Só Assim (sa)
-> X da Questão (xdq). Um código como ``xdq-09-5`` é um vídeo extra entre
os episódios 9 e 10. Com isso dá para responder "este trecho é spoiler
para quem parou no episódio X?".
"""

from __future__ import annotations

import re
from functools import total_ordering

ORDEM_TEMPORADAS = {"eq": 0, "sa": 1, "xdq": 2}
NOMES = {"eq": "Eq", "sa": "SA", "xdq": "XdQ"}
_CODIGO = re.compile(r"\b(eq|sa|xdq)-(\d{2})(?:-(\d))?\b")


@total_ordering
class Episodio:
    __slots__ = ("temporada", "numero")

    def __init__(self, temporada: str, numero: float):
        if temporada not in ORDEM_TEMPORADAS:
            raise ValueError(f"temporada desconhecida: {temporada!r}")
        self.temporada = temporada
        self.numero = float(numero)

    @classmethod
    def de_codigo(cls, codigo: str) -> "Episodio":
        m = _CODIGO.fullmatch(codigo.strip().lower())
        if not m:
            raise ValueError(f"código de episódio inválido: {codigo!r} (ex.: xdq-03, eq-07-5)")
        temporada, inteiro, decimal = m.groups()
        return cls(temporada, float(f"{int(inteiro)}.{decimal or 0}"))

    @property
    def chave(self) -> tuple[int, float]:
        return (ORDEM_TEMPORADAS[self.temporada], self.numero)

    @property
    def codigo(self) -> str:
        inteiro, decimal = divmod(round(self.numero * 10), 10)
        base = f"{self.temporada}-{inteiro:02d}"
        return f"{base}-{decimal}" if decimal else base

    def __eq__(self, outro: object) -> bool:
        return isinstance(outro, Episodio) and self.chave == outro.chave

    def __lt__(self, outro: "Episodio") -> bool:
        return self.chave < outro.chave

    def __hash__(self) -> int:
        return hash(self.chave)

    def __repr__(self) -> str:
        return f"Episodio({self.codigo!r})"

    def __str__(self) -> str:
        numero = f"{self.numero:g}".replace(".", ",")
        return f"{NOMES[self.temporada]} {numero}"


def citacoes_em(texto: str) -> list[Episodio]:
    """Acha todos os episódios citados num trecho (ex.: '([[xdq-03|XdQ 3]])')."""
    vistos: dict[tuple, Episodio] = {}
    for m in _CODIGO.finditer(texto.lower()):
        ep = Episodio.de_codigo(m.group(0))
        vistos[ep.chave] = ep
    return sorted(vistos.values())


# ---------- episódios citados na pergunta ----------
# "o que aconteceu no ep 38 de X da Questão?", "XdQ 38", "episódio 5 do Equinócio":
# a pergunta vira o termo especial "@xdq-38", que casa com os trechos que citam o
# episódio e, com mais peso, com a página do próprio episódio. Mesma regra do
# lerPergunta/termosExtras do motor em JavaScript (js/src/episodios.js).

_TEMPORADA = r"(xdq|x\s*d[ae]\s*questao|eq|equinocio|sa|so\s*assim)"
_NUMERO = r"(\d{1,2})(?:[.,](\d))?"
_EP = r"(?:ep(?:isodio)?s?\.?|capitulo)"
_NUM = r"(?:n[.ºo°]?\s*)?"
_PADROES = [
    re.compile(rf"\b{_TEMPORADA}\s*[,:-]?\s*(?:{_EP}\s*)?{_NUM}{_NUMERO}\b"),
    re.compile(rf"\b{_EP}\s*{_NUM}{_NUMERO}\s*(?:d[aeo]s?\s+)?(?:temporada\s+)?{_TEMPORADA}\b"),
]
_SO_NUMERO = re.compile(rf"\b{_EP}\s*{_NUM}{_NUMERO}\b")


def _prefixo(nome: str) -> str:
    return "xdq" if nome.startswith("x") else "eq" if nome.startswith("e") else "sa"


def _montar(prefixo: str, n: str, d: str | None) -> str:
    return f"{prefixo}-{int(n):02d}" + (f"-{d}" if d else "")


def ler_pergunta(pergunta: str) -> tuple[str, list[str]]:
    """Tira da pergunta as menções a episódios e devolve (texto, termos "@código")."""
    from .texto import sem_acento

    texto = sem_acento(pergunta).lower()
    termos: list[str] = []

    def trocar(m: re.Match) -> str:
        temporada, n, d = (m.group(3), m.group(1), m.group(2)) if m.group(1)[0].isdigit() else m.groups()
        termos.append("@" + _montar(_prefixo(re.sub(r"\s+", "", temporada)), n, d))
        return " "

    for padrao in _PADROES:
        texto = padrao.sub(trocar, texto)

    def so_numero(m: re.Match) -> str:
        termos.extend("@" + _montar(p, m.group(1), m.group(2)) for p in ORDEM_TEMPORADAS)
        return " "

    texto = _SO_NUMERO.sub(so_numero, texto)
    return texto, list(dict.fromkeys(termos))


def termos_extras(secao: str, texto: str, pagina: str, peso_titulo: int = 3) -> list[str]:
    """Um "@código" por episódio citado e, na página do próprio episódio, o código com peso de título."""
    termos = ["@" + ep.codigo for ep in citacoes_em(f"{secao} {texto}")]
    fim = pagina.rstrip("/").split("/")[-1]
    if _CODIGO.fullmatch(fim.lower()):
        termos += ["@" + fim.lower()] * peso_titulo
    return termos
