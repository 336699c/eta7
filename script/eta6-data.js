/**
 * eta6 static dataset -> legacy eta data shapes.
 *
 * The original site reads two external datasets:
 *   - hkbus/hk-bus-crawling routeFareList.min.json  (route2, route3, index)
 *   - 996633c/eta2 _rtlist.json / _stoplist.json    (v13 pages, bystop)
 *
 * eta7 replaces both with the eta6 static files published on the `data`
 * branch. This module rebuilds the exact legacy shapes at runtime so the
 * original pages and scripts stay untouched:
 *
 *   Eta6.routeFareList() -> {routeList, stopList, stopMap}   (hkbus shape)
 *   Eta6.legacy()        -> {rtlist, stoplist}               (eta2 shape)
 *
 * Nothing is persisted; both objects are produced from the same in-memory
 * dataset and memoised for the lifetime of the page.
 */
(function (global) {
"use strict";

var BASE = "https://raw.githubusercontent.com/336699c/eta6/refs/heads/data/static/";
var NLB_ROUTE_LIST = "https://rt.data.gov.hk/v2/transport/nlb/route.php?action=list";

var SUPPORTED = ["ctb", "kmb", "nlb", "lrtfeeder"];
var OPS = ["CTB", "KMB", "NLB", "MTR"];
var OP_FOR = {"ctb": "CTB", "kmb": "KMB", "nlb": "NLB", "lrtfeeder": "MTR"};
var NEARBY_RADIUS = 80;   // metres, fallback when operator_map has no match

/** Map an eta6 agency to the lower-case company key used by the frontend. */
function coKey(c) {
    if (c === "LWB") return "kmb";            // LWB shares the KMB stop/ETA APIs
    if (c === "LRTFeeder") return "lrtfeeder";
    return String(c).toLowerCase();
}

/** Map an eta6 agency to the operator key used by operator_map.json. */
function opKey(c) {
    if (c === "LWB") return "KMB";
    if (c === "LRTFeeder") return "MTR";
    return c;
}

function hhmm(s) {
    return String(s).replace(":", "").padStart(4, "0");
}

function dayMask(svc) {
    var mask = 0;
    for (var i = 0; i < 7; i++) if (svc.days[i]) mask |= 1 << i;
    return mask;
}

function fetchJSON(url, optional) {
    return fetch(url).then(function (r) {
        if (!r.ok) throw new Error(url + " -> " + r.status);
        return r.json();
    }).catch(function (e) {
        if (optional) return null;
        throw e;
    });
}

var NLB_CACHE_KEY = "eta7.nlb.routes";
var nlbCache = null;

/** Cached NLB route list (sessionStorage keeps it across page loads). */
function nlbRoutesSync() {
    if (nlbCache) return nlbCache;
    try {
        var raw = sessionStorage.getItem(NLB_CACHE_KEY);
        if (raw) nlbCache = JSON.parse(raw);
    } catch (e) {}
    return nlbCache;
}

/** NLB route list is only needed by NLB route pages; fetch it once. */
function nlbRoutes() {
    var cached = nlbRoutesSync();
    if (cached) return Promise.resolve(cached);
    return fetchJSON(NLB_ROUTE_LIST, true).then(function (d) {
        if (d) {
            nlbCache = d;
            try { sessionStorage.setItem(NLB_CACHE_KEY, JSON.stringify(d)); } catch (e) {}
        }
        return d;
    });
}

function load() {
    if (state.promise) return state.promise;

    state.promise = Promise.all([
        fetchJSON(BASE + "index.json"),
        fetchJSON(BASE + "routeStop.json"),
        fetchJSON(BASE + "stops.json"),
        fetchJSON(BASE + "stop_routes.json"),
        fetchJSON(BASE + "operator_map.json"),
        fetchJSON(BASE + "nearby.json")
    ]).then(function (r) {
        return build(r[0], r[1], r[2], r[3], r[4], r[5], nlbRoutesSync());
    });

    return state.promise;
}

var state = {promise: null};

function build(index, routeStop, stops, stopRoutes, operatorMap, nearby, nlbList) {
    /* ---------- operator stop id <-> TD code ---------- */

    var opIds = {};                         // op -> code -> [{id,d,c}] best first
    OPS.forEach(function (op) {
        var src = ((operatorMap.operators || {})[op] || {}).stops || {};
        var byCode = opIds[op] = {};
        Object.keys(src).forEach(function (id) {
            var rec = src[id];
            if (!rec || !rec.code) return;
            var arr = byCode[rec.code] || (byCode[rec.code] = []);
            arr.push({id: id, d: rec.d == null ? 999 : rec.d, c: rec.c == null ? 0 : rec.c});
        });
        Object.keys(byCode).forEach(function (code) {
            byCode[code].sort(function (a, b) { return a.d - b.d || b.c - a.c; });
        });
    });

    var resolveCache = {};
    /**
     * Operator stop id for a TD code. Falls back to the nearest matched code
     * within NEARBY_RADIUS metres, then to the TD code itself.
     */
    function resolve(op, code) {
        var k = op + "|" + code;
        if (k in resolveCache) return resolveCache[k];

        var found = null;
        var direct = opIds[op] && opIds[op][code];
        if (direct && direct.length) {
            found = direct[0].id;
        } else {
            var list = nearby[code] || [];
            for (var i = 0; i < list.length; i++) {
                if (list[i][1] > NEARBY_RADIUS) continue;
                var arr = opIds[op] && opIds[op][list[i][0]];
                if (arr && arr.length) { found = arr[0].id; break; }
            }
        }
        resolveCache[k] = found;
        return found;
    }

    var idsAtCache = {};
    /** One best operator id per company for a TD code, as [company, id]. */
    function idsAt(code) {
        if (idsAtCache[code]) return idsAtCache[code];
        var out = [];
        OPS.forEach(function (op) {
            var arr = opIds[op] && opIds[op][code];
            if (arr && arr.length) out.push([op.toLowerCase(), arr[0].id]);
        });
        idsAtCache[code] = out;
        return out;
    }

    function stopInfo(code) {
        var s = stops[code] || {};
        var loc = s.loc || [0, 0];
        var ops = s.ops || {};
        return {
            name: {zh: s.zh || "", en: s.en || ""},
            // some operators publish a different stop name (English only)
            byCo: {
                CTB: ops.CTB || null,
                KMB: ops.KMB || ops["KMB+CTB"] || null
            },
            td: s.td || code,
            location: {lat: loc[0], lng: loc[1]},
            code: code
        };
    }

    /* ---------- hkbus routeFareList shape ---------- */

    var stopList = {};
    var stopMap = {};
    Object.keys(stops).forEach(function (code) {
        var info = stopInfo(code);
        var pairs = idsAt(code);
        stopList[code] = info;
        stopMap[code] = pairs;
        pairs.forEach(function (p) {
            stopList[p[1]] = info;
            stopMap[p[1]] = pairs;
        });
    });

    /**
     * Fares available when boarding at every stop index. eta6 stores one run
     * list per origin (matrix) or a single ladder; a run list can hold more
     * than one price (full fare + section fare), so every distinct price is
     * kept and shown.
     */
    function fareArray(fares, n) {
        var out = [];
        for (var i = 0; i < n; i++) out.push([]);
        if (!fares) return out;

        if (fares.kind === "flat") {
            for (var f = 0; f < n; f++) out[f] = [fares.flat];
            return out;
        }

        var prices = fares.prices || [];
        function pricesOf(runs) {
            var seen = {}, list = [];
            for (var r = 0; r < runs.length; r++) {
                var p = prices[runs[r][2]];
                if (p == null || seen[p]) continue;
                seen[p] = 1;
                list.push(p);
            }
            list.sort(function (a, b) { return a - b; });
            return list;
        }

        if (fares.kind === "matrix") {
            for (var j = 0; j < n; j++) out[j] = pricesOf((fares.rows && fares.rows[j]) || []);
        } else {
            var ladder = pricesOf(fares.ladder || []);
            for (var k = 0; k < n; k++) out[k] = ladder.slice();
        }
        return out;
    }

    /** eta6 {service:[start,end,headway]} -> hkbus {mask:{HHMM:[HHMM]}}. */
    function toFreq(v) {
        var out = {};
        var freq = v.freq || {};

        Object.keys(freq).forEach(function (sid) {
            var svc = index.services && index.services[sid];
            if (!svc || !svc.days) return;
            var mask = dayMask(svc);
            if (!mask) return;
            var bucket = out[mask] || (out[mask] = {});
            (freq[sid] || []).forEach(function (band) {
                var start = hhmm(band[0]);
                if (bucket[start]) return;
                bucket[start] = [hhmm(band[1])];
            });
        });

        // only use the departure list when the variant publishes no frequency
        if (!Object.keys(out).length && v.fixedDepartures) {
            Object.keys(v.fixedDepartures).forEach(function (sid) {
                var svc = index.services && index.services[sid];
                if (!svc || !svc.days) return;
                var mask = dayMask(svc);
                if (!mask) return;
                var bucket = out[mask] || (out[mask] = {});
                (v.fixedDepartures[sid] || []).forEach(function (t) {
                    bucket[hhmm(t)] = null;
                });
            });
        }
        return out;
    }

    function nlbIdFromList(list, route, dest) {
        if (!list || !list.routes) return null;
        var cands = list.routes.filter(function (r) { return r.routeNo === route; });
        if (!cands.length) return null;
        dest = dest || "";
        var hit = cands.filter(function (r) {
            return dest && (r.routeName_c || "").indexOf(dest) >= 0;
        })[0];
        return (hit || cands[0]).routeId;
    }

    function nlbIdFor(v) {
        return nlbIdFromList(nlbList, v.route, (v.dest && v.dest.zh) || "");
    }

    /* ---------- derived direction ---------- */

    /**
     * Some eta6 variants carry a bound that contradicts the direction their
     * stops actually travel (e.g. KMB_91M_O2 goes to Po Lam but is marked O).
     * Derive the direction from the terminal stop of the longest variant of
     * each bound instead of trusting the raw field.
     */
    var derivedBound = {};
    (function () {
        var groups = {};
        Object.keys(routeStop).forEach(function (vid) {
            var v = routeStop[vid];
            var sig = (v.co || []).map(coKey).sort().join("+");
            var gk = sig + "|" + v.route;
            (groups[gk] || (groups[gk] = [])).push(vid);
        });

        Object.keys(groups).forEach(function (gk) {
            var vids = groups[gk];
            var primary = {};

            vids.forEach(function (vid) {
                var v = routeStop[vid];
                if (v.circular) return;
                var d = v.bound;
                if (d !== "I" && d !== "O") return;
                var st = v.stops || [];
                if (st.length < 2) return;
                var p = primary[d];
                if (!p || st.length > p.n) {
                    primary[d] = {n: st.length, first: st[0], last: st[st.length - 1]};
                }
            });

            vids.forEach(function (vid) {
                var v = routeStop[vid];
                var d = v.bound;
                if (v.circular || (d !== "I" && d !== "O")) {
                    derivedBound[vid] = d;
                    return;
                }
                var other = d === "I" ? "O" : "I";
                var st = v.stops || [];
                if (st.length < 2 || !primary[other]) {
                    derivedBound[vid] = d;
                    return;
                }
                var first = st[0], last = st[st.length - 1];
                var own = primary[d];
                if ((!own || last !== own.last) && last === primary[other].last) {
                    d = other;
                } else if ((!own || first !== own.first) && first === primary[other].first) {
                    d = other;
                }
                derivedBound[vid] = d;
            });
        });
    })();

    var routeList = {};

    Object.keys(routeStop).forEach(function (vid) {
        var v = routeStop[vid];
        var cos = [], origin = {};
        (v.co || []).forEach(function (c) {
            var k = coKey(c);
            if (SUPPORTED.indexOf(k) < 0) return;
            if (cos.indexOf(k) < 0) { cos.push(k); origin[k] = c; }
        });
        if (!cos.length) return;

        // display order matches the existing "KMB+CTB" icon; the stop object is
        // CTB-first because route3 keys both companies' results on the first
        // stop list and the CTB API only accepts CTB stop ids
        var joint = cos.length === 2 && cos.indexOf("ctb") >= 0 && cos.indexOf("kmb") >= 0;
        if (joint) cos = ["kmb", "ctb"];
        var stopOrder = joint ? ["ctb", "kmb"] : cos.slice();

        var m = /_([IO])(\d+)$/.exec(vid);
        var ord = m ? parseInt(m[2], 10) : 1;
        var circular = !!v.circular;
        // circular routes are published on one leg only; the frontend expects
        // the legacy "OI" marker so it can alternate duplicated stops
        var useOI = circular && stopOrder[0] === "ctb";

        var bound = {};
        stopOrder.forEach(function (k) {
            bound[k] = useOI ? "OI" : ((v.bounds && v.bounds[origin[k]]) || derivedBound[vid] || v.bound || "O");
        });

        var stopsByCo = {};
        stopOrder.forEach(function (k) {
            var op = OP_FOR[k];
            stopsByCo[k] = (v.stops || []).map(function (code) {
                return resolve(op, code) || code;
            });
        });

        var entry = {
            key: vid,
            id: vid,
            co: cos,
            route: v.route,
            bound: bound,
            orig: v.orig || {},
            dest: v.dest || {},
            serviceType: ord,
            circular: circular,
            stops: stopsByCo,
            codes: (v.stops || []).slice(),
            fares: fareArray(v.fares, (v.stops || []).length),
            freq: toFreq(v),
            tdRouteId: v.tdRouteId || null,
            gtfsId: null      // eta6 has no hkbus waypoint id; the map falls back to stop points
        };
        if (cos.indexOf("nlb") >= 0) entry.nlbId = nlbIdFor(v);
        routeList[vid] = entry;
    });

    /* ---------- eta2 _rtlist / _stoplist shape ---------- */

    var rtlist = {"CTB": {}, "KMB": {}, "NLB": {}, "LRTFEEDER": {}};
    var dirSeq = {};        // "CO|route|I" -> how many patterns seen so far

    Object.keys(routeStop).forEach(function (vid) {
        var v = routeStop[vid];
        var m = /_([IO])(\d+)$/.exec(vid);
        var ord = m ? parseInt(m[2], 10) : 1;
        var circular = !!v.circular;
        var useOI = circular && coKey((v.co || [])[0]) === "ctb";

        (v.co || []).forEach(function (c) {
            var CO = c === "LWB" ? "KMB" : (c === "LRTFeeder" ? "LRTFEEDER" : c);
            if (!rtlist[CO]) return;                    // GMB is not part of the site

            var op = opKey(c);
            var ids = (v.stops || []).map(function (code) {
                return resolve(op, code) || code;
            });

            var dir = useOI ? "OI" : ((v.bounds && v.bounds[c]) || derivedBound[vid] || v.bound || "O");
            var dirKey;
            if (dir === "OI" || dir === "IO") {
                dirKey = dir;
            } else {
                // the first pattern of a bound must keep the plain legacy key
                // ("I"/"O" for CTB/NLB, "I1"/"O1" for KMB) because the live
                // ETA APIs and bystop only ever ask for that key
                var seqKey = CO + "|" + v.route + "|" + dir;
                var count = (dirSeq[seqKey] = (dirSeq[seqKey] || 0) + 1);
                var suffix = CO === "KMB" ? count : (count === 1 ? "" : count);
                dirKey = dir + suffix;
            }

            var target = rtlist[CO][v.route] || (rtlist[CO][v.route] = {
                co: CO, route: v.route, var: {}, fare: {}
            });
            if (target.var[dirKey]) return;

            target.var[dirKey] = {
                dest_tc: (v.dest && v.dest.zh) || "",
                dest_en: (v.dest && v.dest.en) || "",
                stops: ids,
                bound: dirKey
            };
            target.fare[dirKey] = fareArray(v.fares, (v.stops || []).length)
                .map(function (list) { return list.map(function (p) { return [p]; }); });
        });
    });

    var legacyStops = {};
    Object.keys(stops).forEach(function (code) {
        var info = stopInfo(code);
        var pairs = idsAt(code);
        var rec = {
            data: {
                name_tc: info.name.zh,
                name_en: info.name.en,
                lat: info.location.lat,
                long: info.location.lng
            },
            code: code,
            rt: [],
            alt: pairs.map(function (p) { return p[1]; })
        };

        var seen = {};
        (stopRoutes[code] || []).forEach(function (vid) {
            var v = routeStop[vid];
            if (!v) return;
            // list the route once per operating company so a shared stop shows
            // the joint route under both the CTB id and the KMB id
            (v.co || []).forEach(function (c) {
                if (c === "GMB") return;
                var CO = c === "LWB" ? "KMB" : (c === "LRTFeeder" ? "LRTFEEDER" : c);
                if (!rtlist[CO]) return;
                var key = CO + "_" + v.route;
                if (seen[key]) return;
                seen[key] = 1;
                rec.rt.push(key);
            });
        });

        legacyStops[code] = rec;
        pairs.forEach(function (p) {
            if (!legacyStops[p[1]]) legacyStops[p[1]] = rec;
        });
    });

    return {
        routeFareList: {routeList: routeList, stopList: stopList, stopMap: stopMap},
        legacy: {rtlist: rtlist, stoplist: legacyStops},
        counts: {variants: Object.keys(routeList).length, stops: Object.keys(stopList).length}
    };
}

global.Eta6 = {
    load: load,
    routeFareList: function () {
        return load().then(function (d) { return d.routeFareList; });
    },
    legacy: function () {
        return load().then(function (d) { return d.legacy; });
    },
    /** NLB routeId for a route, fetched at most once per session. */
    nlbRouteId: function (route, dest) {
        return nlbRoutes().then(function (list) {
            return nlbIdFromList(list, route, dest);
        });
    }
};

})(window);
