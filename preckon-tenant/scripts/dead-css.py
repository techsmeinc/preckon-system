# Find CSS classes that no markup uses.
#
# A selector that matches nothing fails silently: the rule is there, the build
# is clean, and the feature looks implemented right up until somebody uses it.
# That is how the collapsed sidebar kept styling .wm and .env long after the
# workspace switcher was rewritten to .ws-switch/.nm.
#
# Deliberately generous about what counts as "used" — every bare word inside a
# className, a class= or a template literal — so the output is a short list
# worth reading rather than a wall of false positives.
import re, sys, pathlib

app = pathlib.Path(sys.argv[1])
css_path = app / "src/app/globals.css"
css = css_path.read_text(encoding="utf-8")

# Class names the stylesheet defines, minus the bits inside comments.
body = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
selectors = "".join(m.group(1) for m in re.finditer(r"([^{}]*)\{", body))
defined = set(re.findall(r"\.([A-Za-z_][\w-]*)", selectors))

used = set()
for f in app.rglob("src/**/*.tsx"):
    t = f.read_text(encoding="utf-8", errors="replace")
    for m in re.finditer(r'class(?:Name)?\s*=\s*(?:"([^"]*)"|\{([^}]*)\})', t, re.S):
        chunk = m.group(1) or m.group(2) or ""
        used.update(re.findall(r"[A-Za-z_][\w-]*", chunk))
    # classList.add("x"), a className built in a helper, a CSS class in a map
    for m in re.finditer(r'classList\.\w+\(([^)]*)\)', t):
        used.update(re.findall(r"[A-Za-z_][\w-]*", m.group(1)))

# Structural and state hooks that live in CSS by design.
IGNORE = re.compile(r"^(?:on|off|open|active|warn|crit|pri|sm|lg|mono|num|r|l|dim|new|sel|hidden)$")

dead = sorted(c for c in defined - used if not IGNORE.match(c))
print(f"{app.name}: {len(defined)} classes styled, {len(dead)} never appear in any .tsx")
for c in dead:
    lines = [i + 1 for i, ln in enumerate(css.split("\n")) if re.search(rf"\.{re.escape(c)}\b", ln)]
    print(f"  .{c:<22} {css_path}:{lines[0] if lines else '?'}")
