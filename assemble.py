css=open('v2_css.txt').read()
css=css.replace("</style>","""#loading{position:absolute;inset:0;display:grid;place-items:center;font:500 12px var(--f-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);background:var(--bg)}
</style>""")
head='<title>AIIMS Office Model</title>\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800;900&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap">\n'
tpl=head+css+"\n"+open('v2_html.txt').read()+"""
<script type="application/json" id="model">__DATA__</script>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}</script>
<script type="module">
"""+open('v2_script.js').read()+"\n</script>\n"
open('viewer_template_v2.html','w').write(tpl)
tpl=tpl.replace('__MEN_PNG__',open('men_datauri.txt').read()).replace('__KYNAN_TEX__',open('kynan_tex.txt').read())
import base64
tpl=tpl.replace('<script type="module">','<script>window.__HDR_B64="'+base64.b64encode(open('hdr/small_empty_room_3.hdr','rb').read()).decode()+'"</script>\n<script type="module">',1)
tpl=tpl.replace('<script type="module">','<script>window.__KYNAN='+open('kynan_mesh.json').read()+'</script>\n<script type="module">',1)
open('viewer_template_v2.html','w').write(tpl)
open('aiims_office.html','w').write(tpl.replace('__DATA__',open('model_data.json').read()))
print(len(tpl))
