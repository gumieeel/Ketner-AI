import{i as e,n as t,t as n}from"./jsx-runtime-Dk72oS4N.js";import{$ as r,At as i,D as a,Ft as o,H as s,J as c,M as l,W as u,Y as d,Z as f,d as p,h as m,ht as h,lt as g,mt as _,nn as v,o as y,qt as b}from"./index-TY-zW6cu.js";import{t as x}from"./clipboard-COsEZvbV.js";import{t as S}from"./copy-button-CdsfaekF.js";import{t as C}from"./callout-2KVPV_GK.js";import{a as w,i as T,n as E,r as D,s as O,t as k}from"./use-scroll-spy-C51PkN4V.js";import{t as A}from"./rich-text-C3Ne62hs.js";var j=e(t(),1);async function M(e,t={}){let n=t.body===void 0?{}:{"Content-Type":`application/json`},r=s();r&&(n.Authorization=`Bearer ${r}`);let i=await fetch(`${f}${e}`,{...t,headers:n,credentials:`include`});if(d(i),!i.ok){let e=`unknown_error`,t=`Запрос завершился со статусом ${i.status}`;try{let n=await i.json();e=n.error?.code??e,t=n.error?.message??t}catch{}throw new c(e,t,i.status)}return await i.json()}var N={list:async()=>(await M(`/keys`)).keys,create:e=>M(`/keys`,{method:`POST`,body:JSON.stringify({name:e})}),revoke:e=>M(`/keys/${encodeURIComponent(e)}`,{method:`DELETE`})};function P(){return`${typeof window<`u`?window.location.origin:`https://ketner.org`}/v1`}var F=n();function I({onSecretCreated:e}){let{t,language:n}=r(),s=u(e=>e.status),l=u(e=>e.user),d=s===`authenticated`&&!!l,f=(0,j.useId)(),[h,b]=(0,j.useState)([]),[S,T]=(0,j.useState)(!1),[E,D]=(0,j.useState)(null),[O,k]=(0,j.useState)(!1),[M,P]=(0,j.useState)(``),[I,L]=(0,j.useState)(!1),[R,z]=(0,j.useState)(null),[B,V]=(0,j.useState)(!1),[H,U]=(0,j.useState)(null);(0,j.useEffect)(()=>{if(!d)return;let e=!1;return T(!0),N.list().then(t=>{e||b(t)}).catch(()=>{e||D(t(`dev.keysLoadError`))}).finally(()=>{e||T(!1)}),()=>{e=!0}},[d]);let W=async n=>{n.preventDefault(),L(!0),D(null);try{let t=await N.create(M.trim());b(e=>[t.key,...e]),z(t.secret),e(t.secret),P(``),k(!1)}catch(e){D(e instanceof c?e.message:t(`dev.keysLoadError`))}finally{L(!1)}},G=async e=>{L(!0),D(null);try{await N.revoke(e),b(t=>t.filter(t=>t.id!==e)),U(null)}catch(e){D(e instanceof c?e.message:t(`dev.keysLoadError`))}finally{L(!1)}};return(0,F.jsxs)(w,{id:`keys`,icon:(0,F.jsx)(i,{className:`size-5`}),title:t(`dev.keysTitle`),description:t(`dev.keysDesc`),aside:d&&!O?(0,F.jsx)(m,{size:`sm`,onClick:()=>k(!0),leftIcon:(0,F.jsx)(o,{className:`size-3.5`}),children:t(`dev.keysCreate`)}):null,children:[d?null:(0,F.jsxs)(`div`,{className:`flex flex-col items-start gap-3 rounded-lg border border-stroke bg-canvas p-4`,children:[(0,F.jsx)(`p`,{className:`text-[15px] text-text`,children:t(`dev.keysSignIn`)}),(0,F.jsx)(v,{to:`/login`,className:a({size:`sm`}),children:t(`dev.keysSignInCta`)})]}),R?(0,F.jsxs)(`div`,{role:`status`,className:`flex flex-col gap-3 rounded-lg border border-accent/50 bg-accent-soft p-4`,children:[(0,F.jsxs)(`div`,{children:[(0,F.jsx)(`p`,{className:`font-medium text-text`,children:t(`dev.keysNewTitle`)}),(0,F.jsx)(`p`,{className:`mt-1 text-[14px] text-muted`,children:t(`dev.keysNewText`)})]}),(0,F.jsx)(`code`,{tabIndex:0,className:`block overflow-x-auto rounded-md border border-stroke bg-surface px-3 py-2.5 font-mono text-[13px] whitespace-nowrap text-text select-all`,children:R}),(0,F.jsxs)(`div`,{className:`flex flex-wrap gap-2`,children:[(0,F.jsx)(m,{size:`sm`,onClick:async()=>{R&&(await x(R),V(!0),window.setTimeout(()=>V(!1),2e3))},leftIcon:B?(0,F.jsx)(g,{className:`size-3.5`}):(0,F.jsx)(_,{className:`size-3.5`}),children:t(B?`dev.keysCopied`:`dev.keysCopy`)}),(0,F.jsx)(m,{size:`sm`,variant:`outline`,onClick:()=>{z(null),V(!1)},children:t(`dev.keysDone`)})]})]}):null,O?(0,F.jsxs)(`form`,{onSubmit:W,className:`flex flex-col gap-2 rounded-lg border border-stroke bg-canvas p-3 @md:flex-row @md:items-end`,children:[(0,F.jsxs)(`div`,{className:`flex min-w-0 flex-1 flex-col gap-1.5`,children:[(0,F.jsx)(`label`,{htmlFor:f,className:`text-[13px] font-medium text-text`,children:t(`dev.keysName`)}),(0,F.jsx)(y,{id:f,required:!0,autoFocus:!0,maxLength:60,value:M,onChange:e=>P(e.target.value),placeholder:t(`dev.keysNamePlaceholder`)})]}),(0,F.jsxs)(`div`,{className:`flex gap-2`,children:[(0,F.jsx)(m,{type:`submit`,loading:I,disabled:I||M.trim()===``,children:t(`dev.keysSubmit`)}),(0,F.jsx)(m,{type:`button`,variant:`outline`,onClick:()=>k(!1),children:t(`dev.keysCancel`)})]})]}):null,E?(0,F.jsx)(`p`,{role:`alert`,className:`rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[14px] text-danger`,children:E}):null,d&&S?(0,F.jsx)(`p`,{className:`text-[14px] text-muted`,children:t(`dev.keysLoading`)}):null,d&&!S&&h.length===0&&!E?(0,F.jsx)(`p`,{className:`text-[14px] text-muted`,children:t(`dev.keysEmpty`)}):null,h.length>0?(0,F.jsx)(`ul`,{className:`flex flex-col divide-y divide-stroke rounded-lg border border-stroke bg-canvas`,children:h.map(e=>(0,F.jsxs)(`li`,{className:`flex flex-col gap-3 p-4 @md:flex-row @md:items-center`,children:[(0,F.jsxs)(`div`,{className:`min-w-0 flex-1`,children:[(0,F.jsx)(`p`,{className:`truncate font-medium text-text`,children:e.name}),(0,F.jsxs)(`p`,{className:`mt-1 text-[13px] text-muted`,children:[(0,F.jsxs)(`code`,{className:`font-mono text-text`,children:[e.prefix,`…`]}),` `,t(`dev.keysCreated`,{date:p(e.createdAt,n)}),`,`,` `,e.lastUsedAt?t(`dev.keysUsed`,{date:p(e.lastUsedAt,n)}):t(`dev.keysNeverUsed`)]})]}),H===e.id?(0,F.jsxs)(`div`,{className:`flex flex-wrap items-center gap-2`,children:[(0,F.jsx)(`span`,{className:`text-[13px] text-text`,children:t(`dev.keysRevokeConfirm`,{name:e.name})}),(0,F.jsx)(m,{size:`sm`,variant:`danger`,loading:I,onClick:()=>void G(e.id),children:t(`dev.keysRevokeYes`)}),(0,F.jsx)(m,{size:`sm`,variant:`outline`,onClick:()=>U(null),children:t(`dev.keysCancel`)})]}):(0,F.jsx)(m,{size:`sm`,variant:`outline`,onClick:()=>U(e.id),children:t(`dev.keysRevoke`)})]},e.id))}):null,(0,F.jsx)(C,{tone:`info`,className:`my-0`,children:(0,F.jsx)(A,{text:t(`dev.keysSafety`)})})]})}function L(e){return JSON.stringify(e).replace(/'/g,`'\\''`)}function R(e,t,n){return[{id:`curl`,label:`cURL`,language:`bash`,code:`curl ${e}/chat/completions \\
  -H "Authorization: Bearer ${t}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": ${L(n)}}]
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
console.log(reply.choices[0].message.content);`}]}function z(e,t){return[{id:`tools-curl`,label:`cURL`,language:`bash`,code:`curl ${e}/chat/completions \\
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
}`}]}function B(e,t){return[{id:`models-curl`,label:`cURL`,language:`bash`,code:`curl ${e}/models \\
  -H "Authorization: Bearer ${t}"`}]}function V(e,t){return`models:
  - name: Ketner Pro
    provider: openai
    model: ketner-pro
    apiBase: ${e}
    apiKey: ${t}
  - name: Claude Sonnet 5.5 (Ketner)
    provider: openai
    model: claude-sonnet-5.5
    apiBase: ${e}
    apiKey: ${t}`}var H=[{id:`keys`,label:`dev.navKeys`},{id:`base-url`,label:`dev.navBase`},{id:`quickstart`,label:`dev.navQuick`},{id:`editors`,label:`dev.navEditors`},{id:`endpoint-completions`,label:`dev.navCompletions`},{id:`endpoint-models`,label:`dev.navModels`}],U=l.map(e=>e.id);function W(){let{t:e}=r(),t=k(H.map(e=>e.id)),[n,i]=(0,j.useState)(null),a=P(),o=n??`ketner_sk_...`,s=H.map(t=>({id:t.id,label:e(t.label)})),c=[{name:`model`,type:`string`,required:!0,description:e(`dev.paramModel`)},{name:`messages`,type:`array`,required:!0,description:e(`dev.paramMessages`)},{name:`tools`,type:`array`,description:e(`dev.paramTools`)},{name:`tool_choice`,type:`string | object`,default:`auto`,description:e(`dev.paramToolChoice`)},{name:`stream`,type:`boolean`,default:`false`,description:e(`dev.paramStream`)},{name:`max_tokens`,type:`integer`,description:e(`dev.paramMaxTokens`)},{name:`temperature`,type:`number`,description:e(`dev.paramTemperature`)}];return(0,F.jsx)(T,{nav:s,activeId:t,children:(0,F.jsxs)(`div`,{className:`flex flex-col gap-6 md:gap-8`,children:[(0,F.jsxs)(`header`,{className:`flex flex-col gap-4 border-b border-stroke pb-6`,children:[(0,F.jsx)(`h1`,{className:`t-display text-[clamp(2.25rem,3.4vw+1rem,3.5rem)] text-text`,children:e(`dev.title`)}),(0,F.jsx)(`p`,{className:`max-w-[62ch] text-[17px] leading-relaxed text-muted`,children:e(`dev.lead`)})]}),(0,F.jsx)(I,{onSecretCreated:i}),(0,F.jsxs)(`section`,{id:`base-url`,className:`grid scroll-mt-32 grid-cols-1 gap-3 md:grid-cols-2 xl:scroll-mt-24`,children:[(0,F.jsxs)(`div`,{className:`flex flex-col gap-3 rounded-xl border border-stroke bg-surface p-5`,children:[(0,F.jsx)(`h2`,{className:`text-[17px] font-medium text-text`,children:e(`dev.baseTitle`)}),(0,F.jsxs)(`div`,{className:`flex items-center justify-between gap-2 rounded-md border border-stroke bg-canvas py-1 pr-1 pl-3`,children:[(0,F.jsx)(`code`,{className:`truncate font-mono text-[13px] text-text`,children:a}),(0,F.jsx)(S,{value:a,label:e(`dev.baseCopy`),size:`sm`})]}),(0,F.jsx)(`p`,{className:`text-[14px] leading-relaxed text-muted`,children:e(`dev.baseHint`)})]}),(0,F.jsxs)(`div`,{className:`flex flex-col gap-3 rounded-xl border border-stroke bg-surface p-5`,children:[(0,F.jsx)(`h2`,{className:`text-[17px] font-medium text-text`,children:e(`dev.modelsTitle`)}),(0,F.jsx)(`ul`,{className:`flex flex-wrap gap-1.5`,children:U.map(e=>(0,F.jsx)(`li`,{className:`rounded-xs border border-stroke bg-canvas px-2 py-1 font-mono text-[12px] text-text`,children:e},e))}),(0,F.jsx)(`p`,{className:`text-[14px] leading-relaxed text-muted`,children:e(`dev.modelsHint`)})]})]}),(0,F.jsxs)(w,{id:`quickstart`,icon:(0,F.jsx)(b,{className:`size-5`}),title:e(`dev.quickTitle`),description:e(`dev.quickDesc`),children:[n?(0,F.jsx)(`p`,{className:`text-[14px] text-muted`,children:e(`dev.quickKeyHint`)}):null,(0,F.jsx)(O,{className:`my-0`,tabs:R(a,o,e(`dev.quickPrompt`))})]}),(0,F.jsxs)(w,{id:`editors`,icon:(0,F.jsx)(h,{className:`size-5`}),title:e(`dev.editorsTitle`),description:e(`dev.editorsDesc`),children:[(0,F.jsxs)(`div`,{className:`flex flex-col gap-3 rounded-lg border border-stroke bg-canvas p-4`,children:[(0,F.jsx)(`h3`,{className:`text-[15px] font-medium text-text`,children:e(`dev.cursorTitle`)}),(0,F.jsxs)(`ol`,{className:`flex list-decimal flex-col gap-2 pl-5 text-[14px] leading-6 text-muted marker:text-subtle`,children:[(0,F.jsx)(`li`,{children:(0,F.jsx)(A,{text:e(`dev.cursor1`)})}),(0,F.jsx)(`li`,{children:(0,F.jsx)(A,{text:e(`dev.cursor2`)})}),(0,F.jsx)(`li`,{className:`break-all`,children:(0,F.jsx)(A,{text:e(`dev.cursor3`,{url:a})})}),(0,F.jsx)(`li`,{children:(0,F.jsx)(A,{text:e(`dev.cursor4`)})})]})]}),(0,F.jsxs)(`div`,{className:`flex flex-col gap-3 rounded-lg border border-stroke bg-canvas p-4`,children:[(0,F.jsx)(`h3`,{className:`text-[15px] font-medium text-text`,children:e(`dev.continueTitle`)}),(0,F.jsx)(`p`,{className:`text-[14px] text-muted`,children:(0,F.jsx)(A,{text:e(`dev.continueHint`)})}),(0,F.jsx)(O,{className:`my-0`,tabs:[{id:`continue`,label:`config.yaml`,language:`yaml`,code:V(a,o)}]})]})]}),(0,F.jsxs)(w,{id:`endpoint-completions`,icon:(0,F.jsx)(D,{method:`POST`}),bareIcon:!0,monoTitle:!0,title:`/v1/chat/completions`,description:e(`dev.navCompletions`),children:[(0,F.jsx)(`p`,{className:`max-w-[70ch] text-[15px] leading-relaxed text-muted`,children:e(`dev.completionsLead`)}),(0,F.jsxs)(`div`,{children:[(0,F.jsx)(`h3`,{className:`mb-2 text-[15px] font-medium text-text`,children:e(`dev.paramsTitle`)}),(0,F.jsx)(E,{params:c,className:`my-0`})]}),(0,F.jsxs)(`div`,{children:[(0,F.jsx)(`h3`,{className:`mb-2 text-[15px] font-medium text-text`,children:e(`dev.examplesTitle`)}),(0,F.jsx)(O,{className:`my-0`,tabs:z(a,o)})]}),(0,F.jsx)(C,{tone:`info`,title:e(`dev.errorsTitle`),className:`my-0`,children:(0,F.jsx)(A,{text:e(`dev.errorsText`)})})]}),(0,F.jsxs)(w,{id:`endpoint-models`,icon:(0,F.jsx)(D,{method:`GET`}),bareIcon:!0,monoTitle:!0,title:`/v1/models`,description:e(`dev.navModels`),children:[(0,F.jsx)(`p`,{className:`max-w-[70ch] text-[15px] leading-relaxed text-muted`,children:e(`dev.modelsEndpointLead`)}),(0,F.jsx)(O,{className:`my-0`,tabs:B(a,o)})]})]})})}export{W as ApiDocsPage};