<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <title>Ketner AI — шортс 9:16</title>
    <script src="assets/vendor/gsap.min.js"></script>
    <style>
      @font-face {
        font-family: "Geologica";
        font-style: normal;
        font-weight: 100 900;
        src: url("assets/fonts/geologica-cyrillic.woff2") format("woff2");
        unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
      }
      @font-face {
        font-family: "Geologica";
        font-style: normal;
        font-weight: 100 900;
        src: url("assets/fonts/geologica-latin.woff2") format("woff2");
        unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC,
          U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
      }
      @font-face {
        font-family: "JetBrains Mono";
        font-style: normal;
        font-weight: 100 800;
        src: url("assets/fonts/jetbrains-mono-latin.woff2") format("woff2");
        unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC,
          U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
      }
      @font-face {
        font-family: "JetBrains Mono";
        font-style: normal;
        font-weight: 100 800;
        src: url("assets/fonts/jetbrains-mono-cyrillic.woff2") format("woff2");
        unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
      }

      :root {
        --canvas: #1a1c1b;
        --surface: #212423;
        --surface-2: #282b2a;
        --surface-3: #2e3230;
        --text: #ecefea;
        --muted: #a3aba6;
        --accent: #9eefd0;
        --accent-soft: rgba(158, 239, 208, 0.11);
        --line: rgba(236, 239, 234, 0.1);
      }
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html,
      body {
        width: 1080px;
        height: 1920px;
        overflow: hidden;
        background: var(--canvas);
      }
      #root {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: var(--canvas);
        font-family: "Geologica", system-ui, sans-serif;
        color: var(--text);
      }
      .clip {
        position: absolute;
        inset: 0;
      }
      .sc {
        position: absolute;
        inset: 0;
        overflow: hidden;
      }
      .bg {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(700px 700px at 85% 8%, rgba(158, 239, 208, 0.12), transparent 70%),
          radial-gradient(700px 700px at 0% 75%, rgba(154, 217, 230, 0.06), transparent 70%),
          var(--canvas);
      }
      .grid {
        position: absolute;
        inset: 0;
        background-image:
          linear-gradient(var(--line) 1px, transparent 1px),
          linear-gradient(90deg, var(--line) 1px, transparent 1px);
        background-size: 90px 90px;
        opacity: 0.35;
        mask-image: radial-gradient(70% 55% at 50% 40%, #000 30%, transparent 100%);
      }
      .mint {
        color: var(--accent);
      }
      /* content lives in the top 1200px; captions own 1250–1500; bottom is left to platform UI */
      .stage {
        position: absolute;
        left: 70px;
        right: 70px;
        top: 170px;
        height: 1030px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 34px;
      }
      .h {
        font-size: 92px;
        line-height: 1.05;
        font-weight: 700;
        letter-spacing: -0.03em;
      }
      .h.c {
        text-align: center;
      }

      /* S1 */
      .sub-card {
        height: 150px;
        border-radius: 24px;
        background: var(--surface);
        border: 1px solid var(--line);
        display: flex;
        align-items: center;
        gap: 26px;
        padding: 0 34px;
      }
      .sub-card .n {
        width: 70px;
        height: 70px;
        border-radius: 18px;
        background: var(--surface-3);
        display: grid;
        place-items: center;
        font-size: 34px;
        font-weight: 700;
        color: var(--muted);
        flex: none;
      }
      .sub-card .t {
        font-size: 40px;
        font-weight: 600;
        line-height: 1.2;
      }
      .sub-card .s {
        font-size: 26px;
        color: var(--muted);
      }
      .sub-card .pay {
        margin-left: auto;
        font-size: 26px;
        font-weight: 600;
        padding: 14px 24px;
        border-radius: 14px;
        background: var(--surface-3);
        color: var(--muted);
      }
      #s1-stop {
        position: absolute;
        left: 0;
        right: 0;
        top: 170px;
        height: 1030px;
        display: grid;
        place-items: center;
      }
      #s1-stop span {
        display: block;
        font-size: 210px;
        font-weight: 800;
        letter-spacing: -0.04em;
        color: var(--accent);
      }

      /* S2 */
      #s2-shot {
        position: absolute;
        top: 0;
        left: -840px;
        width: 3413px;
        height: 1920px;
        opacity: 0.08;
        filter: blur(4px);
        max-width: none;
      }
      #s2-shade {
        position: absolute;
        inset: 0;
        background: radial-gradient(70% 50% at 50% 38%, rgba(26, 28, 27, 0.45), rgba(26, 28, 27, 0.94));
      }
      .brand {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 24px;
      }
      .brand img {
        width: 120px;
        height: 120px;
        display: block;
      }
      .brand b {
        font-size: 80px;
        font-weight: 700;
        letter-spacing: -0.02em;
      }
      #s2-head .w {
        display: block;
      }

      /* S3 */
      .brand-row {
        height: 120px;
        border-radius: 22px;
        background: var(--surface);
        border: 1px solid var(--line);
        display: flex;
        align-items: center;
        padding: 0 40px;
        position: relative;
        overflow: hidden;
      }
      .brand-row img {
        height: 80px;
        width: auto;
        display: block;
      }
      .brand-row .bar {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 8px;
        background: var(--accent);
      }
      #s3-stage {
        gap: 20px;
      }

      /* S4 */
      #s4-shot {
        position: absolute;
        left: 0;
        top: 0;
        width: 1920px;
        height: 1080px;
        transform-origin: 0 0;
        max-width: none;
      }
      #s4-shade {
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, rgba(26, 28, 27, 0.7) 0%, transparent 18%, transparent 62%, var(--canvas) 72%);
      }
      #s4-ring {
        position: absolute;
        left: 400px;
        top: 437px;
        width: 202px;
        height: 90px;
        border-radius: 26px;
        border: 4px solid var(--accent);
        box-shadow: 0 0 50px rgba(158, 239, 208, 0.5);
      }
      .callout {
        position: absolute;
        left: 70px;
        right: 70px;
        top: 620px;
        padding: 30px 36px;
        border-radius: 24px;
        background: rgba(26, 28, 27, 0.94);
        border: 1px solid rgba(158, 239, 208, 0.45);
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
      }
      .callout b {
        display: block;
        font-size: 64px;
        line-height: 1.1;
        letter-spacing: -0.02em;
      }
      .callout > span {
        display: block;
        margin-top: 10px;
        font-size: 36px;
        color: var(--muted);
      }

      /* S5 */
      .feat {
        border-radius: 26px;
        background: var(--surface);
        border: 1px solid var(--line);
        padding: 30px 34px;
        display: flex;
        align-items: center;
        gap: 28px;
      }
      .feat .ic {
        width: 96px;
        height: 96px;
        flex: none;
        border-radius: 22px;
        background: var(--accent-soft);
        border: 1px solid rgba(158, 239, 208, 0.3);
        display: grid;
        place-items: center;
        font-family: "JetBrains Mono", monospace;
        font-size: 32px;
        font-weight: 700;
        color: var(--accent);
      }
      .feat h3 {
        font-size: 48px;
        font-weight: 700;
        letter-spacing: -0.02em;
        line-height: 1.1;
      }
      .feat p {
        margin-top: 6px;
        font-size: 30px;
        color: var(--muted);
        line-height: 1.25;
      }
      .feat code {
        display: inline-block;
        margin-top: 10px;
        font-family: "JetBrains Mono", monospace;
        font-size: 26px;
        color: var(--accent);
      }

      /* S6 */
      #s6-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
      }
      .plan {
        position: relative;
        height: 270px;
        border-radius: 26px;
        background: var(--surface);
        border: 1px solid var(--line);
        padding: 30px 34px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .plan .nm {
        font-size: 40px;
        font-weight: 600;
      }
      .plan .pr {
        font-size: 96px;
        font-weight: 700;
        letter-spacing: -0.03em;
        line-height: 1;
      }
      .plan .pr small {
        font-size: 28px;
        font-weight: 400;
        color: var(--muted);
        letter-spacing: 0;
      }
      .plan .glow {
        position: absolute;
        inset: -2px;
        border-radius: 26px;
        border: 4px solid var(--accent);
        box-shadow: 0 0 60px rgba(158, 239, 208, 0.35);
        opacity: 0;
      }

      /* S7 */
      #s7-stage {
        align-items: center;
        gap: 44px;
      }
      #s7-stage img {
        width: 200px;
        height: 200px;
        display: block;
      }
      #s7-url {
        font-family: "JetBrains Mono", monospace;
        font-size: 76px;
        font-weight: 700;
        padding: 30px 60px;
        border-radius: 26px;
        background: var(--accent);
        color: #0f1a16;
      }

      /* Captions */
      #captions {
        position: absolute;
        left: 60px;
        right: 60px;
        top: 1250px;
        height: 260px;
      }
      .cap {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        opacity: 0;
      }
      .cap p {
        max-width: 940px;
        font-size: 74px;
        line-height: 1.15;
        font-weight: 800;
        letter-spacing: -0.02em;
        color: #ffffff;
        text-shadow:
          0 4px 0 #0b0d0c,
          0 0 24px rgba(0, 0, 0, 0.85);
      }
      .cap .wd {
        display: inline-block;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="30.4"
      data-width="1080"
      data-height="1920"
    >
      <audio
        id="voice"
        src="assets/voice.mp3"
        data-start="0.2"
        data-duration="28.6"
        data-track-index="9"
        data-volume="1"
      ></audio>

      <section id="s1" class="clip" data-start="0" data-duration="6.1" data-track-index="1">
        <div class="sc" id="s1-sc">
          <div class="bg"></div>
          <div class="grid"></div>
          <div class="stage" id="s1-stage">
            <div class="h" id="s1-h">Три нейросети —<br />три подписки?</div>
            <div class="sub-card" id="s1-c1">
              <div class="n">1</div>
              <div><div class="t">Нейросеть №1</div><div class="s">отдельный аккаунт</div></div>
              <div class="pay">Оплатить</div>
            </div>
            <div class="sub-card" id="s1-c2">
              <div class="n">2</div>
              <div><div class="t">Нейросеть №2</div><div class="s">ещё один аккаунт</div></div>
              <div class="pay">Оплатить</div>
            </div>
            <div class="sub-card" id="s1-c3">
              <div class="n">3</div>
              <div><div class="t">Нейросеть №3</div><div class="s">и ещё одна карта</div></div>
              <div class="pay">Оплатить</div>
            </div>
          </div>
          <div id="s1-stop"><span id="s1-stop-word">Хватит.</span></div>
        </div>
      </section>

      <section id="s2" class="clip" data-start="6.1" data-duration="3.6" data-track-index="2">
        <div class="sc" id="s2-sc">
          <div class="bg"></div>
          <img id="s2-shot" src="assets/screens/landing.png" alt="" />
          <div id="s2-shade"></div>
          <div class="stage">
            <div class="brand">
              <img id="s2-logo" src="assets/logo/logo-mark.png" alt="" />
              <b id="s2-name">Ketner AI</b>
            </div>
            <div class="h c" id="s2-head">
              <span class="w" id="s2-w1">Все сильные модели</span>
              <span class="w mint" id="s2-w2">в одной подписке</span>
            </div>
          </div>
        </div>
      </section>

      <section id="s3" class="clip" data-start="9.7" data-duration="5.0" data-track-index="3">
        <div class="sc" id="s3-sc">
          <div class="bg"></div>
          <div class="grid"></div>
          <div class="stage" id="s3-stage">
            <div class="brand-row" id="s3-r1"><i class="bar"></i><img src="assets/screens/brand-openai.png" alt="OpenAI" /></div>
            <div class="brand-row" id="s3-r2"><i class="bar"></i><img src="assets/screens/brand-anthropic.png" alt="Anthropic" /></div>
            <div class="brand-row" id="s3-r3"><i class="bar"></i><img src="assets/screens/brand-google.png" alt="Google" /></div>
            <div class="brand-row" id="s3-r4"><i class="bar"></i><img src="assets/screens/brand-xai.png" alt="xAI" /></div>
            <div class="brand-row" id="s3-r5"><i class="bar"></i><img src="assets/screens/brand-deepseek.png" alt="DeepSeek" /></div>
            <div class="h" id="s3-line">в одном <span class="mint">чате</span></div>
          </div>
        </div>
      </section>

      <section id="s4" class="clip" data-start="14.7" data-duration="3.1" data-track-index="4">
        <div class="sc" id="s4-sc">
          <div class="bg"></div>
          <img id="s4-shot" src="assets/screens/chat-typed.png" alt="" />
          <div id="s4-shade"></div>
          <div id="s4-ring"></div>
          <div class="callout" id="s4-callout">
            <b>Режим <span class="mint">Auto</span></b>
            <span>сам выбирает модель под задачу</span>
          </div>
        </div>
      </section>

      <section id="s5" class="clip" data-start="17.8" data-duration="5.2" data-track-index="5">
        <div class="sc" id="s5-sc">
          <div class="bg"></div>
          <div class="grid"></div>
          <div class="stage">
            <div class="h" id="s5-head">Чат, код и картинки — <span class="mint">в одной подписке</span></div>
            <div class="feat" id="s5-f1">
              <div class="ic">&lt;/&gt;</div>
              <div><h3>Ketner Code</h3><p>Агент правит код по плану</p></div>
            </div>
            <div class="feat" id="s5-f2">
              <div class="ic">IMG</div>
              <div><h3>Картинки</h3><p>Генерация из текста, FLUX</p></div>
            </div>
            <div class="feat" id="s5-f3">
              <div class="ic">{ }</div>
              <div><h3>API как у OpenAI</h3><code>/v1/chat/completions</code></div>
            </div>
          </div>
        </div>
      </section>

      <section id="s6" class="clip" data-start="23.0" data-duration="3.3" data-track-index="6">
        <div class="sc" id="s6-sc">
          <div class="bg"></div>
          <div class="grid"></div>
          <div class="stage">
            <div class="h c" id="s6-head">Тарифы</div>
            <div id="s6-grid">
              <div class="plan" id="s6-p1"><div class="nm">Free</div><div class="pr">$0 <small>/30 дней</small></div><i class="glow" id="s6-g1"></i></div>
              <div class="plan" id="s6-p2"><div class="nm">Plus</div><div class="pr">$9 <small>/30 дней</small></div></div>
              <div class="plan" id="s6-p3"><div class="nm">Pro</div><div class="pr">$25 <small>/30 дней</small></div></div>
              <div class="plan" id="s6-p4"><div class="nm">Ultra</div><div class="pr">$49 <small>/30 дней</small></div><i class="glow" id="s6-g4"></i></div>
            </div>
          </div>
        </div>
      </section>

      <section id="s7" class="clip" data-start="26.3" data-duration="4.1" data-track-index="7">
        <div class="sc" id="s7-sc">
          <div class="bg"></div>
          <div class="grid"></div>
          <div class="stage" id="s7-stage">
            <img id="s7-logo" src="assets/logo/logo-mark.png" alt="" />
            <div class="h c" id="s7-head">Начните <span class="mint">бесплатно</span></div>
            <div id="s7-url">ketner.org</div>
          </div>
        </div>
      </section>

      <div id="captions" class="clip" data-start="0" data-duration="30.4" data-track-index="8">
<!--CAPTIONS-->
      </div>
    </div>

    <script>
      const tl = gsap.timeline({ paused: true });
      const E = "power3.out";
      const fade = (id, a, b) => {
        tl.fromTo(id, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "none" }, a);
        tl.to(id, { opacity: 0, duration: 0.3, ease: "none" }, b - 0.3);
      };
      const rise = (id, t, d = 0.55, y = 50) =>
        tl.fromTo(id, { opacity: 0, y }, { opacity: 1, y: 0, duration: d, ease: E }, t);

      /* S1 · 0 – 6.1 */
      fade("#s1-sc", 0, 6.1);
      rise("#s1-h", 0.25, 0.7);
      [["#s1-c1", 0.4], ["#s1-c2", 2.4], ["#s1-c3", 3.75]].forEach(([id, t]) => {
        tl.fromTo(id, { opacity: 0, x: 120 }, { opacity: 1, x: 0, duration: 0.5, ease: E }, t);
      });
      tl.to("#s1-stage", { opacity: 0, duration: 0.25, ease: "power2.in" }, 4.85);
      tl.fromTo("#s1-stop-word", { opacity: 0, scale: 1.35 }, { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(2)" }, 5.15);

      /* S2 · 6.1 – 9.7 */
      fade("#s2-sc", 6.1, 9.7);
      tl.fromTo("#s2-shot", { scale: 1.1 }, { scale: 1, duration: 3.6, ease: "none" }, 6.1);
      tl.fromTo("#s2-logo", { opacity: 0, scale: 0.6, rotation: -12 }, { opacity: 1, scale: 1, rotation: 0, duration: 0.6, ease: "back.out(1.8)" }, 6.35);
      tl.fromTo("#s2-name", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.5, ease: E }, 6.5);
      rise("#s2-w1", 7.55);
      rise("#s2-w2", 8.5);

      /* S3 · 9.7 – 14.7 */
      fade("#s3-sc", 9.7, 14.7);
      [["#s3-r1", 9.8], ["#s3-r2", 10.75], ["#s3-r3", 11.5], ["#s3-r4", 12.3], ["#s3-r5", 12.9]].forEach(([id, t]) => {
        tl.fromTo(id, { opacity: 0, x: -80 }, { opacity: 1, x: 0, duration: 0.45, ease: E }, t);
        tl.fromTo(id + " .bar", { scaleY: 0 }, { scaleY: 1, duration: 0.3, ease: E }, t + 0.1);
      });
      rise("#s3-line", 13.65);

      /* S4 · 14.7 – 17.8  (Auto pill at 1x (345,28) → frame (500,482); input (1096,982) at 1.3x → (540,560)) */
      fade("#s4-sc", 14.7, 17.8);
      tl.fromTo("#s4-shot", { scale: 0.5625, x: 0, y: 660 }, { scale: 1.6, x: -52, y: 437, duration: 0.9, ease: "power2.inOut" }, 14.75);
      tl.fromTo("#s4-ring", { opacity: 0, scale: 1.4 }, { opacity: 1, scale: 1, duration: 0.4, ease: E }, 15.65);
      tl.to("#s4-ring", { opacity: 0, duration: 0.25, ease: "none" }, 16.5);
      rise("#s4-callout", 15.75, 0.45, 30);
      tl.to("#s4-callout", { opacity: 0, duration: 0.25, ease: "none" }, 16.5);
      tl.to("#s4-shot", { scale: 1.3, x: -885, y: -717, duration: 0.85, ease: "power2.inOut" }, 16.5);

      /* S5 · 17.8 – 23.0 */
      fade("#s5-sc", 17.8, 23.0);
      rise("#s5-head", 17.9, 0.55, 30);
      [["#s5-f1", 18.0], ["#s5-f2", 19.25], ["#s5-f3", 20.75]].forEach(([id, t]) => rise(id, t, 0.55, 70));

      /* S6 · 23.0 – 26.3 */
      fade("#s6-sc", 23.0, 26.3);
      rise("#s6-head", 23.1, 0.45, 30);
      ["#s6-p1", "#s6-p2", "#s6-p3", "#s6-p4"].forEach((id, i) => rise(id, 23.2 + i * 0.1, 0.5, 60));
      tl.fromTo("#s6-g1", { opacity: 0 }, { opacity: 1, duration: 0.25, ease: "none" }, 24.05);
      tl.to("#s6-g1", { opacity: 0, duration: 0.25, ease: "none" }, 24.5);
      tl.fromTo("#s6-g4", { opacity: 0 }, { opacity: 1, duration: 0.25, ease: "none" }, 24.55);

      /* S7 · 26.3 – 30.4 */
      fade("#s7-sc", 26.3, 30.7);
      tl.fromTo("#s7-logo", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.6, ease: "back.out(1.8)" }, 26.45);
      rise("#s7-head", 26.6, 0.6, 40);
      tl.fromTo("#s7-url", { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.6)" }, 27.55);

      /* Captions: one group on screen at a time, the spoken word turns mint */
/*CAPTIONS*/

      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
