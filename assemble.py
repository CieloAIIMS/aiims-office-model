"""Assemble the single-file viewer: index.html (served by Vercel at /).

    python3 build.py      # only when the architecture or fit-out rectangles change -> data/model_data.json
    python3 assemble.py   # always after editing v2_script.js / v2_html.txt / v2_css.txt -> index.html
"""
import base64, os
here = os.path.dirname(os.path.abspath(__file__))
rd = lambda p, mode='r': open(os.path.join(here, p), mode).read()

css = rd('v2_css.txt').replace("</style>", """#loading{position:absolute;inset:0;display:grid;place-items:center;font:500 12px var(--f-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);background:var(--bg)}
</style>""")
head = ('<title>AIIMS Office Model</title>\n<link rel="preconnect" href="https://fonts.googleapis.com">\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800;900&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap">\n')
tpl = head + css + "\n" + rd('v2_html.txt') + """
<script type="application/json" id="model">__DATA__</script>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>
<script type="module">
""" + rd('v2_script.js') + "\n</script>\n"
tpl = tpl.replace('__MEN_PNG__', rd('data/men_datauri.txt')).replace('__KYNAN_TEX__', rd('data/kynan_tex.txt'))
hdr = base64.b64encode(rd('small_empty_room_3.hdr', 'rb')).decode()
tpl = tpl.replace('<script type="module">', '<script>window.__HDR_B64="' + hdr + '"</script>\n<script type="module">', 1)
tpl = tpl.replace('<script type="module">', '<script>window.__KYNAN=' + rd('data/kynan_mesh.json') + '</script>\n<script type="module">', 1)
body = tpl.replace('__DATA__', rd('data/model_data.json'))
doc = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
       '<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>AIIMS Office Model</title>\n</head>\n'
       '<body style="margin:0">\n' + body + '\n</body>\n</html>\n')
open(os.path.join(here, 'index.html'), 'w').write(doc)
print('index.html', len(doc), 'bytes')
