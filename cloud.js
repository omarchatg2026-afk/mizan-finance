/* Mizan Finance — Supabase Auth + revision-protected cloud synchronization.
   Important: security is enforced by Supabase RLS in schema.sql, not here. */
(()=>{
'use strict';
const root=document.getElementById('authRoot');
const button=document.getElementById('syncButton');
const config=window.MIZAN_CONFIG||{};
let client=null,activeUser=null,remoteRevision=0,dirty=false,syncRunning=false,conflict=false,localMode=false;
let seq=0,timer=null,lastRefresh=0,activeTask=null,authMode='login',recovery=false;
const CACHE_PREFIX='mizan_account_cache_v3_';
const LOCAL_KEY='mizan_v3_local_only';
const key=()=>activeUser?CACHE_PREFIX+activeUser.id:'';
const readableError=(e)=>{
  const msg=String(e?.message||'');
  if(/invalid login credentials/i.test(msg))return 'Incorrect email or password.';
  if(/email not confirmed/i.test(msg))return 'Please confirm your email before signing in.';
  if(/user already registered/i.test(msg))return 'This email is already registered. Try signing in.';
  if(/password/i.test(msg)&&(/weak|short|characters|least|lower/i.test(msg)))return 'Choose a strong password (at least 8 characters).';
  if(/rate limit/i.test(msg))return 'Too many attempts. Please try again later.';
  if(/failed to fetch|network|load failed|fetch failed/i.test(msg))return 'Unable to reach the internet or Supabase right now.';
  return msg.slice(0,210)||'An unexpected error occurred. Please try again.';
};
function authShell(content){root.innerHTML=`<section class="auth-card"><div class="auth-brand"><div class="mark">M</div><h1>Mizan Finance</h1><p>Your finances, organized across devices</p></div>${content}<p class="auth-help">Egyptian Pound EGP · Secure authentication by Supabase Auth<br>Your data is isolated using Row Level Security</p></section>`}
function authMessage(msg,err=false){let out=root.querySelector('#authMessage');if(!out){out=document.createElement('div');out.id='authMessage';root.querySelector('.auth-card')?.insertBefore(out,root.querySelector('.auth-help'))}out.className='auth-message'+(err?' error':'');out.textContent=msg}
function loading(text){document.body.classList.remove('cloud-ready');authShell(`<div class="auth-spinner"></div><p style="text-align:center;color:#6e7b91;font-size:13px">${text||'Loading..'}</p>`)}
function showSetup(reason){document.body.classList.remove('cloud-ready');authShell(`<h2 style="font-size:17px;text-align:center;margin:0 0 15px">Mizan V5 — Ready to try</h2><div class="auth-message">Supabase is not connected yet. You can try Mizan in local mode without an account. To activate login, create a Supabase project, then run <b>schema.sql</b> and enter your project URL and publishable key in <b>config.js</b>.</div><p class="small muted">${reason?esc(reason):'Setup instructions are in README.md'}</p><div style="display:grid;gap:10px"><button class="btn primary" data-cloud-action="local-mode">Try local demo</button><a class="btn ghost" href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">Open Supabase Dashboard</a></div><div class="auth-help">Local mode does not sync between devices. Export a JSON backup before clearing your browser or moving to cloud. Never place secret/service_role key on GitHub.</div>`)}
function enterLocal(){localMode=true;activeUser=null;remoteRevision=0;dirty=false;conflict=false;let stored=null;try{stored=JSON.parse(localStorage.getItem(LOCAL_KEY)||'null')}catch(e){}data=validData(stored)?upgradeData(stored):fresh();setReady(true);setStatus('local');toast('Local mode active — stored in this browser only')}

function showLogin(mode='login',notice='',isError=false){
  document.body.classList.remove('cloud-ready');recovery=false;authMode=mode;
  const signup=mode==='signup';
  authShell(`<div class="auth-tabs"><button type="button" class="${!signup?'active':''}" data-cloud-action="login-tab">Sign in</button><button type="button" class="${signup?'active':''}" data-cloud-action="signup-tab">Create account</button></div>
    <form id="loginForm" class="auth-form">
      <label>Email address<input name="email" type="email" autocomplete="email" placeholder="you@example.com" required /></label>
      <label>Password<input name="password" type="password" autocomplete="${signup?'new-password':'current-password'}" minlength="8" placeholder="At least 8 characters" required /></label>
      <button type="submit" class="btn primary" id="authSubmit">${signup?'Create account':'Sign in to my account'}</button>
    </form>
    <div style="text-align:center;margin-top:10px"><button class="auth-link" data-cloud-action="forgot">Forgot password?</button></div>`);
  if(notice)authMessage(notice,isError);
}
function showForgot(){document.body.classList.remove('cloud-ready');authShell(`<h2 style="font-size:18px;text-align:center">Reset your password</h2><p class="small muted" style="text-align:center">We’ll email you a password reset link</p><form id="forgotForm" class="auth-form"><label>Email address<input name="email" type="email" autocomplete="email" placeholder="you@example.com" required/></label><button class="btn primary" type="submit">Send reset link</button></form><div style="text-align:center"><button class="auth-link" data-cloud-action="login-tab">Back to sign in</button></div>`)}
function showNewPassword(){recovery=true;document.body.classList.remove('cloud-ready');authShell(`<h2 style="font-size:18px;text-align:center">Set a new password</h2><form id="passwordForm" class="auth-form"><label>New password<input name="password" type="password" minlength="8" autocomplete="new-password" required/></label><label>Confirm password<input name="password2" type="password" minlength="8" autocomplete="new-password" required/></label><button type="submit" class="btn primary">Update password</button></form>`)}
function showFirstData(){document.body.classList.remove('cloud-ready');authShell(`<h2 style="font-size:18px;text-align:center">Welcome to Mizan ☀</h2><p class="small muted" style="text-align:center">We found data from an earlier version on this browser. Import it into your new account?</p><div class="auth-message">Your transactions and budgets will be transferred to the cloud and available on your other devices.</div><div style="display:grid;gap:10px"><button class="btn primary" data-cloud-action="migrate">Import my previous data</button><button class="btn ghost" data-cloud-action="new-empty">Start with an empty account</button></div>`)}
function showConflict(){conflict=true;dirty=true;document.body.classList.remove('cloud-ready');authShell(`<h2 style="font-size:18px;color:#b64455;text-align:center">⚠ Sync conflict</h2><div class="auth-message error">Your account changed on another device before these edits could sync. To protect your work, we will not overwrite the newer cloud version. Export this local copy, then load the latest cloud data.</div><div style="display:grid;gap:10px"><button class="btn primary" data-cloud-action="conflict-backup">Download this local copy JSON</button><button class="btn ghost" data-cloud-action="conflict-reload">Load cloud data instead</button></div>`)}
function setReady(yes){document.body.classList.toggle('cloud-ready',!!yes);if(yes){render();setStatus(localMode?'local':dirty?'saving':'ok')}}
function setStatus(type='ok'){
  if(!button)return;
  button.dataset.state=type;
  button.textContent={saving:'◌ Saving',ok:'✓ Synced',error:'⚠ Not synced',conflict:'⚠ Conflict',local:'◉ Local mode'}[type]||'◌ Sync';
  button.title=type==='local'?'This is a local demo. Export a JSON backup before switching devices.':type==='error'?'These changes have not reached the cloud. Click to retry.':'Data sync status';
}
function cached(){try{const item=JSON.parse(localStorage.getItem(key())||'null');return item&&validData(item.data)&&Number.isFinite(Number(item.revision))?item:null}catch{return null}}
function writeCache(){if(!activeUser)return;try{localStorage.setItem(key(),JSON.stringify({data,revision:remoteRevision,pending:dirty,updatedAt:new Date().toISOString()}))}catch(e){toast('Unable to keep a local copy. Check storage space and export a backup.','error')}}
function clearCache(userId){try{localStorage.removeItem(CACHE_PREFIX+userId)}catch(e){}}
function legacy(){try{const old=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(!validData(old))return null;if(old.transactions.length||old.goals.length||Object.keys(old.budgets).length||old.accounts.some(a=>Number(a.opening)!==0))return old;return null}catch{return null}}
function schedule(delay=550){clearTimeout(timer);if(!dirty||!activeUser||conflict)return;timer=setTimeout(flush,delay)}
window.mizanCloudSafeSave=()=>{
  if(localMode){try{localStorage.setItem(LOCAL_KEY,JSON.stringify(data));setStatus('local');return true}catch(e){toast('Unable to save local data','error');return false}}
  if(!activeUser||conflict||recovery){toast('Sign in or resolve the sync conflict first','error');return false}
  dirty=true;seq++;writeCache();setStatus('saving');schedule();return true;
};
async function flush(){
  if(localMode||!dirty||!activeUser||syncRunning||conflict||recovery)return;
  syncRunning=true;clearTimeout(timer);setStatus('saving');
  const uid=activeUser.id,wasSeq=seq,rev=remoteRevision,snapshot=JSON.parse(JSON.stringify(data));
  try{
    const result=await client.rpc('mizan_push',{snapshot,expected_revision:rev});
    if(uid!==activeUser?.id)return;
    if(result.error)throw result.error;
    if(result.data?.status==='conflict'||!result.data||result.data.status!=='ok')return showConflict();
    remoteRevision=Number(result.data.revision);
    dirty=wasSeq!==seq;writeCache();setStatus(dirty?'saving':'ok');
    if(dirty)schedule(80);
  }catch(e){if(uid===activeUser?.id){setStatus('error');console.error('Mizan sync error:',e)}}
  finally{syncRunning=false}
}
async function fetchRow(uid){const {data:row,error}=await client.rpc('mizan_pull');if(error)throw error;if(!row||!row.revision)return null;return {data:row.data,revision:row.revision}}

async function initializeUser(user){
  if(recovery)return;
  if(activeUser?.id===user.id&&document.body.classList.contains('cloud-ready'))return;
  if(activeTask)return activeTask;
  activeTask=(async()=>{
    if(activeUser?.id!==user.id){data=fresh();remoteRevision=0;dirty=false;seq=0;conflict=false}
    activeUser=user;
    loading('Loading account data..');
    try{
      const row=await fetchRow(user.id);
      if(activeUser?.id!==user.id)return;
      const c=cached();
      if(c?.pending){
        if(row&&Number(c.revision)===Number(row.revision)){data=upgradeData(c.data);remoteRevision=Number(row.revision);dirty=true;seq++;setReady(true);schedule(120);return}
        if(!row&&Number(c.revision)===0){data=upgradeData(c.data);remoteRevision=0;dirty=true;seq++;setReady(true);schedule(120);return}
        data=upgradeData(c.data);remoteRevision=Number(c.revision);return showConflict();
      }
      if(row){
        if(!validData(row.data))throw new Error('Cloud data is not compatible with this version. Export the earlier backup or review the database.');
        data=upgradeData(row.data);remoteRevision=Number(row.revision);dirty=false;writeCache();setReady(true);return;
      }
      if(legacy())return showFirstData();
      await createFirst(fresh());
    }catch(e){
      const c=cached();
      if(c){data=upgradeData(c.data);remoteRevision=Number(c.revision);dirty=!!c.pending;setReady(true);setStatus('error');toast('Cloud unavailable. The local copy can be viewed, but syncing is delayed.','error')}
      else{document.body.classList.remove('cloud-ready');authShell(`<h2>Unable to load data</h2><div class="auth-message error">${esc(readableError(e))}</div><button class="btn primary" style="width:100%" data-cloud-action="retry-load">Try again</button><button class="btn ghost" style="width:100%;margin-top:10px" data-cloud-action="logout">Sign out</button>`)}
    }
  })();try{await activeTask}finally{activeTask=null}
}
async function createFirst(snapshot){
  if(!activeUser)return;
  loading('Creating your private data space..');
  data=upgradeData(snapshot);remoteRevision=0;dirty=true;seq++;
  writeCache();
  await flush();
  if(conflict)return;
  if(dirty){authShell(`<h2>Cannot initialize your account’s data</h2><div class="auth-message error">Make sure you ran schema.sql in SQL Editor and have an internet connection, then try again.</div><button class="btn primary" style="width:100%" data-cloud-action="retry-load">Try again</button>`);return}
  setReady(true);
  toast('Your finance workspace is ready!');
}
async function chooseFirst(importOld){
  const old=importOld?legacy():null;
  try{await createFirst(old||fresh())}catch(e){authMessage(readableError(e),true)}
}
async function reloadAfterConflict(){
  if(!activeUser)return;
  if(!confirm('Unsynced changes on this device will be replaced by cloud data. Have you exported a backup?'))return;
  try{
    loading('Loading latest version..');
    const row=await fetchRow(activeUser.id);
    if(!row||!validData(row.data))throw new Error('No valid finance data found in the cloud');
    data=upgradeData(row.data);remoteRevision=Number(row.revision);dirty=false;conflict=false;seq++;
    writeCache();setReady(true);toast('Latest cloud version loaded');
  }catch(e){showConflict();authMessage(readableError(e),true)}
}
async function refreshFromCloud(){
  if(localMode||!activeUser||dirty||syncRunning||conflict||recovery||!document.body.classList.contains('cloud-ready'))return;
  if(Date.now()-lastRefresh<15000)return;
  lastRefresh=Date.now();
  const uid=activeUser.id,revision=remoteRevision;
  try{const row=await fetchRow(uid);if(uid!==activeUser?.id||dirty||syncRunning)return;
    if(row&&Number(row.revision)>revision){if(!validData(row.data))throw new Error('Unrecognized data format');data=upgradeData(row.data);remoteRevision=Number(row.revision);writeCache();render();setStatus('ok');toast('Changes from your other device have been loaded')}
  }catch(e){setStatus('error')}
}
async function signOut(){
  if(localMode){localMode=false;document.body.classList.remove('cloud-ready');showSetup('Local data remains in this browser and can be reopened.');return}
  if(syncRunning||dirty){await flush();if(dirty){toast('Some changes are not synced yet. Connect to the internet and sync before signing out.','error');return}}
  const uid=activeUser?.id;
  try{const {error}=await client.auth.signOut();if(error)throw error;
    if(uid)clearCache(uid);activeUser=null;data=fresh();remoteRevision=0;dirty=false;conflict=false;
    document.body.classList.remove('cloud-ready');showLogin('login','Signed out successfully.');
  }catch(e){toast(readableError(e),'error')}
}
async function handleLogin(form){
  const fd=new FormData(form),email=String(fd.get('email')||'').trim(),password=String(fd.get('password')||'');
  const btn=form.querySelector('button[type="submit"]');btn.disabled=true;btn.textContent='Checking..';
  try{
    if(authMode==='signup'){
      const {data:res,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}});
      if(error)throw error;
      if(res?.session){await initializeUser(res.session.user)}else showLogin('login','Your account request was received. Check your inbox and confirm your email before signing in.');
    }else{
      const {data:res,error}=await client.auth.signInWithPassword({email,password});
      if(error)throw error;
      if(res?.user)await initializeUser(res.user);
    }
  }catch(e){showLogin(authMode,readableError(e),true)}
  finally{btn.disabled=false;btn.textContent=authMode==='signup'?'Create account':'Sign in to my account'}
}
async function handleForgot(form){const email=String(new FormData(form).get('email')||'').trim();try{const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});if(error)throw error;showLogin('login','If this address is registered, you will receive a password reset email.')}catch(e){authMessage(readableError(e),true)}}
async function handlePassword(form){const fd=new FormData(form),p=String(fd.get('password')||''),p2=String(fd.get('password2')||'');if(p!==p2){authMessage('The passwords do not match.',true);return}try{const {error}=await client.auth.updateUser({password:p});if(error)throw error;recovery=false;const {data:res}=await client.auth.getUser();if(res?.user)await initializeUser(res.user);else showLogin('login','Password updated. Please sign in.')}catch(e){authMessage(readableError(e),true)}}
async function action(name){
  if(name==='local-mode')return enterLocal();
  if(name==='login-tab')return showLogin('login');
  if(name==='signup-tab')return showLogin('signup');
  if(name==='forgot')return showForgot();
  if(name==='migrate'||name==='new-empty')return chooseFirst(name==='migrate');
  if(name==='retry-load'){activeTask=null;return activeUser?initializeUser(activeUser):start()}
  if(name==='conflict-backup')return exportJSON();
  if(name==='conflict-reload')return reloadAfterConflict();
  if(name==='sync'){if(localMode){toast('Data is local only. Export JSON from Settings','error');return}if(conflict)return showConflict();await flush();if(!dirty)await refreshFromCloud();else if(!syncRunning)toast('Sync failed. Check your internet connection.','error');return}
  if(name==='logout')return signOut();
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-cloud-action]');if(b){e.preventDefault();action(b.dataset.cloudAction).catch(err=>{console.error(err);toast(readableError(err),'error')})}});
document.addEventListener('submit',e=>{if(!['loginForm','forgotForm','passwordForm'].includes(e.target.id))return;e.preventDefault();if(e.target.id==='loginForm')handleLogin(e.target);else if(e.target.id==='forgotForm')handleForgot(e.target);else handlePassword(e.target)});
window.addEventListener('online',()=>{if(dirty)schedule(250);else refreshFromCloud()});
window.addEventListener('focus',()=>{if(dirty)schedule(200);else refreshFromCloud()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(dirty)schedule(200);else refreshFromCloud()}});
async function start(){
  const url=String(config.supabaseUrl||''),publicKey=String(config.supabaseAnonKey||'');
  if(!/^https:\/\/[^/]+/.test(url)||!publicKey||/YOUR|PLACEHOLDER/i.test(url+publicKey))return showSetup('Add your Supabase project URL and publishable key to config.js to enable cloud login.');
  if(/service_role|sb_secret_/i.test(publicKey))return showSetup('Use the publishable / anon key only (publishable / anon), not secret/service_role.');
  if(!window.supabase?.createClient)return showSetup('Library Supabase did not load. Check your connection and CDN access. CDN.');
  try{
    client=window.supabase.createClient(url,publicKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
    client.auth.onAuthStateChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY'){setTimeout(showNewPassword,0);return}
      if(event==='SIGNED_OUT'){activeUser=null;data=fresh();dirty=false;conflict=false;document.body.classList.remove('cloud-ready');setTimeout(()=>showLogin('login'),0);return}
      if(event==='SIGNED_IN'&&session?.user&&!recovery)setTimeout(()=>initializeUser(session.user),0);
    });
    loading('Checking your session..');
    const {data:state,error}=await client.auth.getSession();if(error)throw error;
    if(state?.session?.user){await initializeUser(state.session.user)}
    else showLogin();
  }catch(e){showLogin('login',readableError(e),true)}
}
start();
})();
