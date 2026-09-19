// Synthetic state/transport adapters only. All editing, keymaps and DOM components are shipped product functions.
window.api=product.clipboardAudit;
window.domRoot=Renderer.createRoot(document.getElementById('fixture-root'));
window.shells={};window.sends=[];window.current=null;window.options={};
const sessionState={promptError:null,running:false,subagent:null,removed:false};
window.surface=()=>document.querySelector('[data-composer-input]');
window.delay=()=>new Promise(resolve=>setTimeout(resolve,40));
window.mount=(id,opts={})=>{
  if(!shells[id])shells[id]=new api.SessionInputShell({inputTriggers:()=>undefined,popup:()=>undefined,defaultSink:(...args)=>{sends.push(args.slice(0,3));return Promise.resolve({kind:'success'})}});
  current=shells[id];options=opts;
  const chosen=current;
  const useInput=select=>{const state=React.useSyncExternalStore(chosen.state.subscribe,chosen.state.getSnapshot);return select(opts.phase?{...state,phase:opts.phase}:state)};
  const useNotices=select=>select(React.useSyncExternalStore(chosen.notices.subscribe,chosen.notices.getSnapshot));
  const useProjection=(_key,select)=>select?select(undefined):undefined;
  ReactDOM.flushSync(()=>domRoot.render(React.createElement(api.InputBar,{
    sessionId:id,variant:'composer',keyboard:chosen,inputActions:chosen.actions,useInput,useNotices,
    useSession:select=>select({...sessionState,removed:!!opts.removed}),
    useLexicon:select=>select(chosen.lexicon.getSnapshot()),useMenuLauncher:select=>select(null),
    useProjection,resolveSubmitMode:()=> 'queue',renderSlot:()=>null,t:key=>key,
    disabled:!!opts.disabled,blocked:opts.blocked
  })));
};
window.seed=text=>current.setDraft(text);
window.selectText=(start,end)=>{
  current.editor.update(()=>{const text=api.root().getFirstDescendant();if(!text||typeof text.select!=='function')throw Error('Missing real Lexical text selection');text.select(start,end)}, {discrete:true});
};
window.data=values=>{const transfer=new DataTransfer();for(const [type,text] of Object.entries(values))transfer.setData(type,text);return transfer;};
window.emit=(type,values={})=>{const transfer=data(values),event=new ClipboardEvent(type,{clipboardData:transfer,bubbles:true,cancelable:true});surface().dispatchEvent(event);return{data:transfer,event};};
void 0;
