#!/usr/bin/env python3
"""Build the image sitemap from the site's canonical pages and visible images.

Run without arguments to update sitemap.xml, or with --check to verify it.
Uses only the Python standard library and does not rename or modify images.
"""

from __future__ import annotations

import argparse
from datetime import datetime
from html.parser import HTMLParser
import json
from pathlib import Path
import sys
import unicodedata
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit
import xml.etree.ElementTree as ET


SITE_ROOT = Path(__file__).resolve().parent.parent
SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9"
IMAGE_NS = "http://www.google.com/schemas/sitemap-image/1.1"
NS = {"s": SITEMAP_NS, "image": IMAGE_NS}
ET.register_namespace("", SITEMAP_NS)
ET.register_namespace("image", IMAGE_NS)


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.canonicals: list[str] = []
        self.images: list[str] = []
        self.structured_data: list[object] = []
        self._json_parts: list[str] | None = None

    def handle_starttag(self, tag: str, attributes: list[tuple[str, str | None]]) -> None:
        attrs = dict(attributes)
        if tag == "link" and "canonical" in (attrs.get("rel") or "").lower().split():
            self.canonicals.append((attrs.get("href") or "").strip())
        if tag == "img" and (attrs.get("alt") or "").strip():
            source = (attrs.get("src") or "").strip()
            if not source:
                raise ValueError("A nondecorative image has no src")
            if Path(unquote(urlsplit(source).path)).name.lower() != "white.png":
                self.images.append(source)
        if tag == "script" and (attrs.get("type") or "").lower() == "application/ld+json":
            self._json_parts = []

    def handle_data(self, data: str) -> None:
        if self._json_parts is not None:
            self._json_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._json_parts is not None:
            self.structured_data.append(json.loads("".join(self._json_parts)))
            self._json_parts = None


def normalize_url(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"Expected an absolute HTTP(S) URL: {url!r}")
    path = quote(unicodedata.normalize("NFC", unquote(parsed.path)), safe="/")
    return urlunsplit((parsed.scheme, parsed.netloc, path, parsed.query, parsed.fragment))


def walk_nodes(value: object):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_nodes(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_nodes(child)


def page_modified(page: PageParser, canonical: str) -> str | None:
    dates: set[str] = set()
    for node in walk_nodes(page.structured_data):
        if "dateModified" not in node:
            continue
        node_id = node.get("@id")
        node_url = node.get("url")
        if node_id != canonical + "#webpage" and node_url != canonical:
            continue
        value = node["dateModified"]
        if not isinstance(value, str):
            raise ValueError(f"Non-text dateModified for {canonical}")
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError(f"Invalid dateModified for {canonical}: {value}") from error
        dates.add(value)
    if len(dates) > 1:
        raise ValueError(f"Conflicting dateModified values for {canonical}: {sorted(dates)}")
    return next(iter(dates), None)


def local_file(url: str, canonical: str) -> Path | None:
    parsed = urlsplit(url)
    origin = urlsplit(canonical)
    if (parsed.scheme, parsed.netloc) != (origin.scheme, origin.netloc):
        return None
    relative = unquote(parsed.path).lstrip("/") or "index.html"
    candidate = (SITE_ROOT / relative).resolve()
    if not candidate.is_relative_to(SITE_ROOT):
        raise ValueError(f"URL escapes the site directory: {url}")
    if not candidate.is_file():
        raise ValueError(f"Missing local file for {url}: {candidate}")
    return candidate


def build_sitemap() -> tuple[bytes, int, int]:
    sitemap_path = SITE_ROOT / "sitemap.xml"
    previous: dict[str, str | None] = {}
    if sitemap_path.exists():
        old_root = ET.parse(sitemap_path).getroot()
        for entry in old_root.findall("s:url", NS):
            location = entry.findtext("s:loc", namespaces=NS)
            if not location:
                raise ValueError("Existing sitemap has a page without a loc")
            canonical = normalize_url(location)
            if canonical in previous:
                raise ValueError(f"Duplicate canonical in existing sitemap: {canonical}")
            previous[canonical] = entry.findtext("s:lastmod", namespaces=NS)

    pages: dict[str, PageParser] = {}
    for source in sorted(SITE_ROOT.glob("*.html")):
        page = PageParser()
        try:
            page.feed(source.read_text(encoding="utf-8"))
            page.close()
        except (ValueError, json.JSONDecodeError) as error:
            raise ValueError(f"Cannot parse {source.name}: {error}") from error
        if len(page.canonicals) != 1:
            raise ValueError(f"{source.name} must have exactly one canonical link")
        canonical = normalize_url(page.canonicals[0])
        if urlsplit(canonical).query or urlsplit(canonical).fragment:
            raise ValueError(f"Canonical must not contain query or fragment: {canonical}")
        if canonical in pages:
            raise ValueError(f"Duplicate canonical in HTML pages: {canonical}")
        if local_file(canonical, canonical) != source.resolve():
            raise ValueError(f"Canonical does not resolve to {source.name}: {canonical}")
        pages[canonical] = page

    order = [url for url in previous if url in pages]
    order.extend(sorted(set(pages) - set(previous)))
    root = ET.Element(f"{{{SITEMAP_NS}}}urlset")
    image_count = 0
    for canonical in order:
        page = pages[canonical]
        entry = ET.SubElement(root, f"{{{SITEMAP_NS}}}url")
        ET.SubElement(entry, f"{{{SITEMAP_NS}}}loc").text = canonical
        modified = page_modified(page, canonical) or previous.get(canonical)
        if modified:
            ET.SubElement(entry, f"{{{SITEMAP_NS}}}lastmod").text = modified
        seen: set[str] = set()
        for source in page.images:
            image_url = normalize_url(urljoin(canonical, source))
            local_file(image_url, canonical)
            if image_url in seen:
                continue
            seen.add(image_url)
            image_entry = ET.SubElement(entry, f"{{{IMAGE_NS}}}image")
            ET.SubElement(image_entry, f"{{{IMAGE_NS}}}loc").text = image_url
            image_count += 1

    ET.indent(root, space="  ")
    data = ET.tostring(root, encoding="utf-8", xml_declaration=True) + b"\n"
    return data, len(pages), image_count


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if sitemap.xml needs rebuilding")
    args = parser.parse_args()
    try:
        data, page_count, image_count = build_sitemap()
        destination = SITE_ROOT / "sitemap.xml"
        if args.check:
            if not destination.exists() or destination.read_bytes() != data:
                print("sitemap.xml is stale; run scripts/build_image_sitemap.py to update it.", file=sys.stderr)
                return 1
            print(f"sitemap.xml is current: {page_count} pages, {image_count} image entries.")
        else:
            destination.write_bytes(data)
            print(f"Updated sitemap.xml: {page_count} pages, {image_count} image entries.")
    except (OSError, ValueError, ET.ParseError) as error:
        print(f"Image sitemap error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
