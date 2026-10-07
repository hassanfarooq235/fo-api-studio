#!/usr/bin/env python3
"""Render a docs/*.md file as a standalone static page for GitHub Pages.

    python3 tools/md2html.py docs/PRIVACY_POLICY.md docs/privacy-policy.html \
        --title "Privacy Policy — F&O API Studio" --map SECURITY.md=security.html

The output is fully self-contained: inline CSS, zero scripts, zero external
requests — the same standard the extension itself is held to. Dev tooling only;
`tools/` is excluded from the store ZIP.
"""

import argparse
import html
import re
from pathlib import Path

CSS = """
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 24px;
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  color: #1b1f23; background: #f6f8fa;
}
nav.top {
  max-width: 880px; margin: 0 auto 14px; display: flex; gap: 18px;
  flex-wrap: wrap; align-items: baseline; font-size: 14px;
}
nav.top a { color: #57606a; text-decoration: none; }
nav.top a:hover { color: #0969da; text-decoration: underline; }
nav.top .brand { font-weight: 650; color: #1b1f23; }
main {
  max-width: 880px; margin: 0 auto; background: #fff;
  border: 1px solid #d0d7de; border-radius: 12px; padding: 40px 48px;
}
h1 {
  font-size: 1.9rem; line-height: 1.25; margin: 0 0 14px;
  padding-bottom: 12px; border-bottom: 1px solid #d0d7de;
}
h2 { font-size: 1.35rem; margin: 36px 0 10px; }
h3 { font-size: 1.1rem; margin: 26px 0 8px; }
p, li { margin: 10px 0; }
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
blockquote {
  margin: 18px 0; padding: 4px 16px; border-left: 4px solid #d0d7de;
  background: #f6f8fa; color: #57606a; border-radius: 0 6px 6px 0;
}
blockquote p { margin: 8px 0; }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .88em; background: #eff1f3; padding: 2px 6px; border-radius: 6px;
}
pre {
  background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 8px;
  padding: 14px 16px; overflow-x: auto;
}
pre code { background: none; padding: 0; font-size: .88em; }
table {
  border-collapse: collapse; width: 100%; margin: 18px 0;
  display: block; overflow-x: auto; font-size: 15px;
}
th, td { border: 1px solid #d0d7de; padding: 8px 12px; text-align: left; vertical-align: top; }
th { background: #f6f8fa; font-weight: 600; }
strong { font-weight: 650; }
.meta { color: #57606a; }
footer {
  max-width: 880px; margin: 18px auto 0; font-size: 13px;
  color: #6e7781; text-align: center;
}
@media (max-width: 640px) {
  body { padding: 12px; }
  main { padding: 24px 18px; border-radius: 8px; }
}
"""

LIST_ITEM = r"^[-*]\s+"
ORDERED_ITEM = r"^\d+\.\s+"


def inline(text, link_map):
    """Escape text, then apply code spans, links, bold and emphasis."""
    out = []
    for chunk in re.split(r"(`[^`]+`)", text):
        if len(chunk) > 2 and chunk.startswith("`") and chunk.endswith("`"):
            out.append("<code>" + html.escape(chunk[1:-1]) + "</code>")
            continue
        s = html.escape(chunk, quote=False)

        def link(m):
            label, href = m.group(1), m.group(2)
            href = link_map.get(href, href)
            return '<a href="%s">%s</a>' % (html.escape(href, quote=True), label)

        s = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", link, s)
        s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
        s = re.sub(r"(?<![\w*])\*([^*\n]+)\*(?![\w*])", r"<em>\1</em>", s)
        out.append(s)
    return "".join(out)


def split_row(row):
    row = row.strip()
    if row.startswith("|"):
        row = row[1:]
    if row.endswith("|"):
        row = row[:-1]
    return [c.strip() for c in row.split("|")]


def render_table(rows, link_map):
    header, body = split_row(rows[0]), [split_row(r) for r in rows[2:]]
    head = "".join("<th>%s</th>" % inline(c, link_map) for c in header)
    rows_html = []
    for cells in body:
        cells = (cells + [""] * len(header))[: len(header)]
        rows_html.append(
            "<tr>" + "".join("<td>%s</td>" % inline(c, link_map) for c in cells) + "</tr>"
        )
    return (
        "<table><thead><tr>%s</tr></thead><tbody>%s</tbody></table>"
        % (head, "".join(rows_html))
    )


def collect_items(lines, i, marker):
    """Consume a list plus its wrapped continuation lines."""
    items = []
    while i < len(lines):
        text = lines[i].strip()
        if not re.match(marker, text):
            break
        items.append(re.sub(marker, "", text))
        i += 1
        while i < len(lines):
            nxt = lines[i]
            body = nxt.strip()
            if not body or not nxt[:1].isspace() or re.match(marker, body):
                break
            if re.match(r"^(#{1,6}\s|\||>|```)", body):
                break
            items[-1] += " " + body
            i += 1
    return items, i


def render(md, link_map):
    lines = md.splitlines()
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        text = line.strip()

        if not text:
            i += 1
        elif text.startswith("```"):
            buf, i = [], i + 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            out.append("<pre><code>%s</code></pre>" % html.escape("\n".join(buf)))
        elif re.match(r"^#{1,6}\s", text):
            m = re.match(r"^(#{1,6})\s+(.*)$", text)
            level = len(m.group(1))
            out.append("<h%d>%s</h%d>" % (level, inline(m.group(2), link_map), level))
            i += 1
        elif text.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(lines[i])
                i += 1
            if len(rows) >= 2:
                out.append(render_table(rows, link_map))
        elif text.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                buf.append(lines[i].strip().lstrip(">").strip())
                i += 1
            out.append(
                "<blockquote><p>%s</p></blockquote>"
                % inline(" ".join(buf), link_map)
            )
        elif re.match(LIST_ITEM, text):
            items, i = collect_items(lines, i, LIST_ITEM)
            out.append(
                "<ul>%s</ul>"
                % "".join("<li>%s</li>" % inline(it, link_map) for it in items)
            )
        elif re.match(ORDERED_ITEM, text):
            items, i = collect_items(lines, i, ORDERED_ITEM)
            out.append(
                "<ol>%s</ol>"
                % "".join("<li>%s</li>" % inline(it, link_map) for it in items)
            )
        else:
            buf = []
            while i < len(lines):
                body = lines[i].strip()
                if not body or re.match(
                    r"^(#{1,6}\s|\||>|[-*]\s|\d+\.\s|```)", body
                ):
                    break
                buf.append(body)
                i += 1
            if buf:
                out.append("<p>%s</p>" % inline(" ".join(buf), link_map))
            else:
                i += 1
    return "\n".join(out)


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index,follow">
<meta name="description" content="{description}">
<title>{title}</title>
<style>{css}</style>
</head>
<body>
<nav class="top">
  <a class="brand" href="./">F&O API Studio</a>
  <a href="./privacy-policy.html">Privacy policy</a>
  <a href="./security.html">Security</a>
  <a href="./permissions.html">Permissions</a>
  <a href="{repo}">Source</a>
</nav>
<main>
{body}
</main>
<footer>F&O API Studio is independent software and is not affiliated with, endorsed by, or
supported by Microsoft.</footer>
</body>
</html>
"""


def main():
    p = argparse.ArgumentParser()
    p.add_argument("source")
    p.add_argument("target")
    p.add_argument("--title", required=True)
    p.add_argument("--description", default="Privacy policy for the F&O API Studio Chrome extension.")
    p.add_argument("--map", action="append", default=[], help="old=new relative link rewrite")
    args = p.parse_args()

    link_map = {}
    for pair in args.map:
        old, _, new = pair.partition("=")
        link_map[old] = new

    body = render(Path(args.source).read_text(encoding="utf-8"), link_map)
    if "{{" in body:
        raise SystemExit("unresolved placeholder in %s" % args.source)
    page = PAGE.format(
        title=html.escape(args.title, quote=True),
        description=html.escape(args.description, quote=True),
        css=CSS,
        body=body,
        repo="https://github.com/hassanfarooq235/fo-api-studio",
    )
    Path(args.target).write_text(page, encoding="utf-8")
    print("%s -> %s (%d bytes)" % (args.source, args.target, len(page)))


if __name__ == "__main__":
    main()
