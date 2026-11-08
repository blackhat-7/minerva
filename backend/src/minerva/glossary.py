"""Snap misheard jargon in a transcript to the lesson's glossary terms.

Fast recognizers (Parakeet) take no vocabulary hint, so "PagedAttention" comes back as "page detention"
and "vLLM" as "VLLM". Comparing word windows to the glossary with letters and digits only fixes most of
these in microseconds. Only jargon-like terms are snapped, never ordinary words like "attention".
"""

import re
from difflib import SequenceMatcher

WORD = re.compile(r"\w[\w'-]*(?:\.\w+)*")  # keeps "all-reduce", "3.35", "llama.cpp"; drops sentence periods
MAX_WORDS = 4
MIN_FUZZY_LEN = 6  # shorter terms must match exactly (fuzzy "QN3" -> "Qwen3" would also hit real words)
MIN_RATIO = 0.85


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def is_jargon(term: str) -> bool:
    """Acronyms, CamelCase and names with digits: the terms recognizers mishear."""
    return any(c.isdigit() for c in term) or sum(c.isupper() for c in term) >= 2


def _candidates(terms: list[str]) -> dict[str, str]:
    """normalized -> spelling. "Tensor parallelism (TP)" yields both "Tensor parallelism" and "TP"."""
    out: dict[str, str] = {}
    for term in terms:
        for part in re.split(r"\s*[()]\s*", term):
            if is_jargon(part) and len(n := _norm(part)) >= 2:
                out.setdefault(n, part)
    return out


def snap(text: str, terms: list[str]) -> str:
    candidates = _candidates(terms)
    if not candidates:
        return text
    words = list(WORD.finditer(text))
    replace: list[tuple[int, int, str]] = []  # (start, end, term)
    taken = [False] * len(words)
    for n in range(MAX_WORDS, 0, -1):  # longest windows first
        for i in range(len(words) - n + 1):
            if any(taken[i : i + n]):
                continue
            # only windows of words separated by spaces or hyphens
            if any(text[words[j].end() : words[j + 1].start()] not in (" ", "-") for j in range(i, i + n - 1)):
                continue
            span = text[words[i].start() : words[i + n - 1].end()]
            norm = _norm(span)
            term = candidates.get(norm)
            if term is None and len(norm) >= MIN_FUZZY_LEN:
                best = max(candidates, key=lambda c: SequenceMatcher(None, norm, c).ratio())
                if len(best) >= MIN_FUZZY_LEN and SequenceMatcher(None, norm, best).ratio() >= MIN_RATIO:
                    term = candidates[best]
            if term is not None and term != span:
                replace.append((words[i].start(), words[i + n - 1].end(), term))
                taken[i : i + n] = [True] * n
    for start, end, term in sorted(replace, reverse=True):
        text = text[:start] + term + text[end:]
    return text
