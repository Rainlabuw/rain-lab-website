// RAIN Lab members dashboard: live data layer (Supabase).
// Loads the signed-in member and the lab's data into the DASH object the pages already use,
// then runs each page's code. Writes go straight to the database; row level security in
// Supabase decides what each person is allowed to change.
var LAB_CFG={
  url:"https://oetcmtyqxsiznjkzpthl.supabase.co",
  key:"sb_publishable_BFwGDxrQtwCcW3pSZtQ-0A_f661pXMo",
  meeting:{weekday:3,start:"10:30",end:"12:30",where:"GUG 211D"} // group meeting: Thursdays (0 = Monday)
};
var LAB_CARDS=["needs","pinned","week","talks","confs"]; // Today cards that are connected so far
var sb=supabase.createClient(LAB_CFG.url,LAB_CFG.key);
var _labQ=[],_labOK=false;
function labReady(f){if(_labOK)f();else _labQ.push(f)}
document.documentElement.classList.add("lab-loading");

var LAB=(function(){
  var N={},E={}; // email -> name, name -> email
  function nm(email){return N[email]||email}
  function iso(d){var z=new Date(d);z.setMinutes(z.getMinutes()-z.getTimezoneOffset());return z.toISOString().slice(0,10)}
  function offset(dateStr){var m=monday(new Date());return Math.round((new Date(dateStr+"T12:00")-m)/864e5)}
  function when(ts){var d=new Date(ts);return MON[d.getMonth()]+" "+d.getDate()}
  function fail(e){console.error(e);if(window.toast)toast("Could not save that. Please try again.")}
  async function q(p){var r=await p;if(r.error)throw r.error;return r.data}

  function meetings(talkRows){
    // weekly group meetings from five weeks back to ten weeks ahead
    var c=LAB_CFG.meeting,ev=[],talks=[];
    for(var w=-5;w<=10;w++){var day=w*7+c.weekday,d=sessDate(day),ds=iso(d);
      var names=talkRows.filter(function(t){return t.meeting_date===ds}).sort(function(a,b){return a.created_at<b.created_at?-1:1}).map(function(t){return nm(t.email)});
      ev.push({t:"group",title:"Group meeting",day:day,s:c.start,e:c.end,where:c.where,who:names.length?names.length+(names.length===1?" talk":" talks")+" signed up":"No talks yet"});
      talks.push({day:day,date:ds,names:names})}
    return {ev:ev,talks:talks}
  }

  async function load(session,meRow){
    var since=iso(sessDate(-35));
    var r=await Promise.all([
      q(sb.from("members").select("*").order("name")),
      q(sb.from("announcements").select("*").order("created_at",{ascending:false})),
      q(sb.from("talks").select("*").gte("meeting_date",since)),
      q(sb.from("conferences").select("*").order("starts_on")),
      q(sb.from("conference_attendance").select("*")),
      q(sb.from("requests").select("*").order("created_at",{ascending:false}))
    ]);
    var people=r[0];people.forEach(function(p){N[p.email]=p.name;E[p.name]=p.email});
    var pub=((typeof DATA!=="undefined"&&DATA.members)||[]).find(function(m){return m.name===meRow.name})||{};
    DASH.me={name:meRow.name,email:meRow.email,role:meRow.role==="admin"?"Admin":"Member",row:meRow,
      photo:pub.photo?pub.photo.split("/").pop():(session.user.user_metadata&&session.user.user_metadata.avatar_url)||""};
    DASH.people=people;
    DASH.announcements=r[1].map(function(a){return {id:a.id,by:nm(a.created_by),when:when(a.created_at),text:a.body}});
    var m=meetings(r[2]);DASH.events=m.ev;DASH.talks=m.talks;
    DASH.conferences=r[3].map(function(c){var s=c.starts_on,e=c.ends_on,ds=s?new Date(s+"T12:00"):null,de=e?new Date(e+"T12:00"):null;
      return {id:c.id,name:c.name,short:c.short_name||c.name,start:s||"2999-01-01",where:c.location||"Location to add",
        when:ds?(MON[ds.getMonth()]+" "+ds.getDate()+(de&&e!==s?(de.getMonth()===ds.getMonth()?" to "+de.getDate():" to "+MON[de.getMonth()]+" "+de.getDate()):"")+", "+ds.getFullYear()):"Dates to add",
        who:r[4].filter(function(a){return a.conference_id===c.id}).map(function(a){return nm(a.email)})}});
    DASH.requests=r[5].map(function(x){return {id:x.id,by:nm(x.author),email:x.author,type:x.kind,text:x.body,when:when(x.created_at),status:x.status,reply:x.reply}});
    // birthdays in the next 7 days, for people who chose to share them
    var today=new Date();today.setHours(0,0,0,0);
    DASH.birthdays=people.filter(function(p){return p.show_birthday&&p.birthday_month&&p.birthday_day}).map(function(p){
      var d=new Date(today.getFullYear(),p.birthday_month-1,p.birthday_day);if(d<today)d.setFullYear(d.getFullYear()+1);
      return {n:p.name,inDays:Math.round((d-today)/864e5)}}).filter(function(b){return b.inDays<=7});
    // parts of the dashboard that are not connected yet start empty
    ["groups","reviews","changes","polls","library","digest","courses","quals"].forEach(function(k){DASH[k]=[]});
  }

  // ---- writes
  var api={
    load:load,nm:nm,
    talk:async function(t,on){try{
        if(on)await q(sb.from("talks").insert({meeting_date:t.date,email:DASH.me.email}));
        else await q(sb.from("talks").delete().eq("meeting_date",t.date).eq("email",DASH.me.email));
      }catch(e){var i=t.names.indexOf(DASH.me.name);if(on&&i>=0)t.names.splice(i,1);if(!on&&i<0)t.names.push(DASH.me.name);document.dispatchEvent(new Event("dash:redraw"));fail(e)}},
    conf:async function(c,on){try{
        if(on)await q(sb.from("conference_attendance").insert({conference_id:c.id,email:DASH.me.email}));
        else await q(sb.from("conference_attendance").delete().eq("conference_id",c.id).eq("email",DASH.me.email));
      }catch(e){fail(e)}},
    addRequest:async function(kind,body){try{var x=(await q(sb.from("requests").insert({kind:kind,body:body}).select()))[0];return x.id}catch(e){fail(e)}},
    updRequest:async function(id,patch){try{await q(sb.from("requests").update(patch).eq("id",id))}catch(e){fail(e)}},
    addAnn:async function(body){try{return (await q(sb.from("announcements").insert({body:body}).select()))[0].id}catch(e){fail(e)}},
    delAnn:async function(id){try{await q(sb.from("announcements").delete().eq("id",id))}catch(e){fail(e)}},
    addConf:async function(c){try{return (await q(sb.from("conferences").insert(c).select()))[0].id}catch(e){fail(e)}},
    delConf:async function(id){try{await q(sb.from("conferences").delete().eq("id",id))}catch(e){fail(e)}},
    addMember:async function(m){try{await q(sb.from("members").insert(m));N[m.email]=m.name;return true}catch(e){fail(e);return false}},
    delMember:async function(email){try{await q(sb.from("members").delete().eq("email",email))}catch(e){fail(e)}},
    setRole:async function(email,role){try{await q(sb.from("members").update({role:role}).eq("email",email))}catch(e){fail(e)}},
    signOut:async function(){await sb.auth.signOut();location.replace("members.html")}
  };
  return api;
})();

(async function(){
  if(document.readyState==="loading")await new Promise(function(r){document.addEventListener("DOMContentLoaded",r)});
  try{
    var s=(await sb.auth.getSession()).data.session;
    if(!s){location.replace("members.html");return}
    var email=(s.user.email||"").toLowerCase();
    var me=(await sb.from("members").select("*").eq("email",email).maybeSingle()).data;
    if(!me||me.role==="alumni"){await sb.auth.signOut();location.replace("members.html?e=notmember");return}
    await LAB.load(s,me);
  }catch(e){console.error(e);document.body.innerHTML='<p style="padding:2rem;font:16px system-ui">The dashboard could not load. Please refresh the page. If it keeps happening, tell Shiva.</p>';document.documentElement.classList.remove("lab-loading");return}
  // rail: the person who is signed in
  var r=document.querySelector(".rail .me");
  if(r){var img=r.querySelector("img");if(img){if(DASH.me.photo)img.src=DASH.me.photo;else img.remove()}r.querySelector("b").textContent=DASH.me.name;
    var so=r.querySelector('a[href="members.html"]');if(so)so.addEventListener("click",function(e){e.preventDefault();LAB.signOut()})}
  _labOK=true;_labQ.splice(0).forEach(function(f){try{f()}catch(e){console.error(e)}});
  document.documentElement.classList.remove("lab-loading");
  document.dispatchEvent(new Event("dash:redraw"));document.dispatchEvent(new Event("bell:refresh"));
})();
