"""Web search that grounds lesson generation in current sources, so models without their own search get it too.

Default: Exa's free hosted MCP endpoint (no key, no setup; queries go to Exa). With `[search] searxng_url` set:
your own SearXNG, with each result page fetched and reduced to its main text locally.
Search is best-effort: on any failure the lesson is written without sources.
"""

import asyncio
import json
import logging

import httpx
import trafilatura

from .config import Search

EXA_MCP = "https://mcp.exa.ai/mcp"
RESULTS = 5
PAGE_CHARS = 3000  # per result, like Exa's own default
TIMEOUT = 20

log = logging.getLogger(__name__)


async def web_search(query: str, cfg: Search) -> str:
    """Results as text (title, URL and page text per result), or "" when search is off or fails."""
    if not cfg.enabled:
        return ""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as http:
            return await (_searxng(http, cfg.searxng_url, query) if cfg.searxng_url else _exa(http, query))
    except Exception:
        log.exception("web search for %r failed; continuing without sources", query)
        return ""


async def _exa(http: httpx.AsyncClient, query: str) -> str:
    resp = await http.post(
        EXA_MCP,
        headers={"Accept": "application/json, text/event-stream"},
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
              "params": {"name": "web_search_exa", "arguments": {"query": query, "numResults": RESULTS}}},
    )
    resp.raise_for_status()
    # The reply is one server-sent event: "event: message" then "data: <JSON-RPC response>".
    msg = json.loads(next(line[5:] for line in resp.text.splitlines() if line.startswith("data:")))
    if "error" in msg or msg["result"].get("isError"):
        raise RuntimeError(f"Exa: {msg.get('error') or msg['result']['content']}")
    return "\n\n".join(c["text"] for c in msg["result"]["content"] if c["type"] == "text")


async def _searxng(http: httpx.AsyncClient, base_url: str, query: str) -> str:
    resp = await http.get(f"{base_url.rstrip('/')}/search", params={"q": query, "format": "json"})
    resp.raise_for_status()
    results = resp.json()["results"][:RESULTS]
    pages = await asyncio.gather(*(_page_text(http, r["url"]) for r in results))
    return "\n\n".join(
        f"Title: {r.get('title', '')}\nURL: {r['url']}\n{text or r.get('content', '')}" for r, text in zip(results, pages)
    )


async def _page_text(http: httpx.AsyncClient, url: str) -> str:
    """The page's main text, or "" if it can't be fetched or read (the search snippet is used instead)."""
    try:
        resp = await http.get(url)
        resp.raise_for_status()
    except httpx.HTTPError as e:
        log.info("fetching %s failed: %s", url, e)
        return ""
    text = await asyncio.to_thread(trafilatura.extract, resp.text)
    return (text or "")[:PAGE_CHARS]
