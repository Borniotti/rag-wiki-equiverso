"""Normalização e tokenização de texto em português.

A busca precisa tratar "Benício", "benicio" e "BENÍCIO" como a mesma palavra,
e ignorar palavras muito comuns ("de", "que", "o") que não ajudam a achar
o trecho certo.
"""

from __future__ import annotations

import re
import unicodedata

# Lista curta e proposital: palavras tão frequentes que só atrapalham o ranking.
STOPWORDS = frozenset(
    """
    a o as os um uma uns umas de do da dos das no na nos nas em por para pra
    pelo pela pelos pelas com sem sob sobre entre ate e ou mas que se nao sim
    ja so mais menos muito muita muitos muitas ao aos a as isso isto esse essa
    esses essas este esta estes estas aquele aquela aqueles aquelas ele ela
    eles elas eu tu voce voces nos me te lhe seu sua seus suas meu minha meus
    minhas foi era ser sao esta estao tem tinha ter ha quando como onde quem
    qual quais porque pois tambem depois antes ainda la aqui ali entao
    """.split()
)

_LINK_WIKI = re.compile(r"\[\[([^\]|]+)(?:\\?\|([^\]]+))?\]\]")
_LINK_MD = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_TOKEN = re.compile(r"[a-z0-9]+")


def sem_acento(texto: str) -> str:
    """Remove acentos: 'Benício' -> 'Benicio'."""
    decomposto = unicodedata.normalize("NFKD", texto)
    return "".join(c for c in decomposto if not unicodedata.combining(c))


def limpar_markdown(texto: str) -> str:
    """Troca links por seus textos visíveis e tira marcações de Markdown."""
    texto = re.sub(r"```.*?(```|$)", " ", texto, flags=re.S)  # blocos de código (Mermaid etc.)
    texto = _LINK_WIKI.sub(lambda m: m.group(2) or m.group(1), texto)
    texto = _LINK_MD.sub(r"\1", texto)
    texto = re.sub(r"!\S+", " ", texto)  # imagens embutidas
    texto = re.sub(r"[*_`>#]+", " ", texto)
    return re.sub(r"\s+", " ", texto).strip()


def radical(palavra: str) -> str:
    """Stemmer bem simples para português: junta plurais e gêneros comuns.

    Não é um stemmer completo (como o RSLP), mas resolve os casos que mais
    aparecem nas perguntas: 'vampiros' ~ 'vampiro', 'investigadora' ~ 'investigador'.
    """
    if len(palavra) <= 4:
        return palavra
    for sufixo, troca in (("coes", "cao"), ("oes", "ao"), ("ais", "al"), ("eis", "el"), ("res", "r")):
        if palavra.endswith(sufixo):
            return palavra[: -len(sufixo)] + troca
    if palavra.endswith("s"):
        palavra = palavra[:-1]
    if palavra.endswith(("a", "o")) and len(palavra) > 4:
        palavra = palavra[:-1]
    return palavra


def tokenizar(texto: str) -> list[str]:
    """Texto -> lista de termos normalizados, sem stopwords."""
    base = sem_acento(limpar_markdown(texto)).lower()
    return [radical(t) for t in _TOKEN.findall(base) if t not in STOPWORDS]
