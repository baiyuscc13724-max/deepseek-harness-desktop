'use strict';
// Only bootstrap/store/slot adapters. No layout function, CSS or product DOM replacement.
const R=shippedModules.react, RD=shippedModules['react-dom'], RC=shippedModules['react-dom/client'];
const L=products['@deepseek-ai/dsh-client-ui-layout'].audit;
const C=products['@deepseek-ai/dsh-client-ui-conversation'].audit;
const CP=products['@deepseek-ai/dsh-client-ui-conversation'];
const H=products['@deepseek-ai/dsh-client-ui-chat'].audit;
const HP=products['@deepseek-ai/dsh-client-ui-chat'];
const S=shippedModules['@deepseek-ai/dsh-client-store'];
const h=R.createElement;
window.trace=[];window.auditSnapshotCalls=0;
const mark=(type,value)=>trace.push({type,value,t:performance.now(),timeOrigin:performance.timeOrigin});
addEventListener('resize',()=>mark('guest-resize',{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}));
const themeContext=new shippedModules['@deepseek-ai/cordis'].Context();
const presenter=new L.ThemePresenter();let themeFiber;
window.auditTheme=(fontSize=14)=>{presenter.apply({active:{colorScheme:'light',tokens:{}},fontSize});mark('actual-theme-presenter',{fontSize});};
window.auditInstallTheme=()=>{themeFiber=themeContext.plugin(products['@deepseek-ai/dsh-client-ui-theme'].audit.installThemeStyles);auditTheme();mark('actual-theme-styles',{});};
const store=initial=>{const s=S.createSnapshotStore(initial);s.use=(sel=x=>x)=>sel(R.useSyncExternalStore(s.subscribe,s.getSnapshot));return s;};
// Product store factory is instantiated as-is, not a reimplementation of actions.
window.layoutHandle=L.createLayoutStore();
window.storeShape={keys:Object.keys(layoutHandle),symbols:Object.getOwnPropertySymbols(layoutHandle).map(String),storeKeys:Object.keys(S)};
const panels=layoutHandle.create();
storeShape.instance=Object.keys(panels);
panels.use=(sel=x=>x)=>sel(R.useSyncExternalStore(panels.subscribe,panels.getSnapshot));
const layoutActions=Object.fromEntries(Object.entries(panels.actions).map(([key,fn])=>[key,(...args)=>{const value=fn(...args);mark('panel-action',{key,args,panels:panels.getSnapshot()});return value;}]));
window.layoutActions=layoutActions;
const session=store({id:'synthetic-a',blank:false,awaitingFirstTurn:false,promptAttempted:true,running:false,openState:'open',openError:null,hasMore:false,loadingOlder:false,queue:[],pendingSubmissions:[],promptError:null,subagent:null,removed:false});
const summaries=store({current:'synthetic-a',byId:{'synthetic-a':{id:'synthetic-a',title:'SYNTHETIC APPFRAME AUDIT A',displayTitle:'SYNTHETIC APPFRAME AUDIT A',blank:false,origin:'user',cwd:'/synthetic'},'synthetic-b':{id:'synthetic-b',title:'SYNTHETIC APPFRAME AUDIT B',displayTitle:'SYNTHETIC APPFRAME AUDIT B',blank:false,origin:'user',cwd:'/synthetic'}}});
const conversation=store({...CP.EMPTY_CONVERSATION_SNAPSHOT,activeTargets:new Set(['chat'])});
const workspaces=store({phase:'ready',items:[{workspaceId:'synthetic-workspace',title:'SYNTHETIC DATA ONLY',sessionIds:['synthetic-a','synthetic-b']}]});
const viewState=store({view:'chat',draft:'',viewRequest:null});
const chatState=store({selection:null,turnProcesses:[]});
const keyboard=new C.SessionInputShell({inputTriggers:()=>undefined,popup:()=>undefined,defaultSink:()=>{throw Error('BUSINESS_SUBMIT_DENIED')}});
const inputUse=sel=>sel(R.useSyncExternalStore(keyboard.state.subscribe,keyboard.state.getSnapshot));
const no=()=>null,deny=name=>()=>{throw Error('FIXTURE_CAPABILITY_DENIED:'+name)};
const t=(key,args={})=>Object.entries(args).reduce((v,[k,x])=>v.replaceAll('{'+k+'}',String(x)),C.zh[key]??H.zh[key]??key);
let id='synthetic-a',nodes=new Map(),scroll=null;
const chat=store({...HP.EMPTY_CHAT_SNAPSHOT});
function messages(long=false){nodes=new Map(Array.from({length:long?12:2},(_,i)=>{const key='synthetic-message-'+i;return[key,{key,kind:'user-message',anchorSeq:i+1,data:{content:[{type:'text',text:long?('SYNTHETIC bounded long message '+i+' 中文 text only. ').repeat(35):'SYNTHETIC message '+i+' — not a user transcript.'}],time:1700000000000+i*1000}}]}));chat.set({...HP.EMPTY_CHAT_SNAPSHOT,order:[...nodes.keys()],nodes:{get:key=>nodes.get(key),values:()=>[...nodes.values()]}})}
messages(false);
const neutral=store(undefined),pending=store(new Map()),views=store([{id:'chat',label:'对话'}]);
const common=()=>({sessionId:id,useSession:session.use,useSessions:summaries.use,useConversation:conversation.use,useInput:inputUse,useWorkspaces:workspaces.use,useSessionPendingInteraction:pending.use,useComposerBlock:neutral.use,t,renderSlot:slot,renderSlotChain:(_name,_props,options)=>options.fallback,useConversationViews:views.use,useStore:viewState.use,inputActions:keyboard.actions,actions:{setDraft:value=>viewState.set({...viewState.getSnapshot(),draft:value}),completeViewRequest:()=>{}},bindDraftMirror:write=>keyboard.bindMirror(write),openView:deny('openView'),selectView:deny('selectView'),open:deny('open-session'),selectWorkspace:deny('workspace')});
function slot(name,props={},options={}){
 switch(name){
 case 'sidebar': return h('span',{'data-synthetic-sidebar-label':''},'SYNTHETIC DATA ONLY');
 case 'conversation':return h(C.ConversationRoot,common());
 case 'conversation.session.header':return h(C.ConversationSessionHeader,common());
 case 'conversation.session':return h(C.ConversationSession,common());
 case 'conversation.composer.bar':return h(C.InputBar,{...common(),...props,keyboard,useNotices:sel=>sel(R.useSyncExternalStore(keyboard.notices.subscribe,keyboard.notices.getSnapshot)),useLexicon:sel=>sel(keyboard.lexicon.getSnapshot()),useMenuLauncher:sel=>sel(null),useProjection:(_key,sel)=>sel?sel(undefined):undefined,resolveSubmitMode:()=> 'queue'});
 case 'conversation.view':return h(H.ChatView,{...common(),useChat:chat.use,useChatNode:key=>nodes.get(key),useChatNodeProcess:()=>undefined,useStore:chatState.use,actions:{setTurnProcessOpen:deny('turn-process')},openFile:deny('file'),loadOlder:deny('history'),loadThrough:deny('history-through'),loadImage:deny('image'),chatScroll:{read:()=>scroll,save:v=>{scroll=v}},forkAt:deny('fork'),fileMentions:undefined,useTranscriptView:sel=>sel('normal'),useProjection:()=>undefined});
 case 'conversation.chat.node':return h(H.UserMessageNodeView,{...props,t});
 case 'details':return h(H.DetailsPanel,{sessionId:id,useChat:chat.use,useSessions:summaries.use,useStore:chatState.use,renderSlot:slot,closeDetails:layoutActions.closeDetails,t});
 default:return options.fallback??null;
 }
}
const root=RC.createRoot(document.getElementById('root'));
function render(){root.render(h(L.AppFrame,{useStore:panels.use,useSessions:summaries.use,actions:layoutActions,renderSlot:slot,SessionProvider:({children})=>children,t}));}
window.auditSet=({blank=false,long=false,nextId=id}={})=>{id=nextId;const byId={...summaries.getSnapshot().byId};byId[id]={...byId[id],blank};summaries.set({current:id,byId});session.set({...session.getSnapshot(),id,blank,awaitingFirstTurn:blank,promptAttempted:!blank});conversation.set({...CP.EMPTY_CONVERSATION_SNAPSHOT,activeTargets:new Set(blank?[]:['chat'])});messages(long);render();mark('data-seed',{id,blank,long});};
window.auditUnmount=async()=>{root.unmount();keyboard.dispose();presenter.dispose();await themeFiber.dispose();mark('unmount',{});return{remainingThemeStyles:document.querySelectorAll('style[data-plugin="@deepseek-ai/dsh-client-ui-theme"]').length};};
window.auditPassive=()=>({t:performance.now(),timeOrigin:performance.timeOrigin,trace:trace.slice(),panels:panels.getSnapshot(),style:document.querySelector('.pI_x6G_frame')?.getAttribute('style'),ready:!!document.querySelector('[data-composer-input]'),errors:auditErrors.slice()});
window.auditSnapshot=()=>{auditSnapshotCalls++;const rect=selector=>{const el=document.querySelector(selector);if(!el)return null;const r=el.getBoundingClientRect().toJSON(),style=getComputedStyle(el);return{...r,background:style.backgroundColor,display:style.display,visibility:style.visibility,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}};const result={t:performance.now(),timeOrigin:performance.timeOrigin,width:innerWidth,height:innerHeight,dpr:devicePixelRatio,hidden:document.hidden,panels:panels.getSnapshot(),snapshotCalls:auditSnapshotCalls,body:rect('body'),root:rect('#root'),frame:rect('.pI_x6G_frame'),sidebar:rect('.pI_x6G_sidebarCol'),center:rect('.pI_x6G_centerCol'),details:rect('.pI_x6G_detailsCol'),conversation:rect('[data-phase]'),scroller:rect('[data-conversation-scroll]'),view:rect('[data-conversation-view]'),content:rect('[data-chat-flow]'),composer:rect('[data-composer-seat]'),input:rect('[data-composer-input]'),grid:document.querySelector('.pI_x6G_frame')?getComputedStyle(document.querySelector('.pI_x6G_frame')).gridTemplateColumns:null,css:document.querySelector('[data-phase]')?.getAttribute('style'),hit820:document.elementsFromPoint(Math.min(innerWidth-1,820),20).map(el=>({tag:el.tagName,class:el.className})),trace:trace.slice(),errors:auditErrors.slice(),ports:portAttempts.slice()};mark('explicit-rect-read',{call:auditSnapshotCalls});return result;};
render();mark('mounted',{react:R.version,cordis:!!shippedModules['@deepseek-ai/cordis'],store:true});
void 0;
