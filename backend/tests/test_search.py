import asyncio
import json

import httpx

from minerva import search
from minerva.config import Search

ARTICLE = "<html><body><article><h1>FlashAttention-3</h1><p>" + "It overlaps matmul and softmax on Hopper. " * 20 + \
          "</p></article></body></html>"


def run(handler, coro_fn):
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            return await coro_fn(http)
    return asyncio.run(go())


def test_exa_reads_the_event_stream():
    def handler(request):
        body = json.loads(request.content)
        assert body["params"] == {"name": "web_search_exa", "arguments": {"query": "fa3", "numResults": 5}}
        reply = {"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": "Title: FA3\nURL: u"}]}}
        return httpx.Response(200, text=f"event: message\ndata: {json.dumps(reply)}\n\n")

    assert run(handler, lambda http: search._exa(http, "fa3")) == "Title: FA3\nURL: u"


def test_searxng_fetches_pages_and_falls_back_to_snippets():
    def handler(request):
        if request.url.host == "searx.test":
            assert request.url.params["format"] == "json" and request.url.params["q"] == "fa3"
            return httpx.Response(200, json={"results": [
                {"title": "Blog", "url": "https://blog.test/fa3", "content": "snippet one"},
                {"title": "Gone", "url": "https://gone.test/", "content": "snippet two"},
            ]})
        if request.url.host == "blog.test":
            return httpx.Response(200, text=ARTICLE)
        return httpx.Response(404)

    text = run(handler, lambda http: search._searxng(http, "https://searx.test/", "fa3"))
    blog, gone = text.split("\n\n")
    assert blog.startswith("Title: Blog\nURL: https://blog.test/fa3\n") and "overlaps matmul" in blog
    assert gone == "Title: Gone\nURL: https://gone.test/\nsnippet two"


def test_failures_and_off_give_no_sources(monkeypatch):
    async def boom(http, query):
        raise httpx.ConnectError("down")
    monkeypatch.setattr(search, "_exa", boom)
    assert asyncio.run(search.web_search("fa3", Search())) == ""
    assert asyncio.run(search.web_search("fa3", Search(enabled=False))) == ""
