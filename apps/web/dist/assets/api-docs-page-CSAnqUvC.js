import{i as e,n as t,t as n}from"./jsx-runtime-de8dDx6i.js";import{G as r,L as i,at as a,d as o,v as s,y as c}from"./icons-DOnxWhrU.js";import{a as l,c as u,i as d,n as f,r as p,s as m,t as h}from"./use-scroll-spy-C7jO7SZj.js";import{n as g,t as _}from"./copy-button-DHQxBGiT.js";import{Ht as v,Mt as y,Rt as b,jt as x,u as S}from"./index-DfJnk530.js";import{c as C,l as w,r as T,t as E}from"./auth-store-C7aon5Pw.js";import{t as D}from"./api-config-91jwmUBU.js";import{t as O}from"./model-catalog-D_d3pAKx.js";import{n as k}from"./i18n--dx71jNZ.js";import{t as A}from"./chunk-OB3PAWPO-C0puDgV-.js";var j=e(t(),1),M=n(),N=/(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\])/g;function P({text:e}){let t=e.split(N);return(0,M.jsx)(M.Fragment,{children:t.map((e,t)=>e.startsWith(`**`)&&e.endsWith(`**`)&&e.length>4?(0,M.jsx)(`strong`,{className:`font-semibold text-text`,children:e.slice(2,-2)},t):e.startsWith("`")&&e.endsWith("`")&&e.length>2?(0,M.jsx)(`code`,{className:`font-mono text-[0.92em] text-text break-words`,children:e.slice(1,-1)},t):e.startsWith(`[[`)&&e.endsWith(`]]`)?(0,M.jsx)(v,{children:e.slice(2,-2)},t):e)})}async function F(e,t={}){let n=t.body===void 0?{}:{"Content-Type":`application/json`},r=E();r&&(n.Authorization=`Bearer ${r}`);let i=await fetch(`${D}${e}`,{...t,headers:n,credentials:`include`});if(w(i),!i.ok){let e=`unknown_error`,t=`Запрос завершился со статусом ${i.status}`;try{let n=await i.json();e=n.error?.code??e,t=n.error?.message??t}catch{}throw new C(e,t,i.status)}return await i.json()}var I={list:async()=>(await F(`/keys`)).keys,create:e=>F(`/keys`,{method:`POST`,body:JSON.stringify({name:e})}),revoke:e=>F(`/keys/${encodeURIComponent(e)}`,{method:`DELETE`})};function L(){return`${typeof window<`u`?window.location.origin:`https://ketner.org`}/v1`}function R({onSecretCreated:e}){let{t,language:n}=k(),a=T(e=>e.status),c=T(e=>e.user),d=a===`authenticated`&&!!c,f=(0,j.useId)(),[p,m]=(0,j.useState)([]),[h,_]=(0,j.useState)(!1),[v,w]=(0,j.useState)(null),[E,D]=(0,j.useState)(!1),[O,N]=(0,j.useState)(``),[F,L]=(0,j.useState)(!1),[R,z]=(0,j.useState)(null),[B,V]=(0,j.useState)(!1),[H,U]=(0,j.useState)(null);(0,j.useEffect)(()=>{if(!d)return;let e=!1;return _(!0),I.list().then(t=>{e||m(t)}).catch(()=>{e||w(t(`dev.keysLoadError`))}).finally(()=>{e||_(!1)}),()=>{e=!0}},[d]);let W=async n=>{n.preventDefault(),L(!0),w(null);try{let t=await I.create(O.trim());m(e=>[t.key,...e]),z(t.secret),e(t.secret),N(``),D(!1)}catch(e){w(e instanceof C?e.message:t(`dev.keysLoadError`))}finally{L(!1)}},G=async e=>{L(!0),w(null);try{await I.revoke(e),m(t=>t.filter(t=>t.id!==e)),U(null)}catch(e){w(e instanceof C?e.message:t(`dev.keysLoadError`))}finally{L(!1)}};return(0,M.jsxs)(l,{id:`keys`,icon:(0,M.jsx)(i,{className:`size-5`}),title:t(`dev.keysTitle`),description:t(`dev.keysDesc`),aside:d&&!E?(0,M.jsx)(x,{size:`sm`,onClick:()=>D(!0),leftIcon:(0,M.jsx)(r,{className:`size-3.5`}),children:t(`dev.keysCreate`)}):null,children:[d?null:(0,M.jsxs)(`div`,{className:`flex flex-col items-start gap-3 rounded-lg border border-stroke bg-canvas p-4`,children:[(0,M.jsx)(`p`,{className:`text-[15px] text-text`,children:t(`dev.keysSignIn`)}),(0,M.jsx)(A,{to:`/login`,className:y({size:`sm`}),children:t(`dev.keysSignInCta`)})]}),R?(0,M.jsxs)(`div`,{role:`status`,className:`flex flex-col gap-3 rounded-lg border border-accent/50 bg-accent-soft p-4`,children:[(0,M.jsxs)(`div`,{children:[(0,M.jsx)(`p`,{className:`font-medium text-text`,children:t(`dev.keysNewTitle`)}),(0,M.jsx)(`p`,{className:`mt-1 text-[14px] text-muted`,children:t(`dev.keysNewText`)})]}),(0,M.jsx)(`code`,{tabIndex:0,className:`block overflow-x-auto rounded-md border border-stroke bg-surface px-3 py-2.5 font-mono text-[13px] whitespace-nowrap text-text select-all`,children:R}),(0,M.jsxs)(`div`,{className:`flex flex-wrap gap-2`,children:[(0,M.jsx)(x,{size:`sm`,onClick:async()=>{R&&(await g(R),V(!0),window.setTimeout(()=>V(!1),2e3))},leftIcon:B?(0,M.jsx)(o,{className:`size-3.5`}):(0,M.jsx)(s,{className:`size-3.5`}),children:t(B?`dev.keysCopied`:`dev.keysCopy`)}),(0,M.jsx)(x,{size:`sm`,variant:`outline`,onClick:()=>{z(null),V(!1)},children:t(`dev.keysDone`)})]})]}):null,E?(0,M.jsxs)(`form`,{onSubmit:W,className:`flex flex-col gap-2 rounded-lg border border-stroke bg-canvas p-3 @md:flex-row @md:items-end`,children:[(0,M.jsxs)(`div`,{className:`flex min-w-0 flex-1 flex-col gap-1.5`,children:[(0,M.jsx)(`label`,{htmlFor:f,className:`text-[13px] font-medium text-text`,children:t(`dev.keysName`)}),(0,M.jsx)(S,{id:f,required:!0,autoFocus:!0,maxLength:60,value:O,onChange:e=>N(e.target.value),placeholder:t(`dev.keysNamePlaceholder`)})]}),(0,M.jsxs)(`div`,{className:`flex gap-2`,children:[(0,M.jsx)(x,{type:`submit`,loading:F,disabled:F||O.trim()===``,children:t(`dev.keysSubmit`)}),(0,M.jsx)(x,{type:`button`,variant:`outline`,onClick:()=>D(!1),children:t(`dev.keysCancel`)})]})]}):null,v?(0,M.jsx)(`p`,{role:`alert`,className:`rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[14px] text-danger`,children:v}):null,d&&h?(0,M.jsx)(`p`,{className:`text-[14px] text-muted`,children:t(`dev.keysLoading`)}):null,d&&!h&&p.length===0&&!v?(0,M.jsx)(`p`,{className:`text-[14px] text-muted`,children:t(`dev.keysEmpty`)}):null,p.length>0?(0,M.jsx)(`ul`,{className:`flex flex-col divide-y divide-stroke rounded-lg border border-stroke bg-canvas`,children:p.map(e=>(0,M.jsxs)(`li`,{className:`flex flex-col gap-3 p-4 @md:flex-row @md:items-center`,children:[(0,M.jsxs)(`div`,{className:`min-w-0 flex-1`,children:[(0,M.jsx)(`p`,{className:`truncate font-medium text-text`,children:e.name}),(0,M.jsxs)(`p`,{className:`mt-1 text-[13px] text-muted`,children:[(0,M.jsxs)(`code`,{className:`font-mono text-text`,children:[e.prefix,`…`]}),` `,t(`dev.keysCreated`,{date:b(e.createdAt,n)}),`,`,` `,e.lastUsedAt?t(`dev.keysUsed`,{date:b(e.lastUsedAt,n)}):t(`dev.keysNeverUsed`)]})]}),H===e.id?(0,M.jsxs)(`div`,{className:`flex flex-wrap items-center gap-2`,children:[(0,M.jsx)(`span`,{className:`text-[13px] text-text`,children:t(`dev.keysRevokeConfirm`,{name:e.name})}),(0,M.jsx)(x,{size:`sm`,variant:`danger`,loading:F,onClick:()=>void G(e.id),children:t(`dev.keysRevokeYes`)}),(0,M.jsx)(x,{size:`sm`,variant:`outline`,onClick:()=>U(null),children:t(`dev.keysCancel`)})]}):(0,M.jsx)(x,{size:`sm`,variant:`outline`,onClick:()=>U(e.id),children:t(`dev.keysRevoke`)})]},e.id))}):null,(0,M.jsx)(u,{tone:`info`,className:`my-0`,children:(0,M.jsx)(P,{text:t(`dev.keysSafety`)})})]})}function z(e){return JSON.stringify(e).replace(/'/g,`'\\''`)}function B(e,t,n){return[{id:`curl`,label:`cURL`,language:`bash`,code:`curl ${e}/chat/completions \\
  -H "Authorization: Bearer ${t}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": ${z(n)}}]
  }'`},{id:`python`,label:`Python`,language:`python`,code:`# pip install openai
import os
from openai import OpenAI

client = OpenAI(
    base_url="${e}",
    api_key=os.environ["KETNER_API_KEY"],
)

stream = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": ${JSON.stringify(n)}}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")`},{id:`javascript`,label:`JavaScript`,language:`javascript`,code:`// npm install openai
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: '${e}',
  apiKey: process.env.KETNER_API_KEY,
});

const reply = await client.chat.completions.create({
  model: 'auto',
  messages: [{ role: 'user', content: ${JSON.stringify(n)} }],
});
console.log(reply.choices[0].message.content);`}]}function V(e,t){return[{id:`tools-curl`,label:`cURL`,language:`bash`,code:`curl ${e}/chat/completions \\
  -H "Authorization: Bearer ${t}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "ketner-pro",
    "messages": [{"role": "user", "content": "Прочитай src/app.ts и найди ошибку"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "read_file",
        "description": "Прочитать файл проекта",
        "parameters": {
          "type": "object",
          "properties": {"path": {"type": "string"}},
          "required": ["path"]
        }
      }
    }]
  }'`},{id:`tools-reply`,label:`Ответ`,language:`json`,code:`{
  "object": "chat.completion",
  "model": "ketner-pro",
  "choices": [{
    "index": 0,
    "finish_reason": "tool_calls",
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_1",
        "type": "function",
        "function": {"name": "read_file", "arguments": "{\\"path\\":\\"src/app.ts\\"}"}
      }]
    }
  }]
}`}]}function H(e,t){return[{id:`json-python`,label:`Python`,language:`python`,code:`import json, os
from openai import OpenAI

client = OpenAI(base_url="${e}", api_key=os.environ["KETNER_API_KEY"])

reply = client.chat.completions.create(
    model="ketner-pro",
    messages=[{"role": "user", "content": "Отзыв: «Доставили быстро, но коробка мятая»"}],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "review",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "sentiment": {"type": "string", "enum": ["positive", "neutral", "negative"]},
                    "issues": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["sentiment", "issues"],
                "additionalProperties": False,
            },
        },
    },
)
print(json.loads(reply.choices[0].message.content))`},{id:`json-curl`,label:`cURL`,language:`bash`,code:`curl ${e}/chat/completions \\
  -H "Authorization: Bearer ${t}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "ketner-pro",
    "messages": [{"role": "user", "content": "Три идеи для стартапа, JSON: {\\"ideas\\": [...]}"}],
    "response_format": {"type": "json_object"}
  }'`}]}function U(e,t){return[{id:`models-curl`,label:`cURL`,language:`bash`,code:`curl ${e}/models \\
  -H "Authorization: Bearer ${t}"`}]}function W(e,t){return`models:
  - name: Ketner Pro
    provider: openai
    model: ketner-pro
    apiBase: ${e}
    apiKey: ${t}
  - name: Claude Sonnet 5.5 (Ketner)
    provider: openai
    model: claude-sonnet-5.5
    apiBase: ${e}
    apiKey: ${t}`}var G=[{id:`keys`,label:`dev.navKeys`},{id:`base-url`,label:`dev.navBase`},{id:`quickstart`,label:`dev.navQuick`},{id:`editors`,label:`dev.navEditors`},{id:`endpoint-completions`,label:`dev.navCompletions`},{id:`endpoint-models`,label:`dev.navModels`}],K=O.map(e=>e.id);function q(){let{t:e}=k(),t=h(G.map(e=>e.id)),[n,r]=(0,j.useState)(null),i=L(),o=n??`ketner_sk_...`,s=G.map(t=>({id:t.id,label:e(t.label)})),g=[{name:`model`,type:`string`,required:!0,description:e(`dev.paramModel`)},{name:`messages`,type:`array`,required:!0,description:e(`dev.paramMessages`)},{name:`tools`,type:`array`,description:e(`dev.paramTools`)},{name:`tool_choice`,type:`string | object`,default:`auto`,description:e(`dev.paramToolChoice`)},{name:`stream`,type:`boolean`,default:`false`,description:e(`dev.paramStream`)},{name:`max_tokens`,type:`integer`,description:e(`dev.paramMaxTokens`)},{name:`temperature`,type:`number`,description:e(`dev.paramTemperature`)},{name:`top_p`,type:`number`,description:e(`dev.paramTopP`)},{name:`stop`,type:`string | array`,description:e(`dev.paramStop`)},{name:`seed`,type:`integer`,description:e(`dev.paramSeed`)},{name:`frequency_penalty, presence_penalty`,type:`number`,default:`0`,description:e(`dev.paramPenalties`)},{name:`response_format`,type:`object`,description:e(`dev.paramResponseFormat`)},{name:`stream_options`,type:`object`,description:e(`dev.paramStreamOptions`)}];return(0,M.jsx)(d,{nav:s,activeId:t,children:(0,M.jsxs)(`div`,{className:`flex flex-col gap-6 md:gap-8`,children:[(0,M.jsxs)(`header`,{className:`flex flex-col gap-4 border-b border-stroke pb-6`,children:[(0,M.jsx)(`h1`,{className:`t-display text-[clamp(2.25rem,3.4vw+1rem,3.5rem)] text-text`,children:e(`dev.title`)}),(0,M.jsx)(`p`,{className:`max-w-[62ch] text-[17px] leading-relaxed text-muted`,children:e(`dev.lead`)})]}),(0,M.jsx)(R,{onSecretCreated:r}),(0,M.jsxs)(`section`,{id:`base-url`,className:`grid scroll-mt-32 grid-cols-1 gap-3 md:grid-cols-2 xl:scroll-mt-24`,children:[(0,M.jsxs)(`div`,{className:`flex flex-col gap-3 rounded-xl border border-stroke bg-surface p-5`,children:[(0,M.jsx)(`h2`,{className:`text-[17px] font-medium text-text`,children:e(`dev.baseTitle`)}),(0,M.jsxs)(`div`,{className:`flex items-center justify-between gap-2 rounded-md border border-stroke bg-canvas py-1 pr-1 pl-3`,children:[(0,M.jsx)(`code`,{className:`truncate font-mono text-[13px] text-text`,children:i}),(0,M.jsx)(_,{value:i,label:e(`dev.baseCopy`),size:`sm`})]}),(0,M.jsx)(`p`,{className:`text-[14px] leading-relaxed text-muted`,children:e(`dev.baseHint`)})]}),(0,M.jsxs)(`div`,{className:`flex flex-col gap-3 rounded-xl border border-stroke bg-surface p-5`,children:[(0,M.jsx)(`h2`,{className:`text-[17px] font-medium text-text`,children:e(`dev.modelsTitle`)}),(0,M.jsx)(`ul`,{className:`flex flex-wrap gap-1.5`,children:K.map(e=>(0,M.jsx)(`li`,{className:`rounded-xs border border-stroke bg-canvas px-2 py-1 font-mono text-[12px] text-text`,children:e},e))}),(0,M.jsx)(`p`,{className:`text-[14px] leading-relaxed text-muted`,children:e(`dev.modelsHint`)})]})]}),(0,M.jsxs)(l,{id:`quickstart`,icon:(0,M.jsx)(a,{className:`size-5`}),title:e(`dev.quickTitle`),description:e(`dev.quickDesc`),children:[n?(0,M.jsx)(`p`,{className:`text-[14px] text-muted`,children:e(`dev.quickKeyHint`)}):null,(0,M.jsx)(m,{className:`my-0`,tabs:B(i,o,e(`dev.quickPrompt`))})]}),(0,M.jsxs)(l,{id:`editors`,icon:(0,M.jsx)(c,{className:`size-5`}),title:e(`dev.editorsTitle`),description:e(`dev.editorsDesc`),children:[(0,M.jsxs)(`div`,{className:`flex flex-col gap-3 rounded-lg border border-stroke bg-canvas p-4`,children:[(0,M.jsx)(`h3`,{className:`text-[15px] font-medium text-text`,children:e(`dev.cursorTitle`)}),(0,M.jsxs)(`ol`,{className:`flex list-decimal flex-col gap-2 pl-5 text-[14px] leading-6 text-muted marker:text-subtle`,children:[(0,M.jsx)(`li`,{children:(0,M.jsx)(P,{text:e(`dev.cursor1`)})}),(0,M.jsx)(`li`,{children:(0,M.jsx)(P,{text:e(`dev.cursor2`)})}),(0,M.jsx)(`li`,{className:`break-all`,children:(0,M.jsx)(P,{text:e(`dev.cursor3`,{url:i})})}),(0,M.jsx)(`li`,{children:(0,M.jsx)(P,{text:e(`dev.cursor4`)})})]})]}),(0,M.jsxs)(`div`,{className:`flex flex-col gap-3 rounded-lg border border-stroke bg-canvas p-4`,children:[(0,M.jsx)(`h3`,{className:`text-[15px] font-medium text-text`,children:e(`dev.continueTitle`)}),(0,M.jsx)(`p`,{className:`text-[14px] text-muted`,children:(0,M.jsx)(P,{text:e(`dev.continueHint`)})}),(0,M.jsx)(m,{className:`my-0`,tabs:[{id:`continue`,label:`config.yaml`,language:`yaml`,code:W(i,o)}]})]})]}),(0,M.jsxs)(l,{id:`endpoint-completions`,icon:(0,M.jsx)(p,{method:`POST`}),bareIcon:!0,monoTitle:!0,title:`/v1/chat/completions`,description:e(`dev.navCompletions`),children:[(0,M.jsx)(`p`,{className:`max-w-[70ch] text-[15px] leading-relaxed text-muted`,children:e(`dev.completionsLead`)}),(0,M.jsxs)(`div`,{children:[(0,M.jsx)(`h3`,{className:`mb-2 text-[15px] font-medium text-text`,children:e(`dev.paramsTitle`)}),(0,M.jsx)(f,{params:g,className:`my-0`})]}),(0,M.jsxs)(`div`,{children:[(0,M.jsx)(`h3`,{className:`mb-2 text-[15px] font-medium text-text`,children:e(`dev.examplesTitle`)}),(0,M.jsx)(m,{className:`my-0`,tabs:V(i,o)})]}),(0,M.jsxs)(`div`,{children:[(0,M.jsx)(`h3`,{className:`mb-2 text-[15px] font-medium text-text`,children:e(`dev.structuredTitle`)}),(0,M.jsx)(`p`,{className:`mb-3 max-w-[70ch] text-[14px] leading-relaxed text-muted`,children:(0,M.jsx)(P,{text:e(`dev.structuredText`)})}),(0,M.jsx)(m,{className:`my-0`,tabs:H(i,o)})]}),(0,M.jsx)(u,{tone:`info`,title:e(`dev.errorsTitle`),className:`my-0`,children:(0,M.jsx)(P,{text:e(`dev.errorsText`)})})]}),(0,M.jsxs)(l,{id:`endpoint-models`,icon:(0,M.jsx)(p,{method:`GET`}),bareIcon:!0,monoTitle:!0,title:`/v1/models`,description:e(`dev.navModels`),children:[(0,M.jsx)(`p`,{className:`max-w-[70ch] text-[15px] leading-relaxed text-muted`,children:e(`dev.modelsEndpointLead`)}),(0,M.jsx)(m,{className:`my-0`,tabs:U(i,o)})]})]})})}export{q as ApiDocsPage};