"""Assistente de perguntas e respostas sobre a Wiki do Equiverso (RAG com filtro de spoiler)."""

from .busca import IndiceBM25, Resultado
from .documentos import Trecho, carregar_wiki
from .episodios import Episodio
from .gerador import Assistente, Resposta

__all__ = ["Assistente", "Episodio", "IndiceBM25", "Resposta", "Resultado", "Trecho", "carregar_wiki"]
