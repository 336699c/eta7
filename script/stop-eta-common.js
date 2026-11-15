/**
 * Shared logic for stop-eta-bystop.html and stop-eta-byroute.html.
 *
 * Both pages take the same input (a list of stop ids) and differ only in how
 * the arrivals are presented. ETAs are fetched per physical stop from every
 * operator that serves it, so joint KMB+CTB / LWB+CTB routes show both
 * companies at once.
 */
(function (global) {
    "use strict";

    var SE = {};

    var CTB_BATCH = "https://rt.data.gov.hk/v1/transport/batch/stop-eta/ctb/";
    var KMB_STOP = "https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/";
    var KMB_ROUTE = "https://data.etabus.gov.hk/v1/transport/kmb/route-eta/";
    var CTB_ETA = "https://rt.data.gov.hk/v2/transport/citybus/eta/ctb/";

    SE.input = {};
    SE.legacy = null;
    SE.nearby = {};
    SE.stops = [];
    SE.flat = [];
    SE.CHG = null;
    SE.onUpdate = function () {};
    SE.prevEta = {};
    SE.hiddenStops = {};
    SE.refreshTimer = null;
    SE.tickTimer = null;

    /* ---------- helpers ---------- */

    function getJSON(url) {
        return new Promise(function (resolve) {
            var x = new XMLHttpRequest();
            x.onreadystatechange = function () {
                if (x.readyState != 4) return;
                var d = null;
                try { d = x.status == 200 ? JSON.parse(x.responseText) : null; } catch (e) {}
                resolve(d);
            };
            x.open("GET", url, true);
            x.send(null);
        });
    }

    function parseDate(s) {
        if (!s) return null;
        var t = Date.parse(String(s).replace(" ", "T"));
        return isNaN(t) ? null : t;
    }

    function classify(id) {
        if (/^\d{6}$/.test(id)) return "CTB";
        if (/^[0-9A-F]{16}$/.test(id)) return "KMB";
        return null;
    }

    function unique(list) {
        var seen = {}, out = [];
        list.forEach(function (x) {
            if (seen[x]) return;
            seen[x] = 1;
            out.push(x);
        });
        return out;
    }

    function destKey(s) {
        var t = String(s == null ? "" : s).replace(/\s/g, "");
        // operators name the same terminus differently, e.g. 荔枝角(盈暉臺) vs
        // 荔枝角; drop a trailing bracket unless it marks a routing variant
        return t.replace(/[（(]([^（()）]*)[)）]$/, function (m, inner) {
            return /^(經|经|via)/i.test(inner) ? m : "";
        });
    }

    function routeCmp(a, b) {
        var an = a.match(/\d+/g), bn = b.match(/\d+/g);
        if (!an && !bn) return a > b ? 1 : (a < b ? -1 : 0);
        if (!an) return -1;
        if (!bn) return 1;
        var sa = a.replace(/\d+/g, function (m) { return ("00000" + m).slice(-5); });
        var sb = b.replace(/\d+/g, function (m) { return ("00000" + m).slice(-5); });
        return sa > sb ? 1 : (sa < sb ? -1 : 0);
    }

    /* ---------- parameters ---------- */

    SE.parse = function () {
        var q = {};
        (location.search || "").replace(/^\?/, "").split("&").forEach(function (p) {
            if (!p) return;
            var i = p.indexOf("=");
            var k = i < 0 ? p : p.slice(0, i);
            var v = i < 0 ? "" : p.slice(i + 1);
            try { q[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { q[k] = v; }
        });
        SE.input = {
            stops: (q.stops || "").split(",").filter(Boolean),
            time: q.time ? parseInt(q.time, 10) || 0 : 0,
            color: q.color == "1" || q.color == "true",
            nort: q.nort ? q.nort.split(",").filter(Boolean) : [],
            byrt: q.byrt == "1" || q.byrt == "true",
            bkmark: q.bkmark,
            origstop: q.origstop || null,
            CHG: q.CHG || null
        };
        return SE.input;
    };

    SE.viewURL = function (page) {
        var p = {stops: SE.stops.map(function (s) { return s.code; }).join(",")};
        if (SE.input.time) p.time = SE.input.time;
        if (SE.input.color) p.color = 1;
        if (SE.input.nort.length) p.nort = SE.input.nort.join(",");
        if (SE.input.bkmark) p.bkmark = SE.input.bkmark;
        if (SE.input.origstop) p.origstop = SE.input.origstop;
        if (SE.input.CHG) p.CHG = SE.input.CHG;
        return page + "?" + Object.keys(p).map(function (k) {
            return k + "=" + encodeURIComponent(p[k]);
        }).join("&");
    };

    /* ---------- data ---------- */

    SE.load = function () {
        return new Promise(function (resolve, reject) {
            function run() {
                Eta6.legacy().then(function (d) {
                    SE.legacy = d;
                    return Eta6.routeFareList();
                }).then(function (d) {
                    SE.nearby = (d && d.nearby) || {};
                    resolve(SE.legacy);
                }).catch(reject);
            }
            if (global.Eta6) return run();
            var s = document.createElement("script");
            s.src = "script/eta6-data.js";
            s.onload = function () { global.Eta6 ? run() : reject(new Error("eta6")); };
            s.onerror = function () { reject(new Error("eta6")); };
            document.head.appendChild(s);
        });
    };

    /**
     * Company-styled stop name chosen in the settings, or null when the
     * setting is "auto" or that operator has no published name for the stop.
     * @param {object} rec - legacy stop record
     * @param {string} lang - "zh" or "en"
     * @return {string|null}
     */
    function preferredName(rec, lang) {
        var sel = null;
        try { sel = localStorage.getItem("coopStopName"); } catch (e) {}
        if (sel != "ctb" && sel != "kmb") return null;
        var by = rec && rec.byCo && rec.byCo[sel == "ctb" ? "CTB" : "KMB"];
        var name = by && (typeof by == "string" ? by : by[lang]);
        return name || null;
    }

    SE.buildStops = function () {
        var seen = {};
        SE.stops = [];
        SE.input.stops.forEach(function (id) {
            var rec = SE.legacy.stoplist[id];
            if (!rec) return;
            var code = rec.code || id;
            if (seen[code]) return;
            seen[code] = 1;
            var data = rec.data || {};
            SE.stops.push({
                code: code,
                name_tc: preferredName(rec, "zh") || data.name_tc || code,
                name_en: preferredName(rec, "en") || data.name_en || "",
                ids: unique([code].concat(rec.alt || [])),
                rt: rec.rt || [],
                rows: []
            });
        });
    };

    /**
     * Same physical stop group around `code`, keyed by public stop code.
     * A nearby row counts when its flag has bit 8 (the TD dataset treats
     * both poles as one stop). The requested stop itself is always included.
     * @param {string} code - public stop code or operator stop id
     * @return {Object<string,{dist:number}>}
     */
    SE.sameStopCodes = function (code) {
        var out = {};
        if (!code) return out;
        var rec = SE.legacy && SE.legacy.stoplist[code];
        var base = (rec && rec.code) || code;
        out[base] = {dist: -1};
        ((SE.nearby || {})[base] || []).forEach(function (row) {
            if (!((row[3] || 0) & 8)) return;
            if (out[row[0]]) return;
            out[row[0]] = {dist: row[1] || 0};
        });
        return out;
    };

    function normCTB(list, stop) {
        return (list || []).map(function (w) {
            return {
                co: "CTB", route: w.route, dir: w.dir, dest: w.dest || w.dest_tc || "",
                eta: parseDate(w.eta), eta_seq: w.eta_seq, rmk: w.rmk || w.rmk_tc || "",
                seq: w.seq, stopId: w.stop || "", stopCode: stop.code,
                stopName: stop.name_tc, delay: null
            };
        }).filter(function (r) { return r.eta; });
    }

    function normKMB(list, stop, queryId) {
        return (list || []).filter(function (w) {
            return w.service_type == 1;
        }).map(function (w) {
            return {
                co: "KMB", route: w.route, dir: w.dir, dest: w.dest_tc || "",
                eta: parseDate(w.eta), eta_seq: w.eta_seq, rmk: w.rmk_tc || "",
                seq: w.seq, stopId: queryId, stopCode: stop.code,
                stopName: stop.name_tc, delay: null
            };
        }).filter(function (r) { return r.eta; });
    }

    SE.fetchStop = function (stop) {
        var jobs = [];
        stop.ids.forEach(function (id) {
            var kind = classify(id);
            if (kind == "CTB") {
                jobs.push(getJSON(CTB_BATCH + id + "?lang=zh-hant").then(function (j) {
                    return normCTB(j && j.data, stop);
                }));
            } else if (kind == "KMB") {
                jobs.push(getJSON(KMB_STOP + id).then(function (j) {
                    return normKMB(j && j.data, stop, id);
                }));
            }
        });
        return Promise.all(jobs).then(function (lists) {
            stop.rows = [].concat.apply([], lists);
            return stop.rows;
        });
    };

    /* ---------- presentation helpers ---------- */

    /* one arrival group = one route towards one destination; operators that
       run the route jointly are merged here so both companies' ETAs show */
    SE.groupKey = function (row) {
        return row.route + "|" + destKey(row.dest);
    };

    SE.hidden = function (row) {
        if (SE.hiddenStops[row.stopCode]) return true;
        return SE.input.nort.indexOf(SE.groupKey(row)) >= 0;
    };

    /* a route is jointly operated at this stop when the static stop/routes
       data lists both KMB and CTB, even if one side has no trip right now */
    function jointAt(stop, route) {
        var has = {};
        (stop.rt || []).forEach(function (k) {
            var p = k.split("_");
            if (p[1] === route) has[p[0]] = 1;
        });
        return !!(has.CTB && has.KMB);
    }

    /**
     * Every static route pattern that calls at this stop, regardless of
     * whether the live ETA feed currently has an arrival for it.
     * @param {object} stop - legacy stop record
     * @return {Array<{co:string,route:string,dest:string,dir:string}>}
     */
    function staticGroupsAt(stop) {
        var out = [];
        (stop.rt || []).forEach(function (key) {
            var cut = key.indexOf("_");
            if (cut < 0) return;
            var co = key.slice(0, cut);
            var route = key.slice(cut + 1);
            var entry = SE.legacy && SE.legacy.rtlist[co] && SE.legacy.rtlist[co][route];
            if (!entry) return;
            Object.keys(entry.var).forEach(function (vk) {
                var v = entry.var[vk];
                var hit = stop.ids.some(function (id) {
                    return v.stops.indexOf(id) >= 0;
                });
                if (!hit) return;
                out.push({co: co, route: route, dest: v.dest_tc || "", dir: v.bound});
            });
        });
        return out;
    }

    SE.routeGroups = function (stop) {
        var map = {};
        stop.rows.forEach(function (r) {
            if (SE.hidden(r)) return;
            var k = SE.groupKey(r);
            if (!map[k]) map[k] = {key: k, route: r.route, dest: r.dest, dirs: {}, cos: {}, etas: []};
            map[k].dirs[r.dir] = 1;
            map[k].cos[r.co] = 1;
            map[k].etas.push(r);
        });
        // routes with no live arrival still get a row, using the static data
        var liveRoute = {};
        Object.keys(map).forEach(function (k) { liveRoute[map[k].route] = 1; });
        staticGroupsAt(stop).forEach(function (s) {
            if (liveRoute[s.route]) return;
            var k = s.route + "|" + destKey(s.dest);
            if (SE.input.nort.indexOf(k) >= 0) return;
            if (!map[k]) map[k] = {key: k, route: s.route, dest: s.dest, dirs: {}, cos: {}, etas: []};
            map[k].dirs[s.dir] = 1;
            map[k].cos[s.co] = 1;
        });
        return Object.keys(map).map(function (k) {
            var g = map[k];
            g.dirs = Object.keys(g.dirs);
            g.cos = Object.keys(g.cos);
            g.joint = g.cos.length > 1 || jointAt(stop, g.route);
            g.etas.sort(function (a, b) { return a.eta - b.eta; });
            g.icon = g.joint ? "KMB+CTB" : SE.iconFor(g.cos, g.route);
            g.fare = SE.fare(g.etas[0]);
            return g;
        }).sort(function (a, b) {
            var ea = a.etas.length ? a.etas[0].eta : Infinity;
            var eb = b.etas.length ? b.etas[0].eta : Infinity;
            if (ea !== eb) return ea - eb;
            return routeCmp(a.route, b.route);
        });
    };

    SE.flatRows = function () {
        SE.stops.forEach(function (s, i) {
            s.rows.forEach(function (r) { r.stopIndex = i; });
        });
        SE.flat = [].concat.apply([], SE.stops.map(function (s) { return s.rows; }));
        return SE.flat.filter(function (r) { return !SE.hidden(r); }).sort(function (a, b) {
            if (a.eta !== b.eta) return a.eta - b.eta;
            var c = routeCmp(a.route, b.route);
            if (c) return c;
            return a.stopIndex - b.stopIndex;
        });
    };

    /* route keys are remembered across refreshes so a hidden route can always
       be switched back on from the settings sheet */
    SE.knownKeys = {};

    SE.routeKeys = function () {
        SE.stops.forEach(function (s) {
            s.rows.forEach(function (r) {
                var k = SE.groupKey(r);
                if (!SE.knownKeys[k]) {
                    SE.knownKeys[k] = {key: k, route: r.route, dest: r.dest, cosMap: {}};
                }
                SE.knownKeys[k].cosMap[r.co] = 1;
            });
            staticGroupsAt(s).forEach(function (g) {
                var k = g.route + "|" + destKey(g.dest);
                if (!SE.knownKeys[k]) {
                    SE.knownKeys[k] = {key: k, route: g.route, dest: g.dest, cosMap: {}};
                }
                SE.knownKeys[k].cosMap[g.co] = 1;
            });
        });
        return Object.keys(SE.knownKeys).map(function (k) {
            var e = SE.knownKeys[k];
            return {key: e.key, route: e.route, dest: e.dest, cos: Object.keys(e.cosMap)};
        }).sort(function (a, b) { return routeCmp(a.route, b.route); });
    };

    SE.setAllRoutes = function (hide) {
        SE.input.nort = hide ? SE.routeKeys().map(function (k) { return k.key; }) : [];
        SE.onUpdate(false);
    };

    SE.toggleStop = function (code) {
        SE.hiddenStops[code] = !SE.hiddenStops[code];
        SE.onUpdate(false);
    };

    SE.setColor = function (on) {
        SE.input.color = !!on;
        SE.onUpdate(false);
    };

    SE.iconFor = function (cos, route) {
        if (cos.length > 1) return "KMB+CTB";
        var co = cos[0];
        if (co == "CTB" && /^(A|NA)\d/.test(route)) return "ctb_airport";
        if (co == "KMB" && /^(A|NA)\d/.test(route)) return "lwb";
        if (co == "NLB") return "NLB";
        if (co == "LRTFEEDER" || co == "MTR") return "LRTFEEDER";
        return co ? co.toLowerCase() : "kmb";
    };

    SE.fare = function (row) {
        if (!row) return "";
        var co = row.co == "LWB" ? "KMB" : row.co;
        var routes = SE.legacy.rtlist[co] && SE.legacy.rtlist[co][row.route];
        if (!routes) return "";
        var v = routes.var[row.dir], idx = v ? v.stops.indexOf(row.stopId) : -1;
        if (idx < 0) {
            Object.keys(routes.var).some(function (k) {
                var j = routes.var[k].stops.indexOf(row.stopId);
                if (j >= 0) { v = routes.var[k]; idx = j; return true; }
                return false;
            });
        }
        if (idx < 0) return "";
        var p = ((routes.fare[v.bound]) || [])[idx];
        if (!p || !p.length) return "";
        return p.map(function (q) { return "$" + q[0]; }).join(" / ");
    };

    SE.etaText = function (ts) {
        if (!ts) return "—";
        if (SE.input.time == 1) {
            var d = new Date(ts);
            return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
        }
        var s = Math.round((ts - Date.now()) / 1000);
        //if (s <= 0) return "即將";
        if (s < 60) return s + "秒";
        var m = Math.floor(s / 60);
        if (m < 60) {
            return m + "分" + (SE.input.time == 0 && s % 60 ? ("0" + s % 60).slice(-2) + "秒" : "");
        }
        return Math.floor(m / 60) + "時" + (m % 60) + "分";
    };

    SE.delayText = function (ms) {
        if (!ms || Math.abs(ms) < 15000) return "";
        var s = Math.round(ms / 1000);
        var sign = s > 0 ? "+" : "";
        if (Math.abs(s) >= 60) return sign + Math.round(s / 60) + "分";
        return sign + s + "秒";
    };

    SE.chgNote = function (row) {
        if (!row || !SE.CHG || !SE.input.CHG) return "";
        var entry = SE.CHG[SE.input.CHG];
        var list = entry && entry[1];
        if (!list) return "";
        var zc = list.filter(function (w) { return w.route == row.route; });
        if (!zc.length) return "";
        var z = zc[0];
        return [z.route, z.direction, z.dInfo, z.stopName ? "@" + z.stopName : "",
            z.timeLimit ? "時限:" + z.timeLimit + "分" : "", z.remark || ""]
            .filter(Boolean).join(" · ");
    };

    /* ---------- refresh ---------- */

    function calcDelays() {
        var next = {};
        SE.stops.forEach(function (stop) {
            stop.rows.forEach(function (r) {
                var k = r.co + "|" + r.route + "|" + r.dir + "|" + r.stopId + "|" + r.eta_seq;
                if (SE.prevEta[k]) r.delay = r.eta - SE.prevEta[k];
                next[k] = r.eta;
            });
        });
        SE.prevEta = next;
    }

    SE.refresh = function () {
        return Promise.all(SE.stops.map(SE.fetchStop)).then(function () {
            calcDelays();
            SE.onUpdate(false);
        });
    };

    SE.setTime = function (mode) {
        SE.input.time = mode;
        SE.onUpdate(false);
    };

    SE.toggleRoute = function (key) {
        var i = SE.input.nort.indexOf(key);
        if (i < 0) SE.input.nort.push(key);
        else SE.input.nort.splice(i, 1);
        SE.onUpdate(false);
    };

    SE.saveBookmark = function () {
        var list = [];
        try { list = JSON.parse(localStorage.getItem("bookmarks") || "[]"); } catch (e) {}
        list.push({
            name: "新書簽",
            stops: SE.stops.map(function (s) { return s.ids; }),
            preference: {
                time: SE.input.time, color: SE.input.color ? 1 : 0,
                nort: SE.input.nort, byrt: SE.input.byrt ? 1 : 0
            }
        });
        localStorage.setItem("bookmarks", JSON.stringify(list));
        return list.length;
    };

    /* ---------- vehicle progress ---------- */

    function variantWithStop(co, route, stopId) {
        var e = SE.legacy.rtlist[co] && SE.legacy.rtlist[co][route];
        if (!e) return null;
        var found = null;
        Object.keys(e.var).some(function (k) {
            if (e.var[k].stops.indexOf(stopId) >= 0) { found = e.var[k]; return true; }
            return false;
        });
        return found;
    }

    function stopName(id) {
        var rec = SE.legacy.stoplist[id];
        return preferredName(rec, "zh")
            || (rec && rec.data && rec.data.name_tc) || id;
    }

    /** Great-circle distance between two lat/lng points, in metres. */
    function haversine(lat1, lng1, lat2, lng2) {
        var R = 6371000;
        var toRad = Math.PI / 180;
        var dLat = (lat2 - lat1) * toRad;
        var dLng = (lng2 - lng1) * toRad;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad)
            * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /**
     * Resolve the next stop along the route for one arrival row.
     * Returns {name, distance} or null when the information is unavailable
     * (e.g. the stop is the terminus or the route variant cannot be found).
     */
    SE.nextStopInfo = function (row) {
        var v = variantWithStop(row.co, row.route, row.stopId);
        if (!v) return null;
        var idx = v.stops.indexOf(row.stopId);
        if (idx < 0) return null;
        var nextId = v.stops[idx + 1];
        if (!nextId) return null;
        var a = SE.legacy.stoplist[row.stopId];
        var b = SE.legacy.stoplist[nextId];
        if (!a || !b || !a.data || !b.data) return null;
        return {
            name: stopName(nextId),
            distance: Math.round(haversine(a.data.lat, a.data.long, b.data.lat, b.data.long))
        };
    };

    /**
     * Resolve "where is the bus" for one arrival. Returns a promise of rows
     * [{seq, name, eta}] or [] when the information is not available.
     */
    SE.busProgress = function (row) {
        if (row.co == "KMB") {
            return getJSON(KMB_ROUTE + row.route + "/1").then(function (j) {
                if (!j || !j.data) return [];
                var v = variantWithStop("KMB", row.route, row.stopId);
                return j.data.filter(function (w) {
                    return w.service_type == 1 && w.dir == row.dir
                        && w.eta_seq == row.eta_seq && w.seq <= row.seq && w.eta;
                }).sort(function (a, b) { return a.seq - b.seq; }).slice(-6).map(function (w) {
                    var id = v && v.stops[w.seq - 1];
                    return {seq: w.seq, name: id ? stopName(id) : "", eta: parseDate(w.eta)};
                });
            });
        }
        if (row.co == "CTB") {
            var v = variantWithStop("CTB", row.route, row.stopId);
            if (!v) return Promise.resolve([]);
            var idx = v.stops.indexOf(row.stopId);
            var prev = v.stops[idx - 1];
            if (!prev) return Promise.resolve([]);
            return getJSON(CTB_ETA + prev + "/" + row.route).then(function (j) {
                if (!j || !j.data) return [];
                var w = j.data.filter(function (x) { return x.dir == row.dir && x.eta; })[0];
                if (!w) return [];
                return [{seq: w.seq, name: stopName(prev), eta: parseDate(w.eta)}];
            });
        }
        return Promise.resolve([]);
    };

    /* ---------- boot ---------- */

    SE.init = function (onUpdate) {
        SE.onUpdate = onUpdate || function () {};
        SE.parse();
        return SE.load().then(function () {
            SE.buildStops();
            if (SE.input.CHG) {
                return getJSON("https://raw.githubusercontent.com/996633c/eta2/data/CHG.json")
                    .then(function (j) { SE.CHG = j; });
            }
        }).then(function () {
            return SE.refresh();
        }).then(function () {
            clearInterval(SE.refreshTimer);
            clearInterval(SE.tickTimer);
            SE.refreshTimer = setInterval(function () {
                if (document.visibilityState == "visible") SE.refresh();
            }, 45000);
            SE.tickTimer = setInterval(function () {
                if (document.visibilityState == "visible") SE.onUpdate(true);
            }, 1000);
        }).catch(function (e) {
            console.error(e);
            var p = document.createElement("p");
            p.style.cssText = "color:#b00;padding:12px;font-family:system-ui";
            p.textContent = "eta6 資料載入失敗，請重新整理。";
            document.body.insertBefore(p, document.body.firstChild);
        });
    };

    global.SE = SE;
})(window);
