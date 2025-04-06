function findNextBusTime(i) {   
    const time_diff = RT_data.time;
    const sch = (RT_data.phtime && !(new Date().getDay() === 0 || new Date().getDay() === 6) ? RT_data.sch_wk2 : RT_data.sch2);
    const now = new Date().getHours() * 60 + new Date().getMinutes() + new Date().getSeconds()/60;
    //const next_departure = sch.filter(([time, co2]) => time > now).sort()[0];
    //Change the find next departure into find three next departure
    var next_three_departure = sch.filter(([time, co2]) => (time + (time_diff[i]+0)/60) > now && (time + (time_diff[i]+0)/60) < (now+60)).sort((a,b)=>a[0]-b[0]).slice(0,3);
    if (!next_three_departure[0]) return 0;
    
    return next_three_departure.map(g=>[g[0] + (time_diff[i]+0)/60 - now, //time
            (g[0] > now), //departed
            g[1]
        ]);

}

setInterval(function (){
    try{
        apply_eta2()
    }catch(error){console.log(error)}
},1000);

//var INPUT = document.location.href.split("?")[1].split("+");
//var RT_data = _rtlist[INPUT[0]][INPUT[1]]["var"][INPUT[2]];

function apply_eta2(){
    RT_data = _rtlist[INPUT[0]][INPUT[1]]["var"][INPUT[2]];
    //console.log(findNextBusTime(1));
    var lastbus = 9e9;
	RT_data.stops.forEach((w,i)=>{
        var time = findNextBusTime(i);
        //console.log(time);
        if(time[0][0]<lastbus && i>0){
            document.getElementById("bus_"+w).innerHTML = `<div style="position: relative;color:#333;font-size:22px"><div style="position: absolute;top: 50%;left: 50%;transform: translate(-50%, -65%);"></div><img src="/eta7/icon/{#0}.png" style="width:30px"></div>`.replacement([time[0][2]?time[0][2]:INPUT[0]]);
        }else{
            document.getElementById("bus_"+w).innerHTML = ""
        }
        lastbus = time[0][0];

		document.getElementById("eta_"+w).innerHTML = format_eta2(time)
	})
}

function formatDateToISO(date) {
    const pad = (num) => (num < 10 ? '0' : '') + num;
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    const timezoneOffset = -date.getTimezoneOffset();
    const sign = timezoneOffset >= 0 ? '+' : '-';
    const offsetHours = pad(Math.floor(Math.abs(timezoneOffset) / 60));
    const offsetMinutes = pad(Math.abs(timezoneOffset) % 60);

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetMinutes}`;
}

function format_eta2(f){
	if(!f)return "";
	var n="";
	f.forEach((w,i)=>{
		n+=`<label class="eta_time_` + (i+1) + `">`+
            (i==0?"<b>":"")+
            eta_All.timeparse(formatDateToISO(new Date(Date.now()+w[0]*60*1000)),TimeDisplay)+
            (i==0?"<b> ":" ")+
            (w[2]?"<small>"+
                w[2]+" </small>":"")+ `<small>` + (w[1]?"原定班次":"") +`</small></label><br>`;
	})
	return n
}
