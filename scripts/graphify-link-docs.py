# Une los nodos de los documentos con el código que nombran en graphify-out/graph.json (el extractor de docs no lo hace).
# - «foo()» o «services/x.js» en la etiqueta de un nodo de doc → el nodo de código con ese nombre, si hay uno solo fuera de tests.
# - «ADR 0008: …» (el nodo de cada ADR) → cada comentario «ADR-0008» del código.
# Uso: python3 scripts/graphify-link-docs.py   (idempotente; volver a pasarlo tras un /graphify --update de docs)
import json
import re
import sys
from pathlib import Path

GRAPH = Path('graphify-out/graph.json')
TEST = re.compile(r'(^|/)scripts/test-|\.test\.tsx?$')
CALL = re.compile(r'\b(\w+)\(\)')
FILE = re.compile(r'[\w./-]*\w\.(?:js|ts|tsx|mjs)\b')
ADR_DOC = re.compile(r'^ADR (\d{4}):')


def link(g: dict) -> int:
    nodes = g['nodes']
    code = [n for n in nodes if n.get('_origin') == 'ast' and not TEST.search(n.get('source_file', ''))]
    by_label: dict[str, list[str]] = {}
    for n in code:
        by_label.setdefault(n['label'], []).append(n['id'])
    files = {n['source_file']: n['id'] for n in code if n['label'] == Path(n.get('source_file', '')).name}
    adr_refs: dict[str, list[str]] = {}
    for n in code:
        if m := re.fullmatch(r'ADR-(\d{4})', n['label']):
            adr_refs.setdefault(m[1], []).append(n['id'])

    have = {(e['source'], e['target']) for e in g['links']}
    added = 0
    for n in nodes:
        if n.get('_origin') != 'semantic':
            continue
        text = f"{n['label']} {n.get('rationale') or ''}"
        targets = set()
        for name in CALL.findall(text):
            ids = by_label.get(f'{name}()', [])
            if len(ids) == 1:
                targets.add(ids[0])
        for path in FILE.findall(text):
            hits = [i for f, i in files.items() if f == path or f.endswith('/' + path.lstrip('./'))]
            if len(hits) == 1:
                targets.add(hits[0])
        if m := ADR_DOC.match(n['label']):
            targets.update(adr_refs.get(m[1], []))
        for t in targets:
            if (n['id'], t) in have or (t, n['id']) in have:
                continue
            g['links'].append({
                'source': n['id'], 'target': t, 'relation': 'references', '_origin': 'semantic',
                'confidence': 'INFERRED', 'confidence_score': 0.85, 'source_file': n.get('source_file'),
                'source_location': n.get('source_location'), 'weight': 1.0,
            })
            have.add((n['id'], t))
            added += 1
    return added


if __name__ == '__main__':
    if not GRAPH.exists():
        sys.exit(f'{GRAPH} no existe: genera el grafo primero (/graphify .)')
    g = json.loads(GRAPH.read_text(encoding='utf-8'))
    added = link(g)
    GRAPH.write_text(json.dumps(g, ensure_ascii=False), encoding='utf-8')
    print(f'{added} enlaces doc→código añadidos')
