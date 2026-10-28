// RAIN Lab members dashboard: live data layer (Supabase).
// Loads the signed-in member and the lab's data into the DASH object the pages already use,
// then runs each page's code. Writes go straight to the database; row level security in
// Supabase decides what each person is allowed to change.
var LAB_CFG={
  url:"https://oetcmtyqxsiznjkzpthl.supabase.co",
  key:"sb_publishable_BFwGDxrQtwCcW3pSZtQ-0A_f661pXMo",
  meeting:{weekday:3,start:"10:30",end:"12:30",where:"GUG 211D"} // group meeting: Thursdays (0 = Monday)
};
var LAB_CARDS=["needs","pinned","week","oneone","talks","reading","reviews","confs","library","polls","courses"]; // Today cards that are connected so far
var sb=supabase.createClient(LAB_CFG.url,LAB_CFG.key);
var _labQ=[],_labOK=false;
function labReady(f){if(_labOK)f();else _labQ.push(f)}
document.documentElement.classList.add("lab-loading");

var LAB=(function(){
  var N={},E={}; // email -> name, name -> email
  function nm(email){return N[email]||email}
  function iso(d){var z=new Date(d);z.setMinutes(z.getMinutes()-z.getTimezoneOffset());return z.toISOString().slice(0,10)}
  function offset(dateStr){var m=monday(new Date());return Math.round((new Date(dateStr+"T00:00")-m)/864e5)}
  function when(ts){var d=new Date(ts);return MON[d.getMonth()]+" "+d.getDate()}
  function qrow(x){return {id:x.id,name:x.name,note:x.note||"",by:nm(x.email),when:when(x.created_at),size:x.size_bytes}}
  async function helper(fd){var tok=(await sb.auth.getSession()).data.session.access_token;
    var r=await fetch(LAB_CFG.url+"/functions/v1/dropbox-course",{method:"POST",headers:{Authorization:"Bearer "+tok,apikey:LAB_CFG.key},body:fd});
    var j=await r.json().catch(function(){return {}});if(!r.ok)throw new Error(j.error||"Something went wrong. Please try again.");return j}
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
      q(sb.from("requests").select("*").order("created_at",{ascending:false})),
      q(sb.from("office_hours").select("*").gte("slot_start",new Date(Date.now()-14*864e5).toISOString())),
      q(sb.from("review_requests").select("*").order("needed_by")),
      q(sb.from("reviewers").select("*")),
      q(sb.from("reading_groups").select("*").neq("state","archived").order("created_at",{ascending:false})),
      q(sb.from("reading_group_people").select("*")),
      q(sb.from("reading_time_options").select("*").order("id")),
      q(sb.from("reading_time_votes").select("*")),
      q(sb.from("reading_sessions").select("*").order("meets_on")),
      q(sb.from("reading_paper_options").select("*").order("id")),
      q(sb.from("reading_paper_votes").select("*")),
      q(sb.from("library").select("*").order("added_at",{ascending:false})),
      q(sb.from("suggestions").select("*").order("created_at",{ascending:false})),
      q(sb.from("polls").select("*").order("created_at",{ascending:false})),
      q(sb.from("poll_options").select("*").order("id")),
      q(sb.from("poll_votes").select("*")),
      q(sb.rpc("poll_counts")),
      q(sb.from("courses").select("*").order("code")),
      q(sb.from("course_takers").select("*")),
      q(sb.from("quals_tips").select("*").order("created_at",{ascending:false})),
      q(sb.from("quals_materials").select("*").order("created_at",{ascending:false}))
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
    DASH.oneone=r[6].map(function(b){return {start:new Date(b.slot_start).toISOString(),email:b.email,name:nm(b.email),note:b.note||""}});
    // birthdays in the next 7 days, for people who chose to share them
    var today=new Date();today.setHours(0,0,0,0);
    DASH.birthdays=people.filter(function(p){return p.show_birthday&&p.birthday_month&&p.birthday_day}).map(function(p){
      var d=new Date(today.getFullYear(),p.birthday_month-1,p.birthday_day);if(d<today)d.setFullYear(d.getFullYear()+1);
      return {n:p.name,inDays:Math.round((d-today)/864e5)}}).filter(function(b){return b.inDays<=7});
    // parts of the dashboard that are not connected yet start empty
    DASH.reviews=r[7].map(function(x){return {id:x.id,title:x.title,author:nm(x.author),venue:x.venue||"Venue to add",need:x.needed_by,link:x.link||"",kinds:x.kinds||[],open:x.open_to_volunteers,
      reviewers:r[8].filter(function(v){return v.request_id===x.id}).map(function(v){return {n:nm(v.email),st:v.status}})}});
    DASH.groups=r[9].map(function(g){var ppl=r[10].filter(function(x){return x.group_id===g.id});
      return {id:g.id,name:g.name,area:g.area||"learning",desc:g.description||"",owner:nm(g.owner),open:g.open_to_all,state:g.state,time:g.weekly_time,day:g.weekday,where:g.location||"To decide",
        start:g.start_time,end:g.end_time,
        members:ppl.filter(function(x){return x.status==="member"}).map(function(x){return nm(x.email)}),
        invited:ppl.filter(function(x){return x.status==="invited"}).map(function(x){return nm(x.email)}),
        options:r[11].filter(function(o){return o.group_id===g.id}).map(function(o){return {id:o.id,d:o.label,day:o.weekday,
          v:r[12].filter(function(v){return v.option_id===o.id}).map(function(v){return nm(v.email)})}}),
        sessions:r[13].filter(function(x){return x.group_id===g.id}).map(function(x){return {id:x.id,day:offset(x.meets_on),mode:x.mode,by:x.picked_by?nm(x.picked_by):null,q:x.paper,
          options:r[14].filter(function(o){return o.session_id===x.id}).map(function(o){return {id:o.id,q:o.paper,by:nm(o.suggested_by),
            votes:r[15].filter(function(v){return v.option_id===o.id}).map(function(v){return nm(v.email)})}})}}),
        sugs:r[17].filter(function(x){return x.to_group===g.id}).map(function(x){return {id:x.id,q:x.paper,by:nm(x.from_email)}}),
        past:[]}});
    var now=Date.now();
    DASH.library=r[16].map(function(x){return {id:x.id,p:{t:x.title,a:x.authors?[x.authors]:[],v:"",y:"",l:x.link?[["Link",x.link]]:[],ar:x.area?[x.area]:[]},
      by:nm(x.added_by),ago:Math.max(0,Math.floor((now-new Date(x.added_at))/864e5)),note:x.note||""}});
    DASH.suggested=r[17].filter(function(x){return x.to_email===meRow.email}).map(function(x){return {id:x.id,q:x.paper,by:nm(x.from_email)}});
    // weekly reading group meetings on the calendar
    DASH.groups.filter(function(g){return g.state==="set"&&g.day!=null}).forEach(function(g){
      for(var w=-1;w<=10;w++)DASH.events.push({t:"reading",title:g.name+" reading group",day:w*7+g.day,s:(g.start||"15:00").slice(0,5),e:(g.end||"16:00").slice(0,5),where:g.where,who:g.members.length+" members"})});
    // polls: names for normal polls; anonymous polls get counts only (plus your own vote)
    var cnt={};(r[21]||[]).forEach(function(c){cnt[c.option_id]=+c.n});
    DASH.polls=r[18].map(function(p){return {id:p.id,q:p.question,by:nm(p.created_by),kind:p.kind,anon:p.anonymous,closes:p.closes_on,
      options:r[19].filter(function(o){return o.poll_id===p.id}).map(function(o){var v=r[20].filter(function(x){return x.option_id===o.id}).map(function(x){return nm(x.email)});
        if(p.anonymous){var mine=v.indexOf(meRow.name)>=0;v=mine?[meRow.name]:[];for(var k=v.length;k<(cnt[o.id]||0);k++)v.push("anonymous "+o.id+"-"+k)}
        return {id:o.id,t:o.label,v:v}})}});
    DASH.courses=r[22].map(function(c){return {id:c.id,code:c.code,name:c.name,tip:c.tip||"",quals:c.helps_quals,by:nm(c.added_by),url:c.dropbox_url||"",
      took:r[23].filter(function(t){return t.course_id===c.id}).map(function(t){return [nm(t.email),t.term||""]})}});
    DASH.qualsFiles=r[25].map(qrow);
    DASH.quals=r[24].map(function(x){return {id:x.id,by:nm(x.email),when:x.year||"",text:x.body}});
    ["changes","digest"].forEach(function(k){DASH[k]=[]});
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
    bookOO:async function(b){try{await q(sb.from("office_hours").insert({slot_start:b.start,email:DASH.me.email,note:b.note||null}))}
      catch(e){var i=DASH.oneone.indexOf(b);if(i>=0)DASH.oneone.splice(i,1);ooEvents();document.dispatchEvent(new Event("dash:redraw"));if(window.toast)toast("Someone just took that slot. Please pick another.");console.error(e)}},
    cancelOO:async function(b){try{await q(sb.from("office_hours").delete().eq("slot_start",b.start).eq("email",DASH.me.email))}catch(e){fail(e)}},
    addReview:async function(r){try{
        var x=(await q(sb.from("review_requests").insert({title:r.title,author:DASH.me.email,venue:r.venue,link:r.link||null,needed_by:r.need,kinds:r.kinds,open_to_volunteers:!!r.open}).select()))[0];
        await q(sb.from("reviewers").insert(r.reviewers.map(function(v){return {request_id:x.id,email:E[v.n],status:"invited"}})));return x.id}catch(e){fail(e)}},
    review:async function(a,r){try{var me=DASH.me.email,t=sb.from("reviewers");
        if(a==="accept")await q(t.update({status:"accepted"}).eq("request_id",r.id).eq("email",me));
        else if(a==="done")await q(t.update({status:"done"}).eq("request_id",r.id).eq("email",me));
        else if(a==="decline")await q(t.delete().eq("request_id",r.id).eq("email",me));
        else if(a==="volunteer")await q(t.insert({request_id:r.id,email:me,status:"accepted"}));
        else if(a==="withdraw")await q(sb.from("review_requests").delete().eq("id",r.id));
      }catch(e){fail(e)}},
    addGroup:async function(g){try{
        var pad=function(x){return ("0"+x).slice(-2)+":00"},set=g.state==="set",gr={name:g.name,area:g.area,description:g.desc||null,owner:DASH.me.email,open_to_all:!!g.open,state:set?"set":"scheduling"};
        if(set)Object.assign(gr,{weekly_time:g.time,weekday:g.day,start_time:pad(g.hour||15),end_time:pad((g.hour||15)+1)});
        var row=(await q(sb.from("reading_groups").insert(gr).select()))[0];
        await q(sb.from("reading_group_people").insert([{group_id:row.id,email:DASH.me.email,status:"member"}].concat(g.invited.map(function(n){return {group_id:row.id,email:E[n],status:"invited"}}))));
        g.id=row.id;if(set)return true;
        var opts=await q(sb.from("reading_time_options").insert(g.options.map(function(o){var h=o.hour||15;return {group_id:row.id,weekday:o.day,start_time:pad(h),end_time:pad(h+1),label:o.d}})).select());
        opts.forEach(function(o,i){g.options[i].id=o.id});return true}catch(e){fail(e);return false}},
    groupPerson:async function(g,a){try{var t=sb.from("reading_group_people");
        if(a==="join")await q(t.insert({group_id:g.id,email:DASH.me.email,status:"member"}));
        else if(a==="accept")await q(t.update({status:"member"}).eq("group_id",g.id).eq("email",DASH.me.email));
        else await q(t.delete().eq("group_id",g.id).eq("email",DASH.me.email));
      }catch(e){fail(e)}},
    deleteGroup:async function(g){try{await q(sb.from("reading_groups").update({state:"archived"}).eq("id",g.id))}catch(e){fail(e)}},
    timeVote:async function(o,on){try{
        if(on)await q(sb.from("reading_time_votes").insert({option_id:o.id,email:DASH.me.email}));
        else await q(sb.from("reading_time_votes").delete().eq("option_id",o.id).eq("email",DASH.me.email));
      }catch(e){fail(e)}},
    settleGroup:function(g){
      // the vote that completes the poll may still be saving, so wait a moment before asking the database to set the time
      setTimeout(async function(){try{var r=await sb.rpc("settle_reading_group",{gid:g.id});if(r.error)throw r.error}catch(e){console.error(e)}},1200)},
    // papers for reading group meetings
    addSession:function(g,ss){ss._p=(async function(){try{
        ss.id=(await q(sb.from("reading_sessions").insert({group_id:g.id,meets_on:iso(sessDate(ss.day)),mode:ss.mode,picked_by:ss.mode==="pick"?DASH.me.email:null}).select()))[0].id}
      catch(e){console.error(e);var i=g.sessions.indexOf(ss);if(i>=0)g.sessions.splice(i,1);document.dispatchEvent(new Event("dash:redraw"));
        if(window.toast)toast("Someone else just took that week. Refresh the page to see it.")}})();return ss._p},
    delSession:async function(ss){try{await ss._p;if(ss.id)await q(sb.from("reading_sessions").delete().eq("id",ss.id))}catch(e){fail(e)}},
    setPaper:async function(ss){try{await ss._p;await q(sb.from("reading_sessions").update({paper:ss.q}).eq("id",ss.id))}catch(e){fail(e)}},
    addOption:function(ss,o){o._p=(async function(){try{await ss._p;
        o.id=(await q(sb.from("reading_paper_options").insert({session_id:ss.id,paper:o.q}).select()))[0].id}catch(e){fail(e)}})();return o._p},
    paperVote:async function(ss,o){try{var me=DASH.me.email,ids=ss.options.map(function(x){return x.id}).filter(Boolean);
        if(ids.length)await q(sb.from("reading_paper_votes").delete().eq("email",me).in("option_id",ids));
        if(o){await o._p;await q(sb.from("reading_paper_votes").insert({option_id:o.id,email:me}))}}catch(e){fail(e)}},
    // the lab library and suggestions
    addLib:async function(x){try{var l=x.p.l.length?x.p.l[0][1]:null;
        x.id=(await q(sb.from("library").insert({title:x.p.t,authors:x.p.a[0]||null,link:l,area:x.p.ar[0]||null,note:x.note||null}).select()))[0].id}catch(e){fail(e)}},
    delLib:async function(x){try{await q(sb.from("library").delete().eq("id",x.id))}catch(e){fail(e)}},
    suggest:function(x,to){x._p=(async function(){try{var row={paper:x.q};if(to.to_group)row.to_group=to.to_group;else row.to_email=E[to.to_email];
        x.id=(await q(sb.from("suggestions").insert(row).select()))[0].id}catch(e){fail(e)}})();return x._p},
    delSug:async function(x){try{await x._p;if(x.id)await q(sb.from("suggestions").delete().eq("id",x.id))}catch(e){fail(e)}},
    // polls
    addPoll:function(p){p._p=(async function(){try{
        var row=(await q(sb.from("polls").insert({question:p.q,kind:p.kind,anonymous:!!p.anon,closes_on:p.closes}).select()))[0];
        var os=await q(sb.from("poll_options").insert(p.options.map(function(o){return {poll_id:row.id,label:o.t}})).select());
        p.id=row.id;os.forEach(function(o,i){p.options[i].id=o.id});document.dispatchEvent(new Event("dash:redraw"))}catch(e){fail(e)}})();return p._p},
    delPoll:async function(p){try{await q(sb.from("polls").delete().eq("id",p.id))}catch(e){fail(e)}},
    pollVote:async function(p,o,on){try{await p._p;var me=DASH.me.email,t=sb.from("poll_votes");
        if(on&&p.kind==="one"){var ids=p.options.map(function(x){return x.id}).filter(Boolean);await q(sb.from("poll_votes").delete().eq("email",me).in("option_id",ids))}
        if(on)await q(t.insert({option_id:o.id,email:me}));else await q(t.delete().eq("option_id",o.id).eq("email",me))}
      catch(e){fail(e)}},
    // courses and quals
    addCourse:function(c){c._p=(async function(){try{
        c.id=(await q(sb.from("courses").insert({code:c.code,name:c.name,tip:c.tip||null,helps_quals:!!c.quals}).select()))[0].id;
        var mine=c.took.find(function(t){return t[0]===DASH.me.name});if(mine)await q(sb.from("course_takers").insert({course_id:c.id,email:DASH.me.email,term:mine[1]||null}))}catch(e){fail(e)}})();return c._p},
    updCourse:async function(c){try{await c._p;await q(sb.from("courses").update({code:c.code,name:c.name,tip:c.tip||null,helps_quals:!!c.quals}).eq("id",c.id))}catch(e){fail(e)}},
    delCourse:async function(c){try{await q(sb.from("courses").delete().eq("id",c.id))}catch(e){fail(e)}},
    took:async function(c,term){try{await c._p;var t=sb.from("course_takers");
        if(term===null)await q(t.delete().eq("course_id",c.id).eq("email",DASH.me.email));
        else await q(t.upsert({course_id:c.id,email:DASH.me.email,term:term||null}))}catch(e){fail(e)}},
    courseFiles:async function(c,files){try{await c._p;if(!c.id)return false;
        var fd=new FormData();fd.append("course_id",c.id);files.forEach(function(f){fd.append("files",f)});
        var tok=(await sb.auth.getSession()).data.session.access_token;
        var r=await fetch(LAB_CFG.url+"/functions/v1/dropbox-course",{method:"POST",headers:{Authorization:"Bearer "+tok,apikey:LAB_CFG.key},body:fd});
        var j=await r.json().catch(function(){return {}});
        if(!r.ok){if(window.toast)toast(j.error||"Upload failed. Please try again.");return false}
        if(j.url&&!c.url){c.url=j.url;if(c.by===DASH.me.name||DASH.me.role==="Admin")sb.from("courses").update({dropbox_url:j.url}).eq("id",c.id).then(function(){})}
        return true}catch(e){console.error(e);if(window.toast)toast("Upload failed. Please try again.");return false}},
    qualsUpload:async function(files,note){try{var fd=new FormData();fd.append("kind","quals");files.forEach(function(f){fd.append("files",f)});
        var j=await helper(fd);
        var rows=await q(sb.from("quals_materials").insert(j.saved.map(function(x){return {name:x.name,path:x.path,size_bytes:x.size||null,note:note||null}})).select());
        return rows.map(qrow)}catch(e){console.error(e);if(window.toast)toast(e.message||"Upload failed.");return null}},
    qualsLink:async function(x){try{var fd=new FormData();fd.append("kind","link");fd.append("material_id",x.id);return (await helper(fd)).url}
      catch(e){console.error(e);if(window.toast)toast(e.message||"Download failed.");return null}},
    delQualsFile:async function(x){try{await q(sb.from("quals_materials").delete().eq("id",x.id))}catch(e){fail(e)}},
    addQual:async function(x){try{x.id=(await q(sb.from("quals_tips").insert({body:x.text,year:x.when||null}).select()))[0].id}catch(e){fail(e)}},
    delQual:async function(x){try{await q(sb.from("quals_tips").delete().eq("id",x.id))}catch(e){fail(e)}},
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
