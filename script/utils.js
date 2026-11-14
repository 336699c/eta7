//Version: 20251018


/**
 * @namespace _T
 * @description Utility functions for parsing and processing ETA data
 */
function RawETA(rawdata={},parm={}){
    //private
    var co = "" || parm.co;
    var route = "" || parm.route;
    var stop = "" || parm.stop;
    var bound = "" || parm.bound;
    var seq = "" || parm.seq;

    var data = null;
    var StopMapper = {
        CTB_stop: function(){
            data = rawdata.map(g=>({
                co:g.co,
                dest_en:g.dest_en,
                dest_sc:g.dest_sc,
                dest_tc:g.dest_tc,
                dir:g.dir,
                eta:new Date(g.eta.replace("Z","+08:00")),
                raweta:g.eta,
                offset:0,

                departed:null,
                eta_timestamp:new Date(g.eta.replace("Z","+08:00")).getTime(),
                eta_seq:g.eta_seq,
                rmk_en:g.rmk_en,
                rmk_sc:g.rmk_sc,
                rmk_tc:g.rmk_tc,
                route:g.route,
                seq:g.seq,
                stop:g.stop,
                tdstop:null,
            })).sort((g1,g2)=>g1.eta_timestamp-g2.eta_timestamp).filter(g=>g.raweta)
        },

        KMB_route: function(){
            data = rawdata.map(g=>({
                co:g.co,
                dest_en:g.dest_en,
                dest_sc:g.dest_sc,
                dest_tc:g.dest_tc,
                dir:g.dir,
                eta:g.eta ? new Date(g.eta.replace("Z","+08:00")) : null,
                raweta:g.eta,
                offset:0,

                departed:(g.rmk_tc=="原定班次"?0:1),
                eta_timestamp:g.eta ? new Date(g.eta.replace("Z","+08:00")).getTime() : null,
                eta_seq:g.eta_seq,
                rmk_en:g.rmk_en,
                rmk_sc:g.rmk_sc,
                rmk_tc:g.rmk_tc,
                route:g.route,
                seq:g.seq,
                stop:parm.stop,
                tdstop:null,
            }))
        },

        LRT_feeder: function(){
            data = rawdata.map((g,i)=>({
                co:"LRTFEEDER",
                dest_en:null,
                dest_sc:null,
                dest_tc:null,
                dir:g.lineRef,
                eta:(g.arrivalTimeInSecond&&g.arrivalTimeInSecond!="108000") ? new Date(Date.now()+parseInt(g.arrivalTimeInSecond)*1000) : (g.departureTimeInSecond? new Date(Date.now()+parseInt(g.departureTimeInSecond)*1000) : null),
                raweta:g.arrivalTimeInSecond,
                rawDepart: g.departureTimeInSecond,
                offset:0,
                eta_seq:i,
                departed:(g.isScheduled==1?0:1),
                rmk_en:g.isScheduled,
                rmk_sc:g.isScheduled,
                rmk_tc:(g.isScheduled==1?"未開出 ":"")+` <small>#</small>${g.busId}`,
                busLocation:g.busLocation,
                route:parm.route,
                seq:parm.seq,
                stop:parm.busStopId,
            }));
            data.map(g=>g.eta_timestamp = + g.eta);
        },

        NLB_stop: function(){
            if(rawdata)
            data = rawdata.map(g=>({
                co:"NLB",
                dest_en:null,
                dest_sc:null,
                dest_tc:null,
                dir:bound,
                eta:new Date(g.estimatedArrivalTime.replace("Z","+08:00")),
                raweta:g.estimatedArrivalTime,
                offset:0,

                departed:g.departed,
                eta_timestamp:new Date(g.estimatedArrivalTime.replace("Z","+08:00")).getTime(),
                eta_seq:g.eta_seq,
                rmk_en:g.rmk_en,
                rmk_sc:g.rmk_sc,
                rmk_tc:(g.departed==0?"未開出 ":"")+(g.noGPS==1?"預定班次 ":"")+` <small>${g.routeVariantName}</small>`,
                route:route,
                seq:seq,
                stop:stop,
            })).sort((g1,g2)=>g1.eta_timestamp-g2.eta_timestamp).filter(g=>g.raweta)
        },
        

    }

    //public
    this.route_bus = 0; //How many bus in this stop?
    this.handleMerge = function(){
        //data = data.filter(g=>g.raweta);
        let stop = data.filter(g=>g.stop);
        if(stop.length==0)return this;
        // keep the row key supplied by the caller (joint routes attach results
        // to the stop that was queried, which is not the API's own sequence)
        if(!this.seq)this.seq = stop[0].seq;
        if(!this.stop)this.stop = stop[0].stop;
        data = data.sort((g1,g2)=>g1.eta_timestamp-g2.eta_timestamp);
        return this;
    }

    this.formatETA = function(mode){
        if(!StopMapper[mode])return null;
        StopMapper[mode]();
        return this;
    };
    this.toString = function(){return JSON.stringify(data)};
    this.parm = function(){return parm};
    this.data = function(){return data};
    this.setdata = function(d){data=d;return this};
    this.tag = function(){return co+"_"+route+"_"+stop+"_"+bound+"_"+seq};
    this.route = route; this.co = co; this.stop = stop; this.bound = bound; this.seq = seq;
   
    this.formatETAString = function(parm={mode:1, cos:false, small:true}){
        if(!data)return "";
        var n="";
        data.forEach((w,i)=>{
            if(isNaN(w.eta))return 1; //nulleta
            n+=`<label class="eta_time ${(i!=0)?"eta_time_2":""} ${w.departed==0?"eta_time_gray":""}">
            ${_T.timeparse(w.eta,parm)}` 
                + `<span class="eta_time_rmk">${parm.cos?w.co:""}${w.rmk_tc}</span>`
                +" </label>";
            
            if(w.offset!=0) n+=(`<label class="offset off_${w.offset/Math.abs(w.offset)}">${((_s)=>{var _P = _s>0 ? "+" : "" ; if(_s>60)_P += Math.floor(_s/60)+"m";_s %=60; return _P+_s})(Math.floor(w.offset/1000))}s</label>`)
            n+= "<br>";
        });
        return n
    }

    this.calcBusPos = function(obj){
        /*int timestamp, int buscount = 0*/
        if(!data || data.length == 0 || !data[0].eta_timestamp)return obj;
        this.route_bus = data.filter(g=>g.eta_timestamp && g.eta_timestamp<obj.timestamp).length;
        obj.buscount += this.route_bus;

        const busco_toreplace = ["CTB"];
        if(["CTB","KMB+CTB"].includes(co))
        for(var i=0;i<data.length;i++){
            if(busco_toreplace.includes(data[i].co))data[i].departed = i<obj.buscount;
        }

        obj.timestamp = data[0].eta_timestamp;
        return obj;
    }

    this.calcOffset = function(/*RawETA*/ old){
        if(!old)return;
        let oldData = old.data();
        if(data.length < oldData.length){
            //reversely set data offset, ie eg data length = 1; data[1] = oldData[2]; data[0] = oldData[1]; dont use oldData[0]
            for(var i=data.length-1,j=oldData.length-1;i>=0;i--,j--){
                if(!oldData[j] || !oldData[j].eta_timestamp)continue;
                data[i].offset = oldData[j].offset + data[i].eta_timestamp - oldData[j].eta_timestamp;
            }
            return;
        }

        function calcDiff(a,b,offset=0){
            var sum=0,i=0;
            while(a[i] && b[i+offset]){
                sum += Math.abs(a[i]-b[i+offset]);
                i++;
            }
            return sum/i;
        }

        let norm = Array.from({ length: data.length }, (_, h) => [
            calcDiff(data.map(g => g.eta_timestamp), oldData.map(g => g.eta_timestamp),h),
            h
        ]);
        norm.sort((a,b)=>a[0]-b[0]);
        try{norm[0][1]
        }catch(error){console.log(data,old,norm);return;}
        let bus_offset = norm[0][1];

        for(var i=0;i<data.length;i++){
            let index = bus_offset + i;
            if(!oldData[index])break;
            if(!oldData[index].eta_timestamp)continue;
            data[i].offset = oldData[index].offset + data[i].eta_timestamp - oldData[index].eta_timestamp;
        }
    }
}

function ETAList(){
    //private
    List = [];
    SplitBound = function(obj){
        var result = [];
        var parsedBound = [];
        obj.map(g=>g.dir).forEach(i=>{
            if (obj.length==0 || parsedBound.includes(i))return;
            result.push(obj.filter(w=>w.dir==i));
            parsedBound.push(i);
            obj = obj.filter(w=>w.dir!=i);
        })
        return result;
    }

    PushETA = function(/*RawETA*/ eta){
        let OrigIndex = List.length>0 ? List.findIndex(g=>g.tag() == eta.tag()) : -1;
        if(OrigIndex>-1){
            eta.calcOffset(List[OrigIndex]);
            List[OrigIndex] = eta;
        }else{
            List.push(eta);
        }
        tmpTime = 0;
    }
    //public
    this.PushETA = PushETA;
    this.data = function(){return List.map(g=>g.data())}
    this.data2 = function(){return List}

    //Input
    this.CTB_stop = function(route, stop, seq, callback, bound, expect){
        _T.fetch(`https://rt.data.gov.hk/v2/transport/citybus/eta/ctb/${stop}/${route}`,((w)=>{
        if(!w || !w.data){
            if(callback)callback(null);
            return;
        }
        SplitBound(w.data).forEach(g=>{
            // eta6's bound can be the opposite of the live API direction for
            // joint routes, so accept a group when its destination matches too
            if(bound && (bound!="OI" && g[0].dir != bound)
                && !_T.destMatch(g[0].dest_tc, expect && expect.dest))return;
            PushETA(new RawETA(g,{co:"CTB",route:route,stop:stop,bound:g[0].dir,seq:seq}).formatETA("CTB_stop"))
            });
        if(callback)callback(w.data);
    }));  
    }

    this.KMB_route = function(route, service, rtstop, bound, callback){
        _T.fetch(`https://data.etabus.gov.hk/v1/transport/kmb/route-eta/${route}/${service}`,((w)=>{
        if(!w || !w.data){
            if(callback)callback(null);
            return;
        }
        let tmp = [], tmpseq = 0, tmpdir = "";
        for (var i in w.data){
            if(tmpseq != w.data[i].seq || tmpdir != w.data[i].dir){
                if(tmp.length>0)
                    PushETA(new RawETA(tmp,{co:"KMB",route:route,bound:tmpdir,seq:tmpseq,stop:((bound==tmpdir||bound=="null")? rtstop[tmpseq-1] : null)}).formatETA("KMB_route"))
                tmp = [];
                tmpseq = w.data[i].seq;
                tmpdir = w.data[i].dir;
            }
            tmp.push(w.data[i]);
        }
        PushETA(new RawETA(tmp,{co:"KMB",route:route,bound:tmpdir,seq:tmpseq,stop:((bound==tmpdir||bound=="null")? rtstop[tmpseq-1] : null)}).formatETA("KMB_route"))
        if(callback)callback(w.data);
    }));  
    }

    /**
     * KMB / LWB service type for one route variant.
     *
     * eta6 keys its variants by an ordinal, while the KMB API expects the
     * official service_type (1, 2, 3, 9...). The ordinal is not the service
     * type (A33 inbound variant 1 is service 3), so find the pattern whose
     * stop count matches the variant and whose destination matches the feed.
     */
    var KMB_ROUTE_STOP = "https://data.etabus.gov.hk/v1/transport/kmb/route-stop/";
    var KMB_ETA = "https://data.etabus.gov.hk/v1/transport/kmb/route-eta/";

    function kmbNormDir(b){
        b = String(b == null ? "" : b).toUpperCase();
        if(b == "OI")return "O";
        if(b == "IO")return "I";
        return b.charAt(0) == "I" ? "I" : "O";
    }
    function kmbDirName(d){ return d == "I" ? "inbound" : "outbound"; }
    function kmbSvcGet(k){
        try{ var s = sessionStorage.getItem(k); return s ? JSON.parse(s) : null; }catch(e){ return null; }
    }
    function kmbSvcSet(k,v){
        try{ sessionStorage.setItem(k, JSON.stringify(v)); }catch(e){}
    }

    function routeStopCount(route, dir, svc, cb){
        _T.fetch(KMB_ROUTE_STOP + route + "/" + dir + "/" + svc, function(w){
            cb(w && w.data ? w.data.length : -1);
        });
    }

    function resolveKMBSvc(route, n, dest, bound, cb){
        var want = kmbNormDir(bound);
        var key = "eta7.kmbsvc|" + route + "|" + want + "|" + n + "|" + (dest || "");
        var hit = kmbSvcGet(key);
        if(hit){ cb(hit); return; }

        var dirs = [want, want == "I" ? "O" : "I"];

        function tryDir(di){
            if(di >= dirs.length){ cb({dir: want, svc: 1}); return; }
            var d = dirs[di], apiDir = kmbDirName(d);

            routeStopCount(route, apiDir, 1, function(c1){
                if(c1 == n) return verify(d, [1], 0);
                var list = [], pending = 8;
                for(var svc = 2; svc <= 9; svc++) (function(s){
                    routeStopCount(route, apiDir, s, function(c){
                        if(c == n) list.push(s);
                        if(--pending == 0) probeDone();
                    });
                })(svc);

                function probeDone(){
                    list.sort(function(a,b){ return a - b; });
                    if(!list.length) tryDir(di + 1);
                    else verify(d, list, 0);
                }
            });
        }

        function verify(d, list, i){
            if(i >= list.length){
                // no destination match: accept the first count match
                cb({dir: d, svc: list[0] || 1});
                return;
            }
            _T.fetch(KMB_ETA + route + "/" + list[i], function(w){
                var rows = (w && w.data) || [];
                var ok = rows.some(function(g){
                    return g.dir == d && (!dest || _T.destMatch(g.dest_tc, dest));
                });
                if(ok){
                    var res = {dir: d, svc: list[i], data: rows};
                    kmbSvcSet(key, {dir: d, svc: list[i]});
                    cb(res);
                }else{
                    verify(d, list, i + 1);
                }
            });
        }

        tryDir(0);
    }

    /**
     * Route ETAs for a KMB/LWB variant, using the resolved service type and
     * attaching every ETA to `rowStops` (defaults to the variant's own stops).
     */
    this.KMB_route2 = function(route, stops, bound, dest, rowStops, callback){
        if(!stops || !stops.length){
            if(callback)callback(null);
            return;
        }
        var attach = rowStops || stops;

        function push(res){
            var rows = res.data || [];
            var groups = {}, seqs = [];
            rows.forEach(function(g){
                if(g.dir != res.dir)return;
                var seq = parseInt(g.seq, 10) || 0;
                if(seq < 1 || seq > attach.length)return;
                if(!groups[seq]){ groups[seq] = []; seqs.push(seq); }
                groups[seq].push(g);
            });
            seqs.sort(function(a,b){ return a - b; });
            seqs.forEach(function(seq){
                PushETA(new RawETA(groups[seq], {
                    co:"KMB", route:route, bound:res.dir, seq:seq, stop:attach[seq-1]
                }).formatETA("KMB_route"));
            });
            if(callback)callback(rows);
        }

        resolveKMBSvc(route, stops.length, dest, bound, function(res){
            if(res.data) return push(res);
            _T.fetch(KMB_ETA + route + "/" + res.svc, function(w){
                if(!w || !w.data){ if(callback)callback(null); return; }
                push({dir: res.dir, svc: res.svc, data: w.data});
            });
        });
    }

    /**
     * KMB ETAs for one stop of a joint route. Unlike KMB_route this does not
     * rely on the API sequence matching eta6's stop order: the result is
     * attached to the stop that was queried.
     */
    this.KMB_stop = function(route, kmbStop, rowStop, rowSeq, expect, callback){
        _T.fetch(`https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/${kmbStop}`,((w)=>{
        if(!w || !w.data){
            if(callback)callback(null);
            return;
        }
        let rows = w.data.filter(g=>g.route==route
            && (!expect || !expect.dest || _T.destMatch(g.dest_tc, expect.dest)));
        const wanted = expect && expect.serviceType;
        const hasWanted = wanted && rows.some(g=>g.service_type==wanted);
        rows = rows.filter(g=>g.service_type == (hasWanted ? wanted : 1));

        SplitBound(rows).forEach(g=>{
            if(expect && expect.dir && g[0].dir != kmbNormDir(expect.dir))return;
            PushETA(new RawETA(g,{co:"KMB",route:route,stop:rowStop,bound:g[0].dir,seq:rowSeq}).formatETA("KMB_route"))
        });
        if(callback)callback(w.data);
    }));  
    }

    this.lrtfeeder = function(route, stops, language="zh"){
        fetch("https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule", {
        "headers": {
            "accept": "*/*",
            "content-type": "application/json",
            "sec-fetch-site": "cross-site"
        },
        "body": JSON.stringify({"language":language,"routeName":route}),
        "method": "POST",
        "mode": "cors",
        "credentials": "omit"
        }).then(w=>w.json()).then(w=>{
            console.log(w);
            w.busStop.forEach(g=>{
                if(!stops.includes(g.busStopId))return;
                PushETA(new RawETA(g.bus,{co:"LRTFEEDER",route:w.routeName,bound:null,seq:stops.indexOf(g.busStopId)+1,stop:g.busStopId}).formatETA("LRT_feeder"))
            })
        });
    }

    this.NLB_stop = function(rtid, route, stop, seq, callback, bound){
        _T.fetch(`https://rt.data.gov.hk/v2/transport/nlb/stop.php?action=estimatedArrivals&routeId=${rtid}&stopId=${stop}&language=zh`,((w)=>{
        if(!w || !w.estimatedArrivals){
            if(callback)callback(null);
            return;
        }
        PushETA(new RawETA(w.estimatedArrivals,{co:"NLB",route:route,stop:stop,bound:bound,seq:seq}).formatETA("NLB_stop"))
        if(callback)callback(w.data);
    }));  
    }


    //Output
    tmpList = null;
    tmpTime = 0;
    this.byroute = function(co, route, bound){
        if((Date.now() - tmpTime) < 20000)return tmpList;

        let result = List.filter(g=>(co.includes(g.co.toLowerCase())) && g.route==route && g.stop).sort((a,b)=>a.seq-b.seq);
        if(co.length>1){
            // joint routes fetch each company by stop id, so every entry already
            // belongs to exactly one row; merge the companies per row without
            // any direction or sequence assumptions
            let tmp = {};
            result.forEach(g=>{
                if(!g.data().length)return;
                let k = g.stop + "|" + g.seq;
                if(!tmp[k])tmp[k] = {stop:g.stop, seq:g.seq, rows:[]};
                tmp[k].rows = tmp[k].rows.concat(g.data());
            });

            result = Object.values(tmp).map(t=>{
                let merged = new RawETA({},{"co":"KMB+CTB"}).setdata(
                    t.rows.filter(r=>r.raweta)
                );
                merged.stop = t.stop;
                merged.seq = t.seq;
                return merged.handleMerge();
            });
        }
        result.reduce((acc, g) => g.calcBusPos(acc), {"timestamp":-1,"buscount":0});
        tmpList = result;
        tmpTime = Date.now();
        return result;
    }
}

var _T = {
    /**
     * @function fetch
     * @description Fetch the ETA data from API asynchronously 
     * @param {string} theUrl - The URL of the API endpoint
     * @param {function} callback - The callback function to process the response
     * @param {*} parm - Additional parameter to be passed to the callback function
     */
    fetch: async function (theUrl, callback, parm) {
        var xmlHttp = new XMLHttpRequest();
        xmlHttp.onreadystatechange = function() { 
            if (xmlHttp.readyState != 4)return;
            var data = null;
            try{
                data = xmlHttp.status == 200 ? JSON.parse(xmlHttp.responseText) : null;
            }catch(error){}
            // always call back so callers can decrement their pending counters
            callback(data,parm,xmlHttp);
        }
        xmlHttp.open("GET", theUrl, true); 
        xmlHttp.send(null);
    },

    /**
     * Tolerant destination comparison ("堅尼地城" vs "堅尼地城(卑路乍灣)").
     */
    destMatch: function(a,b){
        var norm = function(s){return String(s==null?"":s).replace(/[\s()（）]/g,"");};
        a = norm(a); b = norm(b);
        if(!a || !b)return false;
        return a===b || a.indexOf(b)>=0 || b.indexOf(a)>=0;
    },

    /**
     * @function timeparse
     * @description Parse the ETA time string into a human-readable format
     * @param {string|Date} e - The time string to be parsed
     * @param {object} parm - Object containing parameters for the parsing
     * mode 0 for default, mode 1 for 24-hour time
     * jj for "即將抵達"
     * small for small font
     * @default {mode:0,jj:false,small:false}
     * @return {string} The parsed time string
     */
    timeparse : function(e,parm={}){
        var _S={"m":"分","s":"秒"};
        if(parm.small)_S={"m":"<small>分</small>","s":"<small>秒</small>"};

        if (!(e instanceof Date)) {
            try{
            e = new Date(e.replace("Z","+08:00"))
            }catch(error){return "";}
        }

        let diffSeconds = Math.floor((e - new Date()) / 1000);
        
        if (parm.mode === 1) {
            let result = (e instanceof Date ? e.toTimeString().substring(0,8) : e.toTimeString().slice(0, 5));
            return `${result.substring(0,5)}<small style="padding-left:2px;"><small>${result.substring(6)}</small></small>`;
        }
        if (diffSeconds <= 0) 
            return `${parm.jj?"即將抵達":""} -${Math.abs(diffSeconds)}${_S.s}`;
        if (diffSeconds <= 90) 
            return `${diffSeconds}${_S.s}`;
        if (diffSeconds < 480) {
            let minutes = Math.floor(diffSeconds / 60);
            let seconds = diffSeconds % 60;
            return `${minutes}${_S.m}${seconds}${_S.s}`;
        }
        return `${Math.floor(diffSeconds / 60)}${_S.m}`;
    
    },

    /**
     * @function timeparse2
     * @description Format time duration in seconds to a human-readable string
     * @param {number} sec - The time duration in seconds
     * @return {string} Formatted time string in the format of "Xm Ys" or "Zs" or "即將抵達"
     */
    timeparse2 : function(sec){
        return (sec < 0 ? "-" : "+") + (Math.abs(sec) <= 60 ? Math.abs(sec) + "s" : Math.floor(Math.abs(sec) / 60) + "m" + Math.abs(sec) % 60 + "s");
    },

    /**
     * @function MTR_ETA
     * @description Fetch the ETA data from API asynchronously 
     * @param {string} line - The line code of the MTR line
     * @param {string} sta - The station code of the MTR station
     * @param {function} callback - The callback function to process the response
     */
    MTR_ETA: function(line, sta, callback){
        this.fetchETA(`https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${line}&sta=${sta}`, function(data){
            var s = {
                "parm":line+"+"+sta,
                "ID":++(_T.ETAID),
                "line": line,
                "sta": sta,
                "timestamp":Date.now(),
                "dict":["UP","DOWN"]
            };
            ["UP","DOWN"].forEach(d=>{
                try{
                    s[d] = Object.values(data.data)[0][d];
                    s[d].forEach(g=>g.delta = 0);
                }catch(e){console.log(d,e)}
            });
            _T.pushETA(s);
            if(callback)callback(s,_T.ETAID)
        });
    },

    /**
     * @function busIMG
     * @description Determines the image name based on company and route
     * @param {object} data - The data object containing company and route information
     * @param {string} data.co - The company code (e.g., "CTB", "KMB")
     * @param {string} data.r - The route code
     * @param {string} _ - overrider, where data --> co and _ --> route number
     * @return {string} The image name
     */
    busIMG: function(data,_){
        if(_)data = {"co":data, "r":_}; //override
        try{data.co = data.co.toUpperCase();}catch(error){}
        // Check if the company is "CTB" and the route starts with "A" or "NA"
        if (data.co === "CTB" && /^(A|NA)/.test(data.r)) {
            return "ctb_airport";
        }
        // Check if the company is "KMB" and the route starts with "A" or "NA"
        else if (data.co === "KMB" && /^(A|NA)/.test(data.r)) {
            return "lwb";
        }
        // Default case: return the company code
        return data.co;
    },

    routeREGEXP: function(v) {
    var Q1 = /[A-Z][0-9]+/;
    if (Q1.exec(v))return v;
        
    var YYY = parseInt(v).toString().padStart(4, '0');
    var mmm = /[A-Z]/g;
    var nnn = mmm.exec(v);
    return YYY + (nnn ? nnn[0] : '');
    }
}



{ 
`
fetch("https://search.kmb.hk/KMBWebSite/Function/FunctionRequest.ashx?action=getbbiforroute&route=91&bound=1", {
  "headers": {
    "accept": "*/*",
            "content-type": "application/json",
            "sec-fetch-site": "cross-site"
  },
  "referrer": "https://search.kmb.hk/KMBWebSite/?action=routesearch&route=91",
  "body": null,
  "method": "POST",
"mode": "cors",
"credentials": "omit"
});
`}