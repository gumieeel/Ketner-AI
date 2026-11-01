/*
 * Виджет бота для клиентов Ketner AI (docs/AUTOMATION_PLAN.md, этап B).
 *
 * Вставка на сайт бизнеса:
 *   <script src="https://ketner.org/widget.js" data-bot="адрес-бота" async></script>
 * Необязательно: data-label="Задать вопрос" (текст кнопки), data-color="#0a6a4f" (цвет кнопки),
 * data-theme="light" или "dark" (тема окна чата, по умолчанию светлая).
 *
 * Кнопка в правом нижнем углу открывает окно чата — страницу ketner.org/b/<адрес>?embed=1 во
 * фрейме. Скрипт ничего не читает со страницы сайта и не ставит cookie; переписка живёт во фрейме.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script || window.__ketnerBotWidget) return;
  var slug = String(script.getAttribute('data-bot') || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) return;
  window.__ketnerBotWidget = true;

  var origin;
  try {
    origin = new URL(script.src).origin;
  } catch (error) {
    origin = 'https://ketner.org';
  }
  var english = /^en/i.test(document.documentElement.lang || navigator.language || '');
  var label = script.getAttribute('data-label') || (english ? 'Ask a question' : 'Задать вопрос');
  var closeLabel = english ? 'Close chat' : 'Закрыть чат';
  var color = script.getAttribute('data-color') || '#0a6a4f';
  if (!/^#[0-9a-f]{3,8}$/i.test(color)) color = '#0a6a4f';
  var theme = script.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';

  var font = 'font:500 15px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;';
  var button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'ketner-bot-frame');
  button.textContent = label;
  button.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:2147483646;min-height:48px;padding:0 20px;' +
    'border:0;border-radius:999px;cursor:pointer;color:#fff;background:' +
    color +
    ';box-shadow:0 6px 24px rgba(0,0,0,.18);' +
    font;

  var panel = null;
  function build() {
    panel = document.createElement('div');
    panel.id = 'ketner-bot-frame';
    panel.style.cssText =
      'position:fixed;right:16px;bottom:76px;z-index:2147483647;display:none;' +
      'width:min(400px,calc(100vw - 16px));height:min(620px,calc(100dvh - 96px));' +
      'border-radius:16px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.22);background:' +
      (theme === 'dark' ? '#1b1d1c' : '#fff') +
      ';';
    if (window.innerWidth < 480) panel.style.right = '8px';
    var frame = document.createElement('iframe');
    frame.src = origin + '/b/' + encodeURIComponent(slug) + '?embed=1&theme=' + theme;
    frame.title = label;
    frame.setAttribute('allow', 'clipboard-write');
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block;';
    panel.appendChild(frame);
    document.body.appendChild(panel);
  }

  function setOpen(open) {
    if (open && !panel) build();
    if (!panel) return;
    panel.style.display = open ? 'block' : 'none';
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.textContent = open ? '×' : label;
    button.setAttribute('aria-label', open ? closeLabel : label);
    button.style.padding = open ? '0' : '0 20px';
    button.style.width = open ? '48px' : 'auto';
    button.style.fontSize = open ? '26px' : '15px';
  }

  button.addEventListener('click', function () {
    setOpen(!panel || panel.style.display === 'none');
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && panel && panel.style.display !== 'none') {
      setOpen(false);
      button.focus();
    }
  });

  function mount() {
    document.body.appendChild(button);
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
