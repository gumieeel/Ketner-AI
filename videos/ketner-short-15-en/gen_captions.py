# Собирает index.html из index.html.tpl: вставляет субтитры по пословным таймингам озвучки (ElevenLabs Scribe).
# Запуск: python3 gen_captions.py index.html.tpl index.html
import sys, html
OFF = 0.15
W = [("Paying",0,0.4),("for",0.48,0.56),("three",0.64,0.96),("AI",1.0,1.2),("subscriptions?",1.52,2.04),("Enough.",2.24,3.0),("Ketner",3.28,3.52),("AI —",3.6,4.2),("GPT,",4.4,5.04),("Claude,",5.2,5.76),("Gemini,",5.92,6.44),("Grok",6.56,6.88),("and",7.12,7.2),("DeepSeek",7.28,7.76),("in",8.0,8.16),("one",8.24,8.32),("subscription.",8.6,9.16),("Auto",9.44,9.6),("mode",9.72,9.84),("picks",9.88,10.08),("the",10.12,10.16),("model",10.28,10.4),("for",10.48,10.56),("you.",10.64,11.0),("Start",11.28,11.44),("for",11.52,11.6),("free",11.68,11.84),("at",12.08,12.16),("ketner.org",12.24,12.96)]
# phrase groups (word index ranges), chosen by meaning, ≤ ~20 chars per line
G = [(0,3),(3,5),(5,6),(6,8),(8,11),(11,14),(14,17),(17,19),(19,24),(24,27),(27,29)]
assert G[-1][1]==len(W)
html_out=[]; js=[]
for gi,(a,b) in enumerate(G):
    words=W[a:b]
    spans=" ".join(f'<span class="wd" id="w{gi}-{k}">{html.escape(t)}</span>' for k,(t,_,_) in enumerate(words))
    html_out.append(f'        <div class="cap" id="cap{gi}"><p>{spans}</p></div>')
    start=words[0][1]+OFF-0.05
    nxt = W[G[gi+1][0]][1]+OFF-0.05 if gi+1<len(G) else 13.95
    end=min(nxt, words[-1][2]+OFF+0.5)
    js.append(f'      tl.fromTo("#cap{gi}", {{ opacity: 0, y: 14 }}, {{ opacity: 1, y: 0, duration: 0.12, ease: "none" }}, {start:.3f});')
    js.append(f'      tl.to("#cap{gi}", {{ opacity: 0, duration: 0.08, ease: "none" }}, {end-0.08:.3f});')
    for k,(t,ws,we) in enumerate(words):
        js.append(f'      tl.fromTo("#w{gi}-{k}", {{ color: "#ffffff" }}, {{ color: "#9eefd0", duration: 0.06, ease: "none" }}, {ws+OFF:.3f});')
src=open(sys.argv[1]).read()
src=src.replace("<!--CAPTIONS-->","\n".join(html_out)).replace("/*CAPTIONS*/","\n".join(js))
open(sys.argv[2],"w").write(src)
print(len(G),"groups")
