"""Linha de comando.

    rag-equiverso indexar dados/wiki
    rag-equiverso perguntar "Quem é a Ayla?" --ate xdq-03
    rag-equiverso chat --ate xdq-05
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .busca import IndiceBM25
from .documentos import carregar_wiki
from .episodios import Episodio
from .gerador import Assistente

INDICE_PADRAO = Path("indice.json")


def _cliente():
    """Cria o cliente da Anthropic se houver credencial; senão, roda em modo sem IA."""
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        print("Aviso: ANTHROPIC_API_KEY não definida; rodando só com a busca (sem IA).\n", file=sys.stderr)
        return None
    import anthropic

    return anthropic.Anthropic()


def _carregar_indice(caminho: Path) -> IndiceBM25:
    if not caminho.exists():
        sys.exit(f"Índice {caminho} não existe. Rode primeiro: rag-equiverso indexar <pasta da wiki>")
    return IndiceBM25.carregar(caminho)


def _episodio(valor: str | None) -> Episodio | None:
    return Episodio.de_codigo(valor) if valor else None


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="rag-equiverso", description="Pergunte qualquer coisa sobre a Wiki do Equiverso.")
    p.add_argument("--indice", type=Path, default=INDICE_PADRAO)
    sub = p.add_subparsers(dest="comando", required=True)

    s = sub.add_parser("indexar", help="lê a wiki e monta o índice")
    s.add_argument("pasta", type=Path)

    for nome in ("perguntar", "chat"):
        s = sub.add_parser(nome)
        if nome == "perguntar":
            s.add_argument("pergunta")
        s.add_argument("--ate", help="último episódio assistido, ex.: xdq-05 (esconde spoilers)")
        s.add_argument("--esforco", default="medium", choices=["low", "medium", "high"])

    a = p.parse_args(argv)

    if a.comando == "indexar":
        trechos = carregar_wiki(a.pasta)
        IndiceBM25(trechos).salvar(a.indice)
        paginas = len({t.pagina for t in trechos})
        print(f"Índice salvo em {a.indice}: {len(trechos)} trechos de {paginas} páginas.")
        return

    assistente = Assistente(_carregar_indice(a.indice), _cliente(), esforco=a.esforco)
    ate = _episodio(a.ate)

    if a.comando == "perguntar":
        print(assistente.perguntar(a.pergunta, ate).formatar())
        return

    print("Chat da Wiki do Equiverso. Digite 'sair' para encerrar.")
    while True:
        try:
            pergunta = input("\nVocê: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if pergunta.lower() in {"sair", "exit", "quit"}:
            break
        if pergunta:
            print("\n" + assistente.perguntar(pergunta, ate).formatar())


if __name__ == "__main__":
    main()
