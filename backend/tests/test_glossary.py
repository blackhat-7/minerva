from minerva.glossary import snap

TERMS = ["FSDP", "NCCL", "all-gather", "PagedAttention", "vLLM", "SGLang", "KV cache", "TTFT", "Qwen3",
         "Llama 3 70B", "BF16", "Tensor parallelism (TP)", "Attention", "Decode"]

# Real Parakeet output for a spoken paragraph.
HEARD = ("With page detention, VLLM and SG-Lang store the KV cache in fixed size blocks, "
         "so TTFT and TPOT both improve on QN3 and LLMA370B in BF16.")


def test_snaps_misheard_jargon():
    out = snap(HEARD, TERMS)
    assert "With PagedAttention, vLLM and SGLang store the KV cache" in out
    assert "Llama 3 70B in BF16." in out  # sentence period kept


def test_leaves_ordinary_words_and_unknowns():
    out = snap(HEARD, TERMS)
    assert "fixed size blocks" in out
    assert "QN3" in out  # too short to guess safely; the tutor maps it from context
    assert snap("attention over the decode step", TERMS) == "attention over the decode step"


def test_parenthesized_alias_and_case():
    assert snap("we use tp across eight GPUs", TERMS) == "we use TP across eight GPUs"


def test_no_terms_is_identity():
    assert snap(HEARD, []) == HEARD
