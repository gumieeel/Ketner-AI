# Собирает index.html из index.html.tpl: вставляет субтитры по пословным таймингам озвучки (ElevenLabs Scribe).
# Запуск: python3 gen_captions.py index.html.tpl index.html
import sys, html
OFF = 0.15
W = [("Платите",0,0.64),("за",0.72,0.8),("три",0.92,1.04),("нейросети?",1.12,2.04),("Хватит.",2.32,3.24),("Ketner",3.6,3.92),("AI —",4.08,4.773),("GPT,",4.88,5.6),("Claude,",5.92,6.48),("Gemini,",6.72,7.36),("Grok",7.6,7.92),("и",8.24,8.28),("DeepSeek",8.32,8.8),("в",9.12,9.173),("одной",9.227,9.36),("подписке.",9.44,10.28),("Режим",10.56,10.8),("Auto",10.96,11.44),("сам",11.6,11.76),("выберет",11.84,12.08),("модель.",12.16,12.8),("Начните",13.12,13.52),("бесплатно",13.56,14.0),("на",14.08,14.16),("ketner.org",14.24,15.2)]
# phrase groups (word index ranges), chosen by meaning, ≤ ~20 chars per line
G = [(0,4),(4,5),(5,7),(7,10),(10,13),(13,16),(16,18),(18,21),(21,23),(23,25)]
assert G[-1][1]==len(W)
html_out=[]; js=[]
for gi,(a,b) in enumerate(G):
    words=W[a:b]
    spans=" ".join(f'<span class="wd" id="w{gi}-{k}">{html.escape(t)}</span>' for k,(t,_,_) in enumerate(words))
    html_out.append(f'        <div class="cap" id="cap{gi}"><p>{spans}</p></div>')
    start=words[0][1]+OFF-0.05
    nxt = W[G[gi+1][0]][1]+OFF-0.05 if gi+1<len(G) else 15.95
    end=min(nxt, words[-1][2]+OFF+0.5)
    js.append(f'      tl.fromTo("#cap{gi}", {{ opacity: 0, y: 14 }}, {{ opacity: 1, y: 0, duration: 0.12, ease: "none" }}, {start:.3f});')
    js.append(f'      tl.to("#cap{gi}", {{ opacity: 0, duration: 0.08, ease: "none" }}, {end-0.08:.3f});')
    for k,(t,ws,we) in enumerate(words):
        js.append(f'      tl.fromTo("#w{gi}-{k}", {{ color: "#ffffff" }}, {{ color: "#9eefd0", duration: 0.06, ease: "none" }}, {ws+OFF:.3f});')
src=open(sys.argv[1]).read()
src=src.replace("<!--CAPTIONS-->","\n".join(html_out)).replace("/*CAPTIONS*/","\n".join(js))
open(sys.argv[2],"w").write(src)
print(len(G),"groups")
