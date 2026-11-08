from minerva.lesson import draft


def test_draft_follows_a_lesson_as_it_is_written():
    assert draft("") == {"title": "", "segments": [], "parts": []}
    text = ('{"title": "KV \\"cache\\"", "summary": "s", "glossary": [{"term": "KV", "definition": "d"}], "segments": '
            '[{"id": "x", "title": "Overview", "one_line": "Memory grows.", "narration": "He said \\"title\\": no."}, '
            '{"id": "y", "title": "Pag')
    assert draft(text) == {
        "title": 'KV "cache"',
        "segments": [{"title": "Overview", "one_line": "Memory grows."}, {"title": "Pag", "one_line": ""}],
        "parts": [],
    }
    assert draft(text + 'ing", "one_line": "Blocks"}], "problems": [], "pitfalls": [{"trap": "t')["parts"] == [
        "problems", "pitfalls"]


def test_draft_tolerates_a_cut_escape():
    assert draft('{"title": "caf\\u00')["title"] == "caf\\u00"
    assert draft('{"title": "a\\')["title"] == "a"
