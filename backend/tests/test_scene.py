from minerva.lesson import Visual
from minerva.scene import COLS, ICONS, ROWS, normalize


def scene(actors: list[dict], steps: list[dict] = ()) -> Visual:
    return Visual.model_validate({"kind": "scene", "actors": actors, "steps": list(steps)})


def code(src: str, steps: list[dict] = (), language: str = "python") -> Visual:
    return Visual.model_validate({"kind": "code", "code": src, "language": language, "steps": list(steps)})


def actor(id: str, **kw) -> dict:
    return {"id": id, "label": id.upper(), **kw}


def test_scene_problems_are_only_the_broken_ones():
    assert normalize(scene([]), "") == ["a scene needs actors"]
    too_many = [actor(f"a{i}") for i in range(COLS * ROWS + 1)]
    assert any("at most" in p for p in normalize(scene(too_many), ""))
    problems = normalize(scene([actor("a"), actor("a"), {"id": "b", "label": " "}]), "")
    assert len(problems) == 2 and "duplicate" in problems[0] and "label" in problems[1]
    assert normalize(code("  "), "") == ["a code visual needs code"]
    assert normalize(scene([actor("a", col=9, icon="nope", color="red", count=99, level=3)]), "") == []


def test_actors_are_clamped_and_moved_to_the_nearest_free_cell():
    first = ICONS[0]
    v = scene([actor("a", col=-3, row=99, icon=f" {first.upper()} ", color="red", count=0, level=2),
               actor("b", col=0, row=ROWS - 1), actor("c", col=0, row=ROWS - 1, icon="zzzz", level=None)])
    normalize(v, "")
    a, b, c = v.actors
    assert (a.col, a.row, a.icon, a.color, a.count, a.level) == (0, ROWS - 1, first, "blue", 1, 1.0)
    assert (b.col, b.row) == (0, ROWS - 2)  # above: ties go to the lower row, then column
    assert (c.col, c.row) == (1, ROWS - 1) and c.icon == "" and c.level is None
    assert len({(x.col, x.row) for x in v.actors}) == 3


def test_scene_steps_lose_unknown_ids_and_bad_values():
    step = {"caption": "go", "lines": "3", "show": ["a", "x"], "hide": ["x"], "highlight": ["b", "y"],
            "link": [["a", "x"], ["a", "b", "x"]],
            "flow": [{"path": ["a", "x"]}, {"path": ["a", "b"], "speed": "warp", "color": "red", "label": "w"}],
            "change": [{"id": "a", "count": 50, "level": -1}, {"id": "x", "value": "1"}]}
    v = scene([actor("a"), actor("b")], [step, {"caption": " ", "show": ["x"]}])
    normalize(v, "")
    [s] = v.steps  # the second step has nothing left to show
    assert (s.lines, s.show, s.hide, s.highlight, s.link) == ("", ["a"], [], ["b"], [["a", "b"]])
    assert [(f.path, f.speed, f.color) for f in s.flow] == [(["a", "b"], "medium", "")]
    assert [(c.id, c.count, c.level) for c in s.change] == [("a", 12, 0.0)]


def test_code_language_lines_and_scene_fields():
    for given, want in [(" Py ", "python"), ("C++", "cpp"), ("zsh", "bash"), ("", "plaintext"), ("cobol", "plaintext")]:
        v = code("x", language=given)
        normalize(v, "")
        assert v.language == want

    src = "\n".join("l" * n for n in range(1, 6))  # 5 lines
    steps = [{"lines": "2, 7-9, 4-3, x, 4-99, 1, 2 – 3", "show": ["a"], "flow": [{"path": ["a", "b"]}]},
             {"lines": "9"}]
    v = code(src, steps)
    normalize(v, "")
    assert [s.lines for s in v.steps] == ["2,3-4,4-5,1,2-3"]  # the second step has no lines left
    assert v.steps[0].show == [] and v.steps[0].flow == []


def test_other_kinds_lose_scene_and_code_fields():
    v = Visual.model_validate({"kind": "table", "code": "| a |", "language": "py", "actors": [actor("a")],
                               "steps": [{"caption": "c"}]})
    assert normalize(v, "") == []
    assert (v.language, v.actors, v.steps) == ("", [], [])


def test_at_must_come_from_the_narration_in_order():
    narration = "First, we  load the “Weights”.  Then we multiply. Finally we load them again."
    steps = [{"caption": "1", "at": "  “weights”. "}, {"caption": "2", "at": "THEN we multiply"},
             {"caption": "3", "at": "weights"},  # only before the previous match
             {"caption": "4", "at": "load them"}, {"caption": "5", "at": "..."}]
    v = scene([actor("a")], steps)
    normalize(v, narration)
    assert [s.at for s in v.steps] == ["weights", "then we multiply", "", "load them", ""]


def test_at_ignores_punctuation_the_model_dropped_or_added():
    narration = "Batching helps: one read serves eight requests. Don't stop."
    v = scene([actor("a")], [{"caption": "1", "at": "batching helps one read"}, {"caption": "2", "at": "dont"},
                             {"caption": "3", "at": "don't, stop!"}])
    normalize(v, narration)
    assert [s.at for s in v.steps] == ["batching helps one read", "", "don t stop"]


def test_a_dropped_step_does_not_move_the_search_past_a_kept_one():
    narration = "Load the weights. Then multiply them."
    steps = [{"at": "then multiply", "show": ["gone"]},  # nothing left once the unknown actor is removed
             {"caption": "kept", "at": "load the weights"}]
    v = scene([actor("a")], steps)
    normalize(v, narration)
    assert [(s.caption, s.at) for s in v.steps] == [("kept", "load the weights")]
