"""Leitura das páginas da wiki e divisão em trechos ("chunks").

Cada página Markdown tem um cabeçalho YAML (frontmatter) com título, apelidos
e o episódio de primeira aparição. O corpo é dividido pelas seções (## e ###)
e, se uma seção for longa demais, em janelas de parágrafos.

Cada trecho guarda o episódio mais avançado que ele cita. É isso que permite
esconder spoilers: quem só assistiu até XdQ 3 não recebe trechos que citam XdQ 10.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from .episodios import Episodio, citacoes_em
from .texto import limpar_markdown

TAMANHO_MAXIMO = 1400  # caracteres por trecho; cabe folgado no contexto e mantém o foco
_FRONTMATTER = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
_TITULO_SECAO = re.compile(r"^(#{2,3})\s+(.*)$", re.MULTILINE)
_MARCA_FICHA = re.compile(r"\{((?:eq|sa|xdq)-\d{2}(?:-\d)?)\}")
SECOES_IGNORADAS = {"navegação", "momentos marcantes"}  # só links e minutagens


@dataclass
class Trecho:
    id: str
    pagina: str
    titulo: str
    secao: str
    texto: str
    tipo: str
    episodio: str | None  # a partir de qual episódio este trecho deixa de ser spoiler
    apelidos: list[str] = field(default_factory=list)

    @property
    def visivel_desde(self) -> Episodio | None:
        return Episodio.de_codigo(self.episodio) if self.episodio else None

    def liberado_para(self, assistiu_ate: Episodio | None) -> bool:
        """True se quem assistiu até ``assistiu_ate`` pode ler este trecho."""
        if assistiu_ate is None or self.visivel_desde is None:
            return True
        return self.visivel_desde <= assistiu_ate

    def referencia(self) -> str:
        return f"{self.titulo} › {self.secao}" if self.secao else self.titulo


def ler_frontmatter(conteudo: str) -> tuple[dict, str]:
    m = _FRONTMATTER.match(conteudo)
    if not m:
        return {}, conteudo
    dados = yaml.safe_load(m.group(1)) or {}
    return dados, conteudo[m.end():]


def _max_episodio(*grupos) -> Episodio | None:
    todos = [ep for grupo in grupos for ep in grupo if ep is not None]
    return max(todos) if todos else None


def _episodio_base(meta: dict) -> Episodio | None:
    for campo in ("primeira_aparicao",):
        valor = meta.get(campo)
        if isinstance(valor, str):
            try:
                return Episodio.de_codigo(valor)
            except ValueError:
                pass
    return None


def _janelas(texto: str, limite: int = TAMANHO_MAXIMO) -> list[str]:
    """Divide um texto longo em blocos de parágrafos inteiros."""
    blocos, atual = [], ""
    for paragrafo in (p.strip() for p in texto.split("\n\n")):
        if not paragrafo:
            continue
        if atual and len(atual) + len(paragrafo) > limite:
            blocos.append(atual)
            atual = ""
        atual = f"{atual}\n\n{paragrafo}".strip()
    if atual:
        blocos.append(atual)
    return blocos


def _trechos_da_ficha(meta: dict, base: Episodio | None) -> list[tuple[str, str, Episodio | None]]:
    """Achata a ficha lateral do personagem, agrupando as linhas por episódio de revelação."""
    ficha = meta.get("ficha")
    if not isinstance(ficha, dict):
        return []
    saida = []
    for secao, campos in ficha.items():
        por_episodio: dict[Episodio | None, list[str]] = defaultdict(list)
        for campo, valor in (campos or {}).items():
            valores = valor if isinstance(valor, list) else [valor]
            for v in valores:
                texto = str(v)
                marca = _MARCA_FICHA.search(texto)
                ep = Episodio.de_codigo(marca.group(1)) if marca else base
                ep = _max_episodio([ep, base], citacoes_em(texto))
                por_episodio[ep].append(f"{campo}: {_MARCA_FICHA.sub('', texto).strip()}")
        for ep, linhas in por_episodio.items():
            saida.append((f"Ficha: {secao}", "\n".join(linhas), ep))
    return saida


def ler_pagina(caminho: Path, raiz: Path) -> list[Trecho]:
    meta, corpo = ler_frontmatter(caminho.read_text(encoding="utf-8"))
    slug = caminho.stem
    if slug == "index":
        return []
    titulo = str(meta.get("title", slug))
    tipo = str(meta.get("tipo", "pagina"))
    apelidos = [str(a) for a in meta.get("aliases") or []]
    base = _episodio_base(meta)

    # Partes da página: (seção, texto). O texto antes do primeiro título é o resumo.
    partes: list[tuple[str, str]] = []
    marcas = list(_TITULO_SECAO.finditer(corpo))
    inicio = corpo[: marcas[0].start()] if marcas else corpo
    partes.append(("Resumo", inicio))
    secao_pai = ""
    for i, m in enumerate(marcas):
        fim = marcas[i + 1].start() if i + 1 < len(marcas) else len(corpo)
        nome = re.sub(r"\s*\(contém spoilers[^)]*\)", "", m.group(2)).strip()
        if m.group(1) == "##":
            secao_pai = nome
            rotulo = nome
        else:
            rotulo = f"{secao_pai} › {nome}" if secao_pai else nome
        partes.append((rotulo, corpo[m.end():fim]))

    trechos: list[Trecho] = []

    def adicionar(secao: str, texto_md: str, episodio: Episodio | None, minimo: int = 40) -> None:
        texto = limpar_markdown(texto_md)
        if len(texto) < minimo:  # descarta restos sem conteúdo (legendas, linhas soltas)
            return
        trechos.append(
            Trecho(
                id=f"{slug}#{len(trechos)}",
                pagina=slug,
                titulo=titulo,
                secao=secao,
                texto=texto,
                tipo=tipo,
                episodio=episodio.codigo if episodio else None,
                apelidos=apelidos,
            )
        )

    for secao, texto_md in partes:
        if secao.split(" › ")[0].lower() in SECOES_IGNORADAS:
            continue
        for janela in _janelas(texto_md):
            adicionar(secao, janela, _max_episodio([base], citacoes_em(janela)))

    for secao, texto, ep in _trechos_da_ficha(meta, base):
        adicionar(secao, texto, ep, minimo=1)

    return trechos


def carregar_wiki(raiz: str | Path) -> list[Trecho]:
    raiz = Path(raiz)
    if not raiz.is_dir():
        raise FileNotFoundError(f"pasta da wiki não encontrada: {raiz}")
    trechos: list[Trecho] = []
    for caminho in sorted(raiz.rglob("*.md")):
        trechos.extend(ler_pagina(caminho, raiz))
    return trechos
