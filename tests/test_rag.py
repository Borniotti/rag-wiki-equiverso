import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from rag_equiverso import Assistente, Episodio, IndiceBM25, carregar_wiki
from rag_equiverso.documentos import ler_pagina
from rag_equiverso.episodios import citacoes_em
from rag_equiverso.texto import tokenizar

WIKI = Path(__file__).parent.parent / "dados" / "wiki"


# ---------- texto ----------

def test_tokenizar_ignora_acento_maiuscula_e_stopwords():
    assert tokenizar("O BENÍCIO e a Nina") == tokenizar("benicio nina")


def test_tokenizar_junta_plural_e_singular():
    assert tokenizar("vampiros") == tokenizar("vampiro")


def test_tokenizar_usa_texto_visivel_dos_links():
    assert "ayla" in tokenizar("[[ayla|Ayla]] chegou")


# ---------- episódios ----------

def test_ordem_entre_temporadas():
    assert Episodio.de_codigo("eq-07") < Episodio.de_codigo("sa-01") < Episodio.de_codigo("xdq-01")


def test_video_extra_fica_entre_os_episodios():
    assert Episodio.de_codigo("xdq-09") < Episodio.de_codigo("xdq-09-5") < Episodio.de_codigo("xdq-10")
    assert Episodio.de_codigo("xdq-09-5").codigo == "xdq-09-5"
    assert str(Episodio.de_codigo("xdq-09-5")) == "XdQ 9,5"


def test_codigo_invalido():
    with pytest.raises(ValueError):
        Episodio.de_codigo("xdq-3")


def test_citacoes_em_texto():
    texto = "Foi revelado ([[xdq-12|XdQ 12]]) e lembrado ([[eq-05|Eq 5]]) ([[xdq-12|XdQ 12]])."
    assert [e.codigo for e in citacoes_em(texto)] == ["eq-05", "xdq-12"]


# ---------- documentos ----------

PAGINA = """---
title: Fulana
tipo: npc
aliases: [Fulaninha]
primeira_aparicao: xdq-02
ficha:
  Identidade:
    Nome: "Fulana"
    Segredo: "É uma vampira {xdq-09}"
---

Fulana é a dona da cantina, conhecida por todos na cidade.

## Detalhes (contém spoilers até X da Questão, ep. 9)

Ela ajudou o grupo a fugir pelos fundos da cantina ([[xdq-04|XdQ 4]]).

Mais tarde, revelou ser uma vampira centenária ([[xdq-09|XdQ 9]]).

## Navegação

- Anterior: nada
"""


def _pagina(tmp_path):
    caminho = tmp_path / "fulana.md"
    caminho.write_text(PAGINA, encoding="utf-8")
    return ler_pagina(caminho, tmp_path)


def test_pagina_vira_trechos_com_episodio(tmp_path):
    trechos = _pagina(tmp_path)
    por_secao = {t.secao: t for t in trechos}
    assert por_secao["Resumo"].episodio == "xdq-02"
    assert por_secao["Detalhes"].episodio == "xdq-09"  # o parágrafo mais avançado manda
    assert not any("Navegação" in t.secao for t in trechos)
    assert trechos[0].apelidos == ["Fulaninha"]


def test_ficha_separa_linhas_por_episodio(tmp_path):
    fichas = [t for t in _pagina(tmp_path) if t.secao.startswith("Ficha")]
    assert {t.episodio for t in fichas} == {"xdq-02", "xdq-09"}
    segredo = next(t for t in fichas if t.episodio == "xdq-09")
    assert "{xdq-09}" not in segredo.texto


def test_filtro_de_spoiler(tmp_path):
    indice = IndiceBM25(_pagina(tmp_path))
    ate_3 = indice.buscar("vampira", assistiu_ate=Episodio.de_codigo("xdq-03"))
    ate_9 = indice.buscar("vampira", assistiu_ate=Episodio.de_codigo("xdq-09"))
    assert not any("vampira" in r.trecho.texto for r in ate_3)
    assert any("vampira" in r.trecho.texto for r in ate_9)


# ---------- busca na wiki de exemplo ----------

@pytest.fixture(scope="module")
def indice():
    return IndiceBM25(carregar_wiki(WIKI))


def test_busca_acha_a_pagina_certa(indice):
    melhor = indice.buscar("mosquito gigante da piscina", k=1)[0]
    assert melhor.trecho.pagina == "mosquito-gigante"


def test_busca_respeita_limite_por_pagina(indice):
    resultados = indice.buscar("Ayla", k=10, max_por_pagina=2)
    paginas = [r.trecho.pagina for r in resultados]
    assert all(paginas.count(p) <= 2 for p in paginas)


def test_ninguem_ve_trecho_futuro(indice):
    limite = Episodio.de_codigo("xdq-01")
    for r in indice.buscar("Ayla Benício Nina Lucas caso", k=30, assistiu_ate=limite, max_por_pagina=30):
        assert r.trecho.visivel_desde is None or r.trecho.visivel_desde <= limite


def test_salvar_e_carregar(indice, tmp_path):
    caminho = tmp_path / "indice.json"
    indice.salvar(caminho)
    copia = IndiceBM25.carregar(caminho)
    assert len(copia.trechos) == len(indice.trechos)
    assert copia.buscar("Atolados", k=1)[0].trecho.id == indice.buscar("Atolados", k=1)[0].trecho.id


# ---------- geração (com um cliente falso, sem gastar API) ----------

class ClienteFalso:
    """Imita client.beta.messages.create e guarda o que recebeu."""

    def __init__(self, conteudo: dict | None = None, stop_reason: str = "end_turn"):
        self.chamadas = []
        texto = json.dumps(conteudo or {})
        self._resposta = SimpleNamespace(
            stop_reason=stop_reason,
            content=[SimpleNamespace(type="text", text=texto)],
            usage=SimpleNamespace(input_tokens=100, output_tokens=20),
        )
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.chamadas.append(kwargs)
        return self._resposta


def test_resposta_usa_so_fontes_validas(indice):
    cliente = ClienteFalso({"resposta": "Foi a Nina.", "fontes": [1, 1, 99], "encontrou_resposta": True})
    resposta = Assistente(indice, cliente).perguntar("Quem matou o mosquito gigante?")
    assert resposta.texto == "Foi a Nina."
    assert len(resposta.fontes) == 1  # o 1 repetido conta uma vez e o 99 não existe
    assert resposta.encontrou


def test_pedido_enviado_ao_claude(indice):
    cliente = ClienteFalso({"resposta": "x", "fontes": [1], "encontrou_resposta": True})
    Assistente(indice, cliente).perguntar("Quem é a Ayla?")
    pedido = cliente.chamadas[0]
    assert pedido["model"] == "claude-opus-5-5"
    assert pedido["output_config"]["format"]["type"] == "json_schema"
    assert pedido["fallbacks"] == "default"
    assert "<trecho numero=\"1\"" in pedido["messages"][0]["content"]


def test_recusa_do_modelo(indice):
    cliente = ClienteFalso(stop_reason="refusal")
    resposta = Assistente(indice, cliente).perguntar("Quem é a Ayla?")
    assert not resposta.encontrou


def test_sem_fontes_nao_conta_como_encontrada(indice):
    cliente = ClienteFalso({"resposta": "Acho que sim.", "fontes": [], "encontrou_resposta": True})
    assert not Assistente(indice, cliente).perguntar("Quem é a Ayla?").encontrou


def test_modo_sem_ia(indice):
    resposta = Assistente(indice, cliente=None).perguntar("Atolados")
    assert resposta.modo == "busca" and resposta.fontes


def test_pergunta_sem_resultado_nao_chama_api(indice):
    cliente = ClienteFalso()
    resposta = Assistente(indice, cliente).perguntar("xyzzy")
    assert not resposta.encontrou and cliente.chamadas == []


def test_pergunta_fora_do_assunto_nao_chama_api(indice):
    cliente = ClienteFalso()
    resposta = Assistente(indice, cliente).perguntar("Quem ganhou a Copa do Mundo de 2002?")
    assert not resposta.encontrou and cliente.chamadas == []


def test_cobertura_dos_termos(indice):
    melhor = indice.buscar("mosquito gigante", k=1)[0]
    assert melhor.cobertura == 1.0
