/* Synthetic Context identity/slot registry only. The question, connection, gateway,
 * stream mux, waterfall delivery, RPC correlation and answer/result components are product code. */
window.trace=[];window.failures=[];window.presentations=[];window.removals=[];window.results=[];
window.mark=(type,data={})=>trace.push({type,t:performance.now(),...data});
addEventListener('error',e=>failures.push(e.message));addEventListener('unhandledrejection',e=>failures.push(String(e.reason)));
const nativeFetch=window.fetch.bind(window);
window.fetch=async function(input,init){
 const url=new URL(input instanceof Request?input.url:input,location.href);
 const isResult=url.pathname==='/api/$events/result';
 let body;if(isResult){body=JSON.parse(init.body);mark('rpc-submit',{rpcId:body.rpcId,eventId:body.payload.args.eventId,selected:body.payload.args.outcome.value?.answers})}
 try {const response=await nativeFetch(input,init);if(isResult){mark('http-response',{rpcId:body.rpcId,status:response.status});}return response}
 catch(error){if(isResult)mark('http-reject',{rpcId:body.rpcId,message:error.message});throw error}
};
window.React=shippedModules.react;window.ReactDOM=shippedModules['react-dom'];window.Renderer=shippedModules['react-dom/client'];
window.ctx=new shippedModules['@deepseek-ai/cordis'].Context();
window.scopes=new Map();window.scopeIds=new WeakMap();
function scope(id){if(!scopes.has(id)){const target=ctx.extend();scopes.set(id,target);scopeIds.set(target,id)}return scopes.get(id)}
ctx.provide('typert',{contexts:{getClient:kind=>kind==='agent'?{resolve:id=>scopes.get(id)}:undefined}});
ctx.provide('sessions',{scopeOf:owner=>scopeIds.get(owner)});
scope('synthetic-a');scope('synthetic-b');
modules['@deepseek-ai/dsh-client-connection'].apply(ctx);
modules['@deepseek-ai/dsh-api-gateway'].apply(ctx);
window.api=modules['@deepseek-ai/dsh-client-ui-user-questions'].fixture;
const renderer=modules['@deepseek-ai/dsh-client-ui-renderer'].fixture;
window.resultApi=modules['@deepseek-ai/dsh-client-ui-tool'].fixture;
window.stores=new Map();window.pendingBySession=new Map();window.activeSession='synthetic-a';
window.draftConfig=api.createQuestionDraftStore();
function storeFor(id){if(!stores.has(id)){const store=draftConfig.create(id);store.use=renderer.bindSnapshotSelector(store);stores.set(id,store)}return stores.get(id)}
window.domRoot=Renderer.createRoot(document.getElementById('fixture-root'));
window.resultRoot=Renderer.createRoot(document.getElementById('result-root'));
window.draw=()=>{
 const pending=pendingBySession.get(activeSession), store=storeFor(activeSession);
 const elected=pending?React.createElement(api.QuestionComposer,{matched:pending,useStore:store.use,actions:store.actions,t:key=>api.zh[key]||({submit:'提交',submitting:'提交中…'}[key])||key}):null;
 ReactDOM.flushSync(()=>domRoot.render(renderer.renderChainResult('conversation.composer',elected,{overlay:true,fallback:React.createElement('div',{'data-empty-composer':true},'Synthetic empty composer')})));
};
ctx.remote.$on('user-questions/request',function(request,next){
 const id=ctx.sessions.scopeOf(this);mark('question-received',{id,questionIds:request.questions.map(q=>q.id)});
 return api.answerQuestion(ctx,this,request,next,pending=>{
  pendingBySession.set(id,pending);presentations.push({id,key:pending.key,questions:structuredClone(pending.questions),t:performance.now()});mark('card-mounted',{id,key:pending.key});draw();
  return ()=>{if(pendingBySession.get(id)===pending)pendingBySession.delete(id);removals.push({id,key:pending.key,t:performance.now()});mark('card-removed',{id,key:pending.key});draw()};
 });
});
window.renderResult=(args,value,label)=>{
 const row=resultApi.AskQuestionRow({toolName:'ask_user_question',block:{kind:'tool_result',callId:label,call:{argsRaw:JSON.stringify(args)},content:[{type:'text',text:JSON.stringify(value)}],isError:false},t:(k,v)=>k==='ask.answered'?v.answered+'/'+v.total:k,inspect:()=>{}});
 ReactDOM.flushSync(()=>resultRoot.render(React.createElement(resultApi.AskQuestionCard,{card:row.props.askQuestion})));
 results.push({label,card:row.props.askQuestion,text:document.getElementById('result-root').textContent,t:performance.now()});mark('result-dom',{label});
};
window.selectors={options:'button[role=checkbox]',submit:'.Mbwy4a_footerActions > :last-child'};
window.state=()=>({session:activeSession,pending:pendingBySession.get(activeSession)?.key,checked:[...document.querySelectorAll('button[role=checkbox],button[role=radio]')].map(el=>el.getAttribute('aria-checked')),status:document.querySelector('[role=status]')?.textContent||'',submitDisabled:document.querySelector(selectors.submit)?.disabled??null,draft:storeFor(activeSession).getSnapshot(),generation:ctx.connection.generation.getSnapshot()?.id,connection:ctx.connection.state.getSnapshot(),presentations:presentations.length,removals:removals.length});
window.switchSession=id=>{activeSession=id;draw();mark('session-switch',{id})};
window.waitFor=async(expression,timeout=5000)=>{const start=performance.now();while(!expression()){if(performance.now()-start>timeout)throw Error('fixture condition timed out');await new Promise(r=>setTimeout(r,10))}};
document.addEventListener('click',event=>{const button=event.target.closest('button');if(button)mark('ui-click',{trusted:event.isTrusted,role:button.getAttribute('role'),text:button.textContent})},true);
ctx.connection.state.subscribe(()=>mark('connection-state',{state:ctx.connection.state.getSnapshot(),generation:ctx.connection.generation.getSnapshot()?.id}));
window.__fixtureReady=true;draw();
