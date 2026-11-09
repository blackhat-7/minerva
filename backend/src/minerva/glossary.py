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


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s)


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
    # Every window that matches a term, as (score, words, first word, term).
    matches: list[tuple[float, int, int, str]] = []
    for n in range(1, MAX_WORDS + 1):
        for i in range(len(words) - n + 1):
            # only windows of words separated by spaces or hyphens
            if any(text[words[j].end() : words[j + 1].start()] not in (" ", "-") for j in range(i, i + n - 1)):
                continue
            norm = _norm(text[words[i].start() : words[i + n - 1].end()])
            if norm in candidates:
                matches.append((1.0, n, i, candidates[norm]))
            elif len(norm) >= MIN_FUZZY_LEN:
                # Only terms with the same digits: "deepseek" must not become "DeepSeek-V3", it may be any version.
                same = [c for c in candidates if len(c) >= MIN_FUZZY_LEN and _digits(c) == _digits(norm)]
                best = max(same, key=lambda c: SequenceMatcher(None, norm, c).ratio(), default="")
                if best and (ratio := SequenceMatcher(None, norm, best).ratio()) >= MIN_RATIO:
                    matches.append((ratio, n, i, candidates[best]))
    # Closest matches claim their words first, so "deep seek v3 or" loses to the exact "deep seek v3" and the "or"
    # stays. Among equally close ones the longer wins ("Llama 3 70B" over "Llama 3").
    replace: list[tuple[int, int, str]] = []  # (start, end, term)
    taken = [False] * len(words)
    for _, n, i, term in sorted(matches, key=lambda m: (-m[0], -m[1], m[2])):
        if any(taken[i : i + n]):
            continue
        taken[i : i + n] = [True] * n
        start, end = words[i].start(), words[i + n - 1].end()
        if text[start:end] != term:
            replace.append((start, end, term))
    for start, end, term in sorted(replace, reverse=True):
        text = text[:start] + term + text[end:]
    return text
