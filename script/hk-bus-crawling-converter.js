//Credit to HK Bus Crawling@2021, https://github.com/hkbus/hk-bus-crawling

/**
 * Find every route number that is jointly operated by KMB and CTB.
 * Variants of these routes may be published with only one of the two companies,
 * so they have to be folded into the pseudo-company "kmb+ctb" as well.
 * @param {object} rl - routeFareList.routeList
 * @return {Set<string>} route numbers with a KMB+CTB entry
 */
function _jointRouteNumbers(rl){
    let s = new Set();
    Object.keys(rl).forEach(k=>{
        let e = rl[k];
        if(e.co.length==2 && e.co.includes("kmb") && e.co.includes("ctb"))s.add(e.route);
    });
    return s;
}

/**
 * Normalise the company signature of a routeFareList entry.
 * A route jointly operated by KMB and CTB is treated as one pseudo-company "kmb+ctb".
 * @param {object} entry - one value of routeFareList.routeList
 * @param {Set<string>} joint - result of _jointRouteNumbers
 * @return {string} company signature
 */
function _routeCo(entry, joint){
    let co = entry.co[0];
    if(entry.co.length==2 && entry.co.includes("kmb") && entry.co.includes("ctb"))co = "kmb+ctb";
    else if(joint && joint.has(entry.route) && (co=="kmb" || co=="ctb"))co = "kmb+ctb";
    return co;
}

/**
 * Get the travel direction of a route variant.
 * Jointly operated routes store one bound per company, so the bound of the
 * first company present in the entry is used.
 * @param {object} entry - one value of routeFareList.routeList
 * @return {string} "I", "O", "OI" or "IO"
 */
function _routeDir(entry){
    let b = entry.bound;
    if(b && typeof b == "object"){
        for(let i=0;i<entry.co.length;i++){
            if(b[entry.co[i]])return b[entry.co[i]];
        }
        let vals = Object.values(b);
        return vals.length ? String(vals[0]) : "";
    }
    return b==null ? "" : String(b);
}

/**
 * Number of companies that operate a route variant.
 * Used to prefer the entry that covers all operators when duplicated keys exist.
 * @param {object} entry - one value of routeFareList.routeList
 * @return {number} company count
 */
function _routeCompanyCount(entry){
    let b = entry.bound;
    return (b && typeof b == "object") ? Object.keys(b).length : 1;
}

const _WEEK_ZH = ["一","二","三","四","五","六","日"];

function _minutesOf(hhmm){
    let n = parseInt(hhmm);
    return Math.floor(n/100)*60 + (n%100);
}

function _formatMinutes(m){
    let h = Math.floor(m/60), mm = m%60;
    return (h<10?"0":"")+h+":"+(mm<10?"0":"")+mm;
}

/**
 * Service-day bitmask of a date.
 * In the dataset bit 0-4 mean Mon-Fri, bit 5 Saturday, bit 6 Sunday,
 * bit 7 public holiday and bit 8 is a constant flag (e.g. 287 / 288 / 448).
 * @param {Date} date
 * @return {number} bitmask of that weekday
 */
function _dayBit(date){
    return 1 << ((date.getDay()+6)%7);
}

/**
 * Flatten the freq entries of one day into concrete service windows, measured in
 * minutes from 00:00 of the given date. A null value means a single scheduled
 * departure instead of a frequency band.
 * @param {object} freq - freq field of a route variant
 * @param {Date} date - day used to select the bitmask
 * @param {number} dayOffset - 0 = today, 1 = tomorrow
 * @return {Array<{start:number,end:number,single:boolean}>}
 */
function _freqWindows(freq, date, dayOffset){
    let bit = 1 << ((((date.getDay()+6)%7) + dayOffset) % 7);
    let out = [];

    Object.keys(freq).forEach(k=>{
        if(!(parseInt(k) & bit))return;
        let bucket = freq[k];
        if(!bucket)return;

        Object.keys(bucket).forEach(s=>{
            let value = bucket[s];
            let start = _minutesOf(s) + dayOffset*1440;
            let end = (value && value[0]) ? _minutesOf(value[0]) + dayOffset*1440 : start;
            out.push({"start":start,"end":end,"single":!(value && value[0])});
        });
    });
    return out;
}

/**
 * True when at least one departure falls between now and now+minutes.
 * @param {object} freq - freq field of a route variant
 * @param {Date} time - current time
 * @param {number} minutes - look-ahead window
 * @return {boolean}
 */
function _routeDepartureWithin(freq, time, minutes){
    if(!freq)return false;

    let now = time.getHours()*60 + time.getMinutes();
    let limit = now + minutes;

    for(let d=0;d<=1;d++){
        let wins = _freqWindows(freq, time, d);
        for(let i=0;i<wins.length;i++){
            let w = wins[i];
            if(w.single){
                if(w.start>=now && w.start<=limit)return true;
            }else{
                if(w.start<=now && w.end>now)return true;   // band covering now
                if(w.start>now && w.start<=limit)return true; // band starting soon
            }
        }
    }
    return false;
}

/**
 * True when the route is considered to be running now: a frequency band covers
 * the current minute, or a fixed departure is due within the next hour / has
 * just left. Used to decide whether route2 shows variant information or the
 * service pattern.
 * @param {object} freq - freq field of a route variant
 * @param {Date} time - current time
 * @return {boolean}
 */
function _routeInService(freq, time){
    if(!freq)return false;

    let now = time.getHours()*60 + time.getMinutes();
    let wins = _freqWindows(freq, time, 0);

    for(let i=0;i<wins.length;i++){
        let w = wins[i];
        if(w.single){
            if(w.start>=now-30 && w.start<=now+60)return true;
        }else if(w.start<=now && w.end>now){
            return true;
        }
    }
    return false;
}

/**
 * Human readable service pattern of a freq table, e.g.
 * "星期一至五 07:10–08:55", "星期六、日及公眾假期 06:00–12:20" or "特定日子服務".
 * @param {object} freq - freq field of a route variant
 * @return {string}
 */
function _serviceText(freq){
    if(!freq || Object.keys(freq).length==0)return "特定日子服務";

    let days = new Set(), ph = false;
    let starts = [], ends = [];

    Object.keys(freq).forEach(k=>{
        let mask = parseInt(k);
        for(let i=0;i<7;i++)if(mask & (1<<i))days.add(i);
        if(mask & 128)ph = true;

        let bucket = freq[k];
        if(!bucket)return;
        Object.keys(bucket).forEach(s=>{
            starts.push(_minutesOf(s));
            let value = bucket[s];
            if(value && value[0])ends.push(_minutesOf(value[0]));
        });
    });

    if(days.size==0)return "特定日子服務";

    let list = Array.from(days).sort((a,b)=>a-b);
    let key = list.join(",");
    let day;

    if(key=="0,1,2,3,4,5,6")day = "每日";
    else if(key=="0,1,2,3,4")day = "星期一至五";
    else if(key=="0,1,2,3,4,5")day = "星期一至六";
    else if(key=="0,1,2,3,4,6")day = "星期一至五及星期日";
    else if(key=="5,6")day = ph ? "星期六、日及公眾假期" : "星期六及星期日";
    else if(key=="6")day = ph ? "星期日及公眾假期" : "星期日";
    else if(key=="5")day = "星期六";
    else day = list.map(d=>"星期"+_WEEK_ZH[d]).join("、");

    if(ph && day!="每日" && day.indexOf("公眾假期")<0)day += "及公眾假期";

    if(starts.length==0)return day;

    let min = Math.min.apply(null, starts);
    let max = ends.length ? Math.max.apply(null, ends) : Math.max.apply(null, starts);

    if(max>min && max-min<=270)return day+" 繁忙時間";
    return day+" "+_formatMinutes(min)+"–"+_formatMinutes(max);
}

/**
 * Describe how a variant differs from the base variant of the same route and
 * direction, e.g. "由太安樓開出，以跑馬地(上)為終點站".
 * @param {object} baseEntry - base variant entry (smallest serviceType)
 * @param {object} entry - variant entry to describe
 * @param {object} stopList - routeFareList.stopList
 * @return {string} empty string when the stop pattern is identical
 */
function _variantDiff(baseEntry, entry, stopList){
    let a = Object.values(baseEntry.stops)[0] || [];
    let b = Object.values(entry.stops)[0] || [];
    if(!b.length)return "";

    let parts = [];
    let first = stopList[b[0]], last = stopList[b[b.length-1]];

    if(a[0]!=b[0] && first)parts.push("由"+first.name.zh+"開出");
    if(a[a.length-1]!=b[b.length-1] && last)parts.push("以"+last.name.zh+"為終點站");

    if(parts.length==0){
        let added = b.filter(id=>!a.includes(id));
        if(added.length && stopList[added[0]])parts.push("經"+stopList[added[0]].name.zh);
    }

    return parts.join("，");
}

function BusCrawling(){
var data = null;
var jointRoutes = null;

async function reload(){
if(data)return;
// eta7: the hkbus routeFareList is rebuilt from the eta6 static dataset
data = await Eta6.routeFareList();
jointRoutes = _jointRouteNumbers(data.routeList);
}

function toSentenceCase(str){
    //turn the string to sentence case
    let words = str.split(" ");
    if(words.length == 1) return str;
    let tmp = str.toLowerCase().replace(/\b\w/g, function(l) { return l.toUpperCase(); });
    if(str == tmp)return str;
    return tmp.replaceAll("Bbi","BBI");
}
this.toSentenceCase = ((str)=>toSentenceCase(str));
this.generateRouteList = async function(div){
    var ROUTES_num = [];
    await reload();
    let k = new routeList(div,jointRoutes,data.stopList);
    Object.keys(data.routeList).forEach(key=>{
        let g = data.routeList[key];
        if(!["kmb+ctb","ctb","kmb","nlb","lrtfeeder"].includes(_routeCo(g, jointRoutes)))return;
        if(!ROUTES_num.includes(g.route))ROUTES_num.push(g.route);
        k.add(g, key, toSentenceCase(g.dest.en));
    });
    k.gen();
    return [k,ROUTES_num];
}

/**
 * List all variants (serviceType) of the same route and the same direction as the
 * given routeFareList key.
 * @param {string} key - routeFareList key currently opened by route3
 * @param {Date} time - point in time used to evaluate the freq table
 * @return {Array<object>} ordered variants with label/link/active state
 */
this.getRouteVariants = function(key, time=new Date()){
    if(!data || !data.routeList[key])return [];
    let cur = data.routeList[key];
    let co = _routeCo(cur, jointRoutes), route = cur.route, dir = _routeDir(cur);
    let groups = {};
    let routeFreq = null;

    Object.keys(data.routeList).forEach(k=>{
        let v = data.routeList[k];
        if(_routeCo(v, jointRoutes)!=co || v.route!=route)return;
        if(!routeFreq && v.freq && Object.keys(v.freq).length)routeFreq = v.freq;
        if(_routeDir(v)!=dir)return;
        let svc = parseInt(v.serviceType)||1;
        if(!groups[svc])groups[svc]=[];
        groups[svc].push({"key":k,"entry":v});
    });

    let svcs = Object.keys(groups).map(Number).sort((a,b)=>a-b);
    let reps = {};
    let dirFreq = null;
    svcs.forEach(svc=>{
        groups[svc].sort((a,b)=>_routeCompanyCount(b.entry)-_routeCompanyCount(a.entry));
        reps[svc] = groups[svc][0];
        let f = reps[svc].entry.freq;
        if(!dirFreq && f && Object.keys(f).length)dirFreq = f;
    });

    // circular routes may only publish the freq table on one leg
    let freq = dirFreq || routeFreq;
    let baseEntry = reps[svcs[0]] ? reps[svcs[0]].entry : null;

    return svcs.map(svc=>{
        let rep = reps[svc];
        return {
            "svc": svc,
            "label": dir+svc,
            "key": rep.key,
            "active": groups[svc].some(g=>_routeInService(g.entry.freq || freq, time)),
            "departure60": groups[svc].some(g=>_routeDepartureWithin(g.entry.freq || freq, time, 60)),
            "desc": baseEntry ? _variantDiff(baseEntry, rep.entry, data.stopList) : "",
            "serviceText": _serviceText(rep.entry.freq || freq),
            "dest_tc": rep.entry.dest.zh,
            "dest_en": toSentenceCase(rep.entry.dest.en),
            "co": co
        };
    });
}

this.data = async function(div){
    await reload();
    return data;
}

this.getStopData = function(id){
    let n = data.stopList[id];
    return {
        lat: n.location.lat,
        long: n.location.lng,
        name_en: n.name.en,
        name_tc: n.name.zh,
        stop: id
    }
}


getSameStop = function(id){
    if(!data.stopMap[id])return [id];
    return data.stopMap[id].filter(g=>g[0]=="ctb"||g[0]=="kmb").map(g=>g[1]).concat([id]);
}
this.getSameStop = function(id, id2){
    if(!id2)return getSameStop(id);
    var tmp = getSameStop(id);
    this.getSameStop(id2).forEach(g=>{if(!tmp.includes(g))tmp.push(g);});
    return tmp;
}

/**
 * Nearby stop codes around a stop, taken from nearby.json.
 * `forRoute` keeps only related stops: same normalised name (1), opposite pole
 * with a shared route (2) or the same canonical TD stop (8). Proximity-only
 * rows and stops of a different transport mode (4) are dropped.
 * @param {string} id - operator stop id or public stop code
 * @param {boolean} forRoute - use the route-based filter
 * @return {Array<string>} public stop codes, starting with the clicked stop
 */
this.getNearbyStops = function(id, forRoute){
    if(!data)return [id];
    var info = data.stopList[id];
    if(!info)return [id];
    var code = info.code || id;
    var out = [code];
    ((data.nearby && data.nearby[code]) || []).forEach(function(row){
        var flags = row[3] || 0;
        if(forRoute && ((flags & 4) || !(flags & 11)))return;
        if(out.indexOf(row[0]) < 0)out.push(row[0]);
    });
    return out;
}

this.getOppositeRoute = function(co,route,bound /* bound of #1 co */){
    if(typeof co == "string")co = co.toLowerCase().split("+");
    return Object.entries(BusCrawlingData.routeList).filter(([key, value])=>
        (value.co.length == co.length && JSON.stringify(value.co) == JSON.stringify(co)) && value.route==route && value.bound[co[0]]!=bound && value.serviceType == "1")
}
}

/**
 * Renderer of the route picker (route2.html).
 * Route variants sharing the same route number, company and direction are merged
 * into one inbound and one outbound item. Only the visible slice of rows is
 * written to the DOM (windowed / virtual scrolling), so the initial paint does
 * not depend on the number of routes.
 */
function routeList(div, jointRoutes, stopList){
var colist = ["kmb+ctb","ctb","kmb","nlb","lrtfeeder"];
var ROW_H = 70;          // must match .route-item height in route2.html
var BUFFER = 6;          // extra rows rendered above / below the viewport

var tmpdict = {};        // (company, route, direction) buckets
var list = [];           // all grouped items
var view = list;         // items matching the current route-number filter
var scroller = div;      // scroll container (#routetable)
var spacer = null;       // element whose height represents the full list
var inner = null;        // element holding the rendered slice
var lastStart = -1, lastEnd = -1;
var ticking = false;

function escapeHTML(s){
    return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

/**
 * Collect one routeFareList entry into its (company, route, direction) bucket.
 * @param {object} entry - one value of routeFareList.routeList
 * @param {string} href - routeFareList key, used as the route3 link
 * @param {string} dest_en - sentence-cased English destination
 */
this.add = function(entry, href, dest_en){
    let co = _routeCo(entry, jointRoutes);
    if(!colist.includes(co))return;
    let dir = _routeDir(entry);
    let gid = co+"|"+entry.route+"|"+dir;
    if(!tmpdict[gid])tmpdict[gid]=[];
    tmpdict[gid].push({"href":href,"entry":entry,"co":co,"dir":dir,"svc":parseInt(entry.serviceType)||1,"dest_en":dest_en});
}

/**
 * Group the collected entries and draw the first window of rows.
 */
this.gen = function(){
    let now = new Date();
    list = [];

    // first freq table of every (company, route), used when a direction publishes no schedule
    let routeFreqs = {};
    Object.keys(tmpdict).forEach(gid=>{
        let p = gid.split("|");
        let rk = p[0]+"|"+p[1];
        if(routeFreqs[rk])return;
        let arr = tmpdict[gid];
        for(let i=0;i<arr.length;i++){
            let f = arr[i].entry.freq;
            if(f && Object.keys(f).length){routeFreqs[rk]=f;break;}
        }
    });

    Object.values(tmpdict).forEach(arr=>{
        // smallest variant number first; when duplicated, prefer the entry covering all operators
        arr.sort((a,b)=>(a.svc-b.svc)||(_routeCompanyCount(b.entry)-_routeCompanyCount(a.entry)));
        let base = arr[0];

        let variants = [];
        arr.forEach(x=>{
            let v = variants.filter(g=>g.svc==x.svc)[0];
            if(!v){
                v = {"svc":x.svc,"keys":[],"active":false,"href":null,"entry":x.entry,"key":x.href};
                variants.push(v);
            }
            v.keys.push(x);
            if(_routeInService(x.entry.freq, now))v.active = true;
        });
        variants.forEach(v=>{
            v.keys.sort((a,b)=>_routeCompanyCount(b.entry)-_routeCompanyCount(a.entry));
            v.href = v.keys[0].href;
            v.entry = v.keys[0].entry;
            v.key = v.keys[0].href;
        });

        // service table of this direction, falling back to the opposite direction
        // because circular routes publish the schedule on one leg only
        let freq = null;
        variants.forEach(v=>{
            if(!freq && v.entry.freq && Object.keys(v.entry.freq).length)freq = v.entry.freq;
        });
        if(!freq)freq = routeFreqs[base.co+"|"+base.entry.route] || null;

        let active = variants.filter(v=>v.active);
        // link to the smallest currently running variant, otherwise to the base variant
        let target = active.length ? active[0] : variants[0];
        let running = active.length>0 || (freq!=null && _routeInService(freq, now));

        // description:
        //  - not running now   -> service pattern (星期一至五 繁忙時間 / 特定日子服務)
        //  - single variant    -> nothing
        //  - running base      -> nothing
        //  - running variant   -> "[2] 由…開出，以…為終點站"
        let desc = "";
        if(!running){
            desc = _serviceText(freq);
        }else if(variants.length>1 && target.svc!=variants[0].svc){
            let diff = _variantDiff(base.entry, target.entry, stopList);
            desc = diff ? ("["+target.svc+"] "+diff) : "";
        }

        list.push({
            "route": base.entry.route,
            "re": base.entry.route.replace(/(\d+)/, x=>x.padStart(5,"0")),
            "co": base.co,
            "dir": base.dir,
            "desc": desc,
            "href": target.href,
            "dest_tc": base.entry.dest.zh,
            "dest_en": base.dest_en
        });
    });

    // keep the ordering used by the original table: route number, company, direction
    list.sort((a,b)=>{
        if(a.re!=b.re)return a.re<b.re?-1:1;
        if(a.co!=b.co)return colist.indexOf(a.co)-colist.indexOf(b.co);
        if(a.dir!=b.dir)return a.dir<b.dir?-1:1;
        return 0;
    });

    view = list;

    scroller.innerHTML = '<div class="rt-spacer"><div class="rt-list"></div></div>';
    spacer = scroller.firstChild;
    inner = spacer.firstChild;
    if(!scroller.style.position)scroller.style.position = "relative";

    scroller.addEventListener('scroll', function(){
        if(ticking)return;
        ticking = true;
        requestAnimationFrame(function(){ticking=false;render();});
    });
    window.addEventListener('resize', function(){render(true);});

    render(true);
}

/**
 * Build the markup of one route item.
 */
function rowHTML(item, language, bilingual){
    return '<div class="route-item" data-key="'+escapeHTML(encodeURI(item.href))+'">'
        + '<div class="rt-icon"><img src="icon/'+escapeHTML(_T.busIMG(item.co, item.route))+'.png"></div>'
        + '<div class="route-number">'+escapeHTML(item.route)+'</div>'
        + '<div class="route-info">'
        +   '<div class="destination">'+escapeHTML(item["dest_"+language]||item.dest_tc)+'</div>'
        +   '<div class="destination-en">'+(bilingual?escapeHTML(item.dest_en)+" · ":"")+escapeHTML(item.desc||"")+'</div>'
        + '</div>'
        + '</div>';
}

/**
 * Draw the slice of rows currently inside the viewport.
 * @param {boolean} force - redraw even if the visible range did not change
 */
function render(force){
    if(!inner)return;
    let total = view.length;
    spacer.style.height = (total*ROW_H)+"px";

    let top = scroller.scrollTop;
    let height = scroller.clientHeight || 600;
    let start = Math.max(0, Math.floor(top/ROW_H)-BUFFER);
    let end = Math.min(total, Math.ceil((top+height)/ROW_H)+BUFFER);

    if(!force && start===lastStart && end===lastEnd)return;
    lastStart = start;
    lastEnd = end;

    inner.style.transform = "translateY("+(start*ROW_H)+"px)";

    const language = localStorage.getItem('language') || 'tc';
    const bilingual = localStorage.getItem('bilingual') === 'true';

    let html = "";
    for(let i=start;i<end;i++)html += rowHTML(view[i], language, bilingual);
    inner.innerHTML = html;
}

// event delegation: keeps inline handlers (and quoting issues) out of the rows
scroller.addEventListener('click', function(e){
    let row = e.target.closest ? e.target.closest('.route-item') : null;
    if(!row)return;
    window.location.href = 'route3.html?' + row.getAttribute("data-key");
});

/**
 * Filter items by route-number prefix and jump back to the top.
 * @param {string} rt - route number prefix entered on the keypad
 */
this.filter = function(rt){
    view = rt ? list.filter(d=>d.route.startsWith(rt)) : list;
    scroller.scrollTop = 0;
    render(true);
}

/**
 * Number of grouped items, exposed for diagnostics.
 */
this.count = function(){return list.length;}

}