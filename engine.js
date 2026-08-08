// ============================================================================
//  VENDORED from github.com/icomppower/golden-hour-engine — **and diverged.**
//  ---------------------------------------------------------------------------
//  runCity() below is the upstream driving runtime, byte-for-byte. It is not used
//  by this game; it is kept so a future `sync.sh` is a one-hunk re-apply rather
//  than a merge.  What this game runs is runWalk() at the bottom of this file:
//  the same stage (sky, env map, lights, bloom, loop) with the car replaced by a
//  pair of legs and the chase camera replaced by a first-person one.
//
//  ⚠️ ./sync.sh from golden-hour-engine WILL clobber runWalk(). Re-apply it.
//
//  Why first person and not over-the-shoulder: first person needs no player model
//  at all. A character here is a colour panel with one character painted on it —
//  over the shoulder you stare at that for the whole game and it reads as an
//  unfinished placeholder; in first person the panels only ever appear on other
//  people, and it reads as style. The art budget stays at zero.
// ============================================================================

// ============================================================================
//  Golden Hour — 3D City Driving Engine (shared core)
//  ---------------------------------------------------------------------------
//  The engine owns everything you DON'T want to re-tune per city:
//    input + steering, car physics + collision, camera modes, HUD, minimap,
//    landmark TOUR mode, touch controls, env-map reflections, sky, start,
//    audio, the render loop.
//  A city is a data+build module (see cities/*.js). It supplies only its WORLD:
//    geometry, landmarks, collision, traffic. Call runCity(CITY).
//
//  CITY contract:
//    { id, name, subtitle, tagline, seed, theme, start:{x,z,heading},
//      bounds:{x0,x1,z0,z1}, districts?(x,z)->string,
//      build(api) -> world }
//  api = { THREE, scene, renderer, rand, rr, pick, clamp, lerp,
//          buildCar, windowTex, palm, registerBeacon }
//  world = { collide(nx,nz), groundH?(x,z), landmarks?, minimapBlocks?,
//            trafficPoints?()->[{x,z}], size?, update?(dt), districts?(x,z) }
//  Convention: +x = East, -x = West, +z = South, -z = North. Forward = (sinθ,cosθ).
// ============================================================================
import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;

export function runCity(CITY){
  // ---------- theme (per-city, all optional with golden-hour defaults) ----------
  const T=CITY.theme||{};
  const TH={
    background:T.background??0xf6b27a, fogColor:T.fogColor??0xf0a878, fog:T.fog??0.0011,
    exposure:T.exposure??1.3,
    sky:T.sky||{top:0x2a4a86,mid:0xf2a86a,bot:0xffd9a0},
    sunPos:T.sunPos||[-420,240,-160], sunColor:T.sunColor??0xffc27a, sunInt:T.sunInt??3.0,
    hemiSky:T.hemiSky??0xffe0b8, hemiGround:T.hemiGround??0x5a4048, hemiInt:T.hemiInt??1.35,
    ambColor:T.ambColor??0xffd9b0, ambInt:T.ambInt??0.35,
    fillColor:T.fillColor??0x88aaff, fillInt:T.fillInt??0.35, fillPos:T.fillPos||[300,120,220],
    carColor:T.carColor??0xff4d3d,
    env:T.env||{stops:[[0,'#33528e'],[0.45,'#e79a5e'],[0.62,'#ffcf8c'],[1,'#7a5a44']],sun:[48,42,46]},
    bloom:T.bloom||[0.55,0.7,0.82],
    ground:T.ground??0x6b6f63,
  };

  // ---------- seeded rng ----------
  let _seed=CITY.seed||1337;
  const rand=()=>{_seed=(_seed*1103515245+12345)&0x7fffffff;return _seed/0x7fffffff;};
  const rr=(a,b)=>a+rand()*(b-a);
  const pick=arr=>arr[(rand()*arr.length)|0];

  // ---------- scene / renderer / camera / post ----------
  const scene=new THREE.Scene();
  scene.background=new THREE.Color(TH.background);
  scene.fog=new THREE.FogExp2(TH.fogColor,TH.fog);

  const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.setSize(innerWidth,innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=TH.exposure;
  document.body.appendChild(renderer.domElement);

  const camera=new THREE.PerspectiveCamera(64,innerWidth/innerHeight,0.5,4000);
  camera.position.set(0,40,60);

  const composer=new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene,camera));
  const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),...TH.bloom);
  composer.addPass(bloom);

  // ---------- env map (sky reflections for metal/glass) ----------
  (function envMap(){
    const c=document.createElement('canvas');c.width=256;c.height=128;const x=c.getContext('2d');
    const g=x.createLinearGradient(0,0,0,128);
    for(const[p,col]of TH.env.stops)g.addColorStop(p,col);
    x.fillStyle=g;x.fillRect(0,0,256,128);
    const[sx,sy,sr]=TH.env.sun;
    const sg=x.createRadialGradient(sx,sy,2,sx,sy,sr);
    sg.addColorStop(0,'#fff6e0');sg.addColorStop(0.4,'rgba(255,210,140,.8)');sg.addColorStop(1,'rgba(255,200,120,0)');
    x.fillStyle=sg;x.fillRect(0,0,sx+sr*2,sy+sr*2);
    const tex=new THREE.CanvasTexture(c);tex.mapping=THREE.EquirectangularReflectionMapping;
    const pmrem=new THREE.PMREMGenerator(renderer);pmrem.compileEquirectangularShader();
    scene.environment=pmrem.fromEquirectangular(tex).texture;
    tex.dispose();pmrem.dispose();
  })();

  // ---------- lighting ----------
  const hemi=new THREE.HemisphereLight(TH.hemiSky,TH.hemiGround,TH.hemiInt);scene.add(hemi);
  const amb=new THREE.AmbientLight(TH.ambColor,TH.ambInt);scene.add(amb);
  const sun=new THREE.DirectionalLight(TH.sunColor,TH.sunInt);
  sun.position.set(...TH.sunPos);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
  const SS=340;
  sun.shadow.camera.left=-SS;sun.shadow.camera.right=SS;sun.shadow.camera.top=SS;sun.shadow.camera.bottom=-SS;
  sun.shadow.camera.near=1;sun.shadow.camera.far=1400;sun.shadow.bias=-0.0004;sun.shadow.normalBias=0.6;
  scene.add(sun);scene.add(sun.target);
  const fill=new THREE.DirectionalLight(TH.fillColor,TH.fillInt);fill.position.set(...TH.fillPos);scene.add(fill);

  // ---------- sky dome ----------
  (function sky(){
    const g=new THREE.SphereGeometry(2600,32,20);
    const m=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{
      top:{value:new THREE.Color(TH.sky.top)},mid:{value:new THREE.Color(TH.sky.mid)},bot:{value:new THREE.Color(TH.sky.bot)},
      sun:{value:new THREE.Vector3(...TH.sunPos).normalize()}},
      vertexShader:`varying vec3 vp;void main(){vp=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader:`varying vec3 vp;uniform vec3 top,mid,bot,sun;void main(){float h=clamp(vp.y*1.1+0.15,0.0,1.0);
        vec3 c=mix(bot,mid,smoothstep(0.0,0.42,h));c=mix(c,top,smoothstep(0.4,0.95,h));
        float s=max(dot(vp,sun),0.0);c+=vec3(1.0,0.6,0.25)*pow(s,7.0)*0.9;c+=vec3(1.0,0.5,0.3)*pow(s,60.0)*1.4;
        gl_FragColor=vec4(c,1.0);}`});
    scene.add(new THREE.Mesh(g,m));
  })();
  // sun billboard
  (function sunDisc(){
    const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');
    const gr=x.createRadialGradient(64,64,4,64,64,64);gr.addColorStop(0,'rgba(255,245,220,1)');gr.addColorStop(.3,'rgba(255,200,120,.9)');gr.addColorStop(1,'rgba(255,160,90,0)');
    x.fillStyle=gr;x.fillRect(0,0,128,128);
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),blending:THREE.AdditiveBlending,depthWrite:false,depthTest:false}));
    const d=new THREE.Vector3(...TH.sunPos).normalize().multiplyScalar(1900);
    s.scale.set(340,340,1);s.position.copy(d);scene.add(s);
  })();

  // ---------- shared mesh helpers (exposed to the city via api) ----------
  const winTexPool=[];
  function windowTex(cols,rows,base,lit){
    const c=document.createElement('canvas');c.width=cols*16;c.height=rows*16;const x=c.getContext('2d');
    x.fillStyle=base;x.fillRect(0,0,c.width,c.height);
    for(let r=0;r<rows;r++)for(let cc=0;cc<cols;cc++){const on=rand()<0.34;x.fillStyle=on?lit:'rgba(20,26,40,0.9)';x.fillRect(cc*16+3,r*16+3,10,11);}
    const t=new THREE.CanvasTexture(c);t.anisotropy=4;return t;
  }
  function buildCar(color){
    const g=new THREE.Group();
    const body=new THREE.Mesh(new THREE.BoxGeometry(2.1,0.9,4.4),new THREE.MeshStandardMaterial({color,roughness:0.35,metalness:0.5}));
    body.position.y=0.75;body.castShadow=true;g.add(body);
    const cabin=new THREE.Mesh(new THREE.BoxGeometry(1.8,0.7,2.2),new THREE.MeshStandardMaterial({color:0x1a1e28,roughness:0.2,metalness:0.4,emissive:0x0a0c14}));
    cabin.position.set(0,1.35,-0.2);cabin.castShadow=true;g.add(cabin);
    const wheelG=new THREE.CylinderGeometry(0.5,0.5,0.4,12);const wheelM=new THREE.MeshStandardMaterial({color:0x111111,roughness:0.8});
    const wheels=[];
    for(const[wx,wz]of[[-1,1.4],[1,1.4],[-1,-1.4],[1,-1.4]]){
      const w=new THREE.Mesh(wheelG,wheelM);w.rotation.z=Math.PI/2;w.position.set(wx,0.5,wz);w.castShadow=true;g.add(w);
      wheels.push({front:wz>0,spin:w});
    }
    const hl=new THREE.Mesh(new THREE.SphereGeometry(0.18,8,8),new THREE.MeshBasicMaterial({color:0xfff2c8}));hl.position.set(-0.6,0.7,2.25);g.add(hl);
    const hr=hl.clone();hr.position.x=0.6;g.add(hr);
    const tl=new THREE.Mesh(new THREE.SphereGeometry(0.16,8,8),new THREE.MeshBasicMaterial({color:0xff2a1a}));tl.position.set(-0.6,0.7,-2.25);g.add(tl);
    const tr=tl.clone();tr.position.x=0.6;g.add(tr);
    return {group:g,wheels};
  }
  const trunkMat=new THREE.MeshStandardMaterial({color:0x8a6a44,roughness:1});
  const frondMat=new THREE.MeshStandardMaterial({color:0x3f7a35,roughness:0.9,side:THREE.DoubleSide});
  function palm(x,z,s=1,parent=scene){
    const g=new THREE.Group();
    const th=rr(9,15)*s;
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(0.35*s,0.6*s,th,7),trunkMat);trunk.position.y=th/2;trunk.castShadow=true;g.add(trunk);
    const crown=new THREE.Group();crown.position.y=th;const fGeo=new THREE.PlaneGeometry(1.6*s,7*s);
    for(let i=0;i<9;i++){const f=new THREE.Mesh(fGeo,frondMat);const a=i/9*Math.PI*2;f.position.set(Math.cos(a)*2.4*s,-0.3,Math.sin(a)*2.4*s);f.rotation.set(-0.9,a,0);f.castShadow=true;crown.add(f);}
    g.add(crown);g.position.set(x,0.5,z);parent.add(g);return g;
  }
  const beacons=[];
  const api={THREE,scene,renderer,rand,rr,pick,clamp,lerp,buildCar,windowTex,palm,winTexPool,
    registerBeacon:m=>beacons.push(m)};

  // ---------- ground plane (city may cover it) ----------
  (function ground(){
    const p=new THREE.Mesh(new THREE.PlaneGeometry(6000,6000),new THREE.MeshStandardMaterial({color:TH.ground,roughness:1}));
    p.rotation.x=-Math.PI/2;p.position.y=-0.05;p.receiveShadow=true;scene.add(p);
  })();

  // ---------- build the city world ----------
  const world=CITY.build(api)||{};
  const collide=world.collide||(()=>null);
  const groundH=world.groundH||(()=>0);
  const landmarks=world.landmarks||[];
  const minimapBlocks=world.minimapBlocks||[];
  const trafficPoints=world.trafficPoints||(()=>[]);
  const worldSize=world.size||1000;
  const districts=world.districts||CITY.districts||(()=>'');
  const B=CITY.bounds||{x0:-worldSize/2,x1:worldSize/2,z0:-worldSize/2,z1:worldSize/2};

  // ground-normal car tilt (terrain cities set CITY.tiltToGround)
  const _up=new THREE.Vector3(),_fw=new THREE.Vector3(),_rt=new THREE.Vector3(),_bm=new THREE.Matrix4(),_qq=new THREE.Quaternion();
  function orientCar(obj,x,z,heading,smooth){
    const e=1.6;_up.set(groundH(x-e,z)-groundH(x+e,z),2*e,groundH(x,z-e)-groundH(x,z+e)).normalize();
    _fw.set(Math.sin(heading),0,Math.cos(heading));_fw.addScaledVector(_up,-_fw.dot(_up)).normalize();
    _rt.crossVectors(_up,_fw);_bm.makeBasis(_rt,_up,_fw);
    obj.quaternion.slerp(_qq.setFromRotationMatrix(_bm),smooth);
    const y=groundH(x,z);obj.position.set(x,lerp(obj.position.y,y,smooth),z);return y;
  }

  // ---------- player ----------
  const player=buildCar(TH.carColor);scene.add(player.group);
  const START=CITY.start||{x:0,z:0,heading:0};
  const st={x:START.x,z:START.z,heading:START.heading,vf:0,vs:0,steer:0,y:groundH(START.x,START.z)};
  // A trail of recent safe road positions. `lastSafe` alone was useless for RESET:
  // it is refreshed every frame while you drive, so resetting dropped you exactly
  // where you already stood. safeTrail[0] is ~1.6s behind you, always on a road.
  let lastSafe={x:START.x,z:START.z,h:START.heading};
  const safeTrail=[{...lastSafe}];
  let trailAcc=0;

  // ---------- text / title ----------
  document.title=`${CITY.name||'Golden Hour'} — 3D City Driving`;
  const $=s=>document.querySelector(s);
  if($('#title h1'))$('#title h1').textContent=CITY.name||'GOLDEN HOUR';
  if($('#title p'))$('#title p').textContent=CITY.subtitle||'';
  if($('#overlay h1'))$('#overlay h1').textContent=CITY.name||'GOLDEN HOUR';
  if($('#overlay h2'))$('#overlay h2').textContent=CITY.tagline||CITY.subtitle||'3D CITY DRIVING';

  // ---------- controls ----------
  const keys={};
  addEventListener('keydown',e=>{const k=e.key.toLowerCase();keys[k]=true;
    if(k==='c')cycleCam();if(k==='r')respawn();if(k==='t')toggleTour();
    if(CITY.onKey)CITY.onKey(k,{st,showToast});
    if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(k))e.preventDefault();});
  addEventListener('keyup',e=>{keys[e.key.toLowerCase()]=false;});
  const touch={left:false,right:false,gas:false,brake:false,drift:false};
  function bindTouch(id,prop){const el=document.getElementById(id);if(!el)return;
    const on=e=>{e.preventDefault();touch[prop]=true;el.classList.add('on');};
    const off=e=>{e.preventDefault();touch[prop]=false;el.classList.remove('on');};
    el.addEventListener('touchstart',on,{passive:false});el.addEventListener('touchend',off);el.addEventListener('touchcancel',off);}
  if('ontouchstart'in window)document.body.classList.add('touch');
  bindTouch('tLeft','left');bindTouch('tRight','right');bindTouch('tGas','gas');bindTouch('tBrake','brake');bindTouch('tDrift','drift');
  const tCam=document.getElementById('tCam');if(tCam)tCam.addEventListener('touchstart',e=>{e.preventDefault();cycleCam();});
  const tReset=document.getElementById('tReset');
  if(tReset)tReset.addEventListener('touchstart',e=>{e.preventDefault();respawn();});
  const tTour=document.getElementById('tTour');if(tTour)tTour.addEventListener('touchstart',e=>{e.preventDefault();toggleTour();});

  // ---------- camera modes ----------
  let viewMode=0; // 0 chase, 1 hood, 2 cinematic
  const camPos=new THREE.Vector3(START.x,8,START.z+18);
  const camLook=new THREE.Vector3();
  function cycleCam(){viewMode=(viewMode+1)%3;showToast(['CHASE','HOOD','CINEMATIC'][viewMode]);}

  // ---------- HUD / toast ----------
  const speedEl=document.getElementById('speed');
  const gearEl=document.getElementById('gear');
  const toastEl=document.getElementById('toast');
  function showToast(t){if(!toastEl)return;toastEl.textContent=t;toastEl.style.opacity=1;clearTimeout(showToast._t);showToast._t=setTimeout(()=>toastEl.style.opacity=0,1200);}
  let nearLm=null;
  function locationLabel(x,z){
    let best=null,bd=1e9;
    for(const lm of landmarks){const d=Math.hypot(x-lm.x,z-lm.z);if(d<bd){bd=d;best=lm;}}
    if(best&&bd<95){if(nearLm!==best){nearLm=best;showToast('◉ '+best.name);}return '◉ '+best.name;}
    if(bd>140)nearLm=null;
    return districts(x,z);
  }
  function respawn(){
    let to=safeTrail[0], home=false;
    if(!to||Math.hypot(st.x-to.x,st.z-to.z)<3){to={x:START.x,z:START.z,h:START.heading};home=true;}
    st.x=to.x;st.z=to.z;st.heading=to.h;st.vf=0;st.vs=0;st.steer=0;st.y=groundH(to.x,to.z);
    // snap the car and the camera, otherwise both lerp across the map
    if(CITY.tiltToGround)st.y=orientCar(player.group,st.x,st.z,st.heading,1);
    else player.group.position.set(st.x,st.y,st.z);
    camPos.set(st.x-Math.sin(st.heading)*14,st.y+7,st.z-Math.cos(st.heading)*14);
    safeTrail.length=0;safeTrail.push({x:to.x,z:to.z,h:to.h});trailAcc=0;
    showToast(home?'RESET · BACK TO START':'RESET');
  }

  // ---------- landmark tour ----------
  const cpRing=new THREE.Mesh(new THREE.TorusGeometry(11,1.3,10,36),new THREE.MeshBasicMaterial({color:0x6fd6ff}));
  cpRing.rotation.x=Math.PI/2;cpRing.visible=false;scene.add(cpRing);
  const cpBeam=new THREE.Mesh(new THREE.CylinderGeometry(2,2,240,12,1,true),new THREE.MeshBasicMaterial({color:0x6fd6ff,transparent:true,opacity:0.22,side:THREE.DoubleSide,depthWrite:false}));
  cpBeam.visible=false;scene.add(cpBeam);
  const tour={active:false,idx:0,visited:new Set(),t0:0,done:false};
  const tourEl=document.getElementById('tour');
  function toggleTour(){
    if(!landmarks.length)return;
    tour.active=!tour.active;
    if(tour.active){tour.visited=new Set();tour.idx=0;tour.done=false;tour.t0=game.t;showToast('★ LANDMARK TOUR — follow the beam');}
    else{cpRing.visible=cpBeam.visible=false;if(tourEl)tourEl.style.display='none';showToast('TOUR OFF');}
  }
  function updateTour(){
    if(!tour.active)return;
    while(tour.idx<landmarks.length&&tour.visited.has(tour.idx))tour.idx++;
    if(tour.idx>=landmarks.length){cpRing.visible=cpBeam.visible=false;
      if(!tour.done){tour.done=true;const s=(game.t-tour.t0).toFixed(1);showToast('🏁 TOUR COMPLETE · '+s+'s');if(tourEl)tourEl.textContent='🏁 ALL '+landmarks.length+' LANDMARKS · '+s+'s';}
      return;}
    const tgt=landmarks[tour.idx];
    const d=Math.hypot(st.x-tgt.x,st.z-tgt.z);
    cpRing.position.set(tgt.x,groundH(tgt.x,tgt.z)+3,tgt.z);cpBeam.position.set(tgt.x,groundH(tgt.x,tgt.z)+110,tgt.z);cpRing.visible=cpBeam.visible=true;
    const p=1+Math.sin(game.t*4)*0.14;cpRing.scale.set(p,p,1);
    if(d<44){tour.visited.add(tour.idx);tour.idx++;showToast('✓ '+tgt.name+'   ('+tour.visited.size+'/'+landmarks.length+')');return;}
    if(tourEl){tourEl.style.display='block';tourEl.textContent='TOUR ▸ '+tgt.name+'   '+Math.round(d)+'m   ('+tour.visited.size+'/'+landmarks.length+')';}
  }

  // ---------- start / audio ----------
  const overlay=document.getElementById('overlay');
  let started=false,actx,eng;
  function initEngineSound(){
    const o=actx.createOscillator();const g=actx.createGain();const o2=actx.createOscillator();
    o.type='sawtooth';o2.type='square';o.frequency.value=60;o2.frequency.value=30;
    g.gain.value=0.0;const f=actx.createBiquadFilter();f.type='lowpass';f.frequency.value=600;
    o.connect(f);o2.connect(f);f.connect(g);g.connect(actx.destination);o.start();o2.start();eng={o,o2,g};
  }
  function start(){if(started)return;started=true;if(overlay){overlay.style.opacity=0;setTimeout(()=>overlay.style.display='none',800);}
    try{actx=new(window.AudioContext||window.webkitAudioContext)();initEngineSound();}catch(e){}
    setTimeout(()=>{const t=document.getElementById('title'),h=document.getElementById('hint');if(t)t.style.opacity=0;if(h)h.style.opacity=0;},7000);}
  const startBtn=document.getElementById('startBtn');
  if(startBtn){startBtn.addEventListener('click',start);startBtn.addEventListener('touchstart',e=>{e.preventDefault();start();});}

  // ---------- minimap ----------
  const miniC=document.getElementById('mini');const mtx=miniC&&miniC.getContext('2d');
  if(miniC){miniC.width=miniC.width||150;}
  function drawMini(){
    if(!mtx)return;
    const R=miniC.width, sc=R/(worldSize*1.1);
    mtx.clearRect(0,0,R,R);mtx.fillStyle='rgba(30,20,16,0.5)';mtx.fillRect(0,0,R,R);
    mtx.save();mtx.translate(R/2,R/2);
    mtx.fillStyle='rgba(120,120,130,0.5)';
    for(const b of minimapBlocks)mtx.fillRect(b.x*sc-1.3,b.z*sc-1.3,2.6,2.6);
    mtx.fillStyle='rgba(255,180,90,0.7)';
    for(const t of trafficPoints())mtx.fillRect(t.x*sc-0.8,t.z*sc-0.8,1.6,1.6);
    const lim=R/2-9, showLbl=R>=140;mtx.font='7px -apple-system,Arial';mtx.textAlign='center';
    for(const lm of landmarks){const px=clamp(lm.x*sc,-lim,lim),pz=clamp(lm.z*sc,-lim,lim);
      mtx.fillStyle='#ffd45a';mtx.save();mtx.translate(px,pz);mtx.rotate(Math.PI/4);mtx.fillRect(-2.6,-2.6,5.2,5.2);mtx.restore();
      if(showLbl&&lm.short){mtx.fillStyle='rgba(20,14,10,0.85)';mtx.fillRect(px-9,pz-11,18,7);mtx.fillStyle='#ffe6a0';mtx.fillText(lm.short,px,pz-5);}}
    if(tour.active&&tour.idx<landmarks.length){const lm=landmarks[tour.idx];const px=clamp(lm.x*sc,-lim,lim),pz=clamp(lm.z*sc,-lim,lim);
      mtx.strokeStyle='#6fd6ff';mtx.lineWidth=1.6;mtx.beginPath();mtx.arc(px,pz,6.5,0,7);mtx.stroke();}
    mtx.fillStyle='#ff4d3d';mtx.beginPath();
    const px=st.x*sc,pz=st.z*sc;
    mtx.moveTo(px+Math.sin(st.heading)*4,pz+Math.cos(st.heading)*4);
    mtx.lineTo(px+Math.sin(st.heading+2.5)*3,pz+Math.cos(st.heading+2.5)*3);
    mtx.lineTo(px+Math.sin(st.heading-2.5)*3,pz+Math.cos(st.heading-2.5)*3);
    mtx.closePath();mtx.fill();mtx.restore();
  }

  // ---------- resize ----------
  addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight);});

  // ---------- physics ----------
  function step(dt){
    let th=0,steerIn=0;
    if(keys['w']||keys['arrowup']||touch.gas)th=1;
    if(keys['s']||keys['arrowdown']||touch.brake)th=-1;
    if(keys['a']||keys['arrowleft']||touch.left)steerIn=-1;
    if(keys['d']||keys['arrowright']||touch.right)steerIn=1;
    const drifting=keys[' ']||touch.drift;

    st.steer=lerp(st.steer,steerIn,1-Math.exp(-9*dt));
    const maxF=54;
    if(th>0)st.vf+=th*34*dt;
    else if(th<0){if(st.vf>0)st.vf+=th*46*dt;else st.vf+=th*22*dt;}
    st.vf*=(1-(drifting?0.4:0.9)*dt*0.5);
    st.vf-=Math.sign(st.vf)*8*dt;
    st.vf=clamp(st.vf,-18,maxF);
    if(Math.abs(st.vf)<0.05)st.vf=0;

    const spd=Math.abs(st.vf);
    const turn=st.steer*2.4*dt*clamp(spd/7,0,1)/(1+spd*0.015);
    st.heading-=turn;  // steer right (+) curves toward screen-right
    if(drifting)st.vs+=st.steer*-Math.sign(st.vf||1)*spd*0.5*dt;
    st.vs*=(1-(drifting?2.2:6.5)*dt);

    const fx=Math.sin(st.heading),fz=Math.cos(st.heading);
    const rxc=Math.cos(st.heading),rzc=-Math.sin(st.heading);
    if(CITY.slopeGravity){const e=2.0,gx=(groundH(st.x+e,st.z)-groundH(st.x-e,st.z))/(2*e),gz=(groundH(st.x,st.z+e)-groundH(st.x,st.z-e))/(2*e);
      const ax=-9.8*0.5*gx,az=-9.8*0.5*gz;st.vf+=(ax*fx+az*fz)*dt;st.vs+=(ax*rxc+az*rzc)*dt;}
    let nx=st.x+(fx*st.vf+rxc*st.vs)*dt;
    let nz=st.z+(fz*st.vf+rzc*st.vs)*dt;

    if(collide(nx,nz)){
      const ox=collide(nx,st.z),oz2=collide(st.x,nz);
      if(!ox){nz=st.z;}else if(!oz2){nx=st.x;}else{nx=st.x;nz=st.z;}
      st.vf*=0.3;st.vs*=0.3;
    }
    nx=clamp(nx,B.x0,B.x1);nz=clamp(nz,B.z0,B.z1);
    st.x=nx;st.z=nz;st.y=groundH(st.x,st.z);
    if(world.onVoid&&world.onVoid(st.x,st.z)){respawn();return;}
    if(!collide(st.x,st.z)&&spd>2&&st.y>(CITY.safeMinY??-1e9)){
      lastSafe={x:st.x,z:st.z,h:st.heading};
      trailAcc+=dt;
      if(trailAcc>0.4){trailAcc=0;safeTrail.push({...lastSafe});if(safeTrail.length>5)safeTrail.shift();}
    }

    if(CITY.tiltToGround){st.y=orientCar(player.group,st.x,st.z,st.heading,1-Math.exp(-14*dt));}
    else{player.group.position.set(st.x,st.y,st.z);
      player.group.rotation.y=st.heading-(drifting?st.steer*0.25:0);
      player.group.rotation.z=lerp(player.group.rotation.z,-st.steer*spd*0.006,0.1);}
    for(const w of player.wheels)w.spin.rotation.x+=st.vf*dt/0.5;

    if(world.update)world.update(dt);

    if(speedEl)speedEl.firstChild.textContent=Math.round(spd*2.2);
    if(gearEl)gearEl.textContent=locationLabel(st.x,st.z);
    updateTour();

    if(eng){const rpm=60+spd*7+(th>0?18:0);eng.o.frequency.value=rpm;eng.o2.frequency.value=rpm*0.5;
      eng.g.gain.value=lerp(eng.g.gain.value,clamp(0.02+spd*0.0016,0,0.09),0.1);if(actx.state==='suspended')actx.resume();}
  }

  function updateCamera(dt){
    const fx=Math.sin(st.heading),fz=Math.cos(st.heading);const spd=Math.abs(st.vf);const y=st.y;
    if(viewMode===2){const t=game.t*0.25;const tp=new THREE.Vector3(st.x+Math.sin(t)*46,y+32+Math.sin(t*0.5)*6,st.z+Math.cos(t)*46);
      camPos.lerp(tp,1-Math.exp(-3*dt));camera.position.copy(camPos);camera.lookAt(st.x,y+3,st.z);
      if(camera.fov!==60){camera.fov=60;camera.updateProjectionMatrix();}}
    else if(viewMode===1){const tp=new THREE.Vector3(st.x+fx*1.6,y+2.0,st.z+fz*1.6);
      camPos.lerp(tp,1-Math.exp(-16*dt));camera.position.copy(camPos);camLook.set(st.x+fx*24,y+2.0,st.z+fz*24);camera.lookAt(camLook);
      const tf=62+spd*0.3;if(Math.abs(camera.fov-tf)>0.1){camera.fov=lerp(camera.fov,tf,0.08);camera.updateProjectionMatrix();}}
    else{const back=13+spd*0.14;const tp=new THREE.Vector3(st.x-fx*back,y+6.5+spd*0.03,st.z-fz*back);
      tp.y=Math.max(tp.y,groundH(tp.x,tp.z)+1.8);
      camPos.lerp(tp,1-Math.exp(-6*dt));camera.position.copy(camPos);camLook.set(st.x+fx*8,y+1.8,st.z+fz*8);camera.lookAt(camLook);
      const tf=60+spd*0.32;if(Math.abs(camera.fov-tf)>0.1){camera.fov=lerp(camera.fov,tf,0.08);camera.updateProjectionMatrix();}}
    sun.position.set(st.x+TH.sunPos[0],TH.sunPos[1],st.z+TH.sunPos[2]);sun.target.position.set(st.x,st.y,st.z);
  }

  // ---------- loop ----------
  let last=performance.now(),blink=0;
  const game=window.__game={t:0,speed:0,x:st.x,z:st.z,frames:0};
  function frame(now){
    requestAnimationFrame(frame);
    const dt=Math.min(0.05,(now-last)/1000);last=now;
    if(started)step(dt);
    updateCamera(dt);drawMini();
    blink+=dt;const bo=(Math.sin(blink*4)>0);for(const b of beacons)b.visible=bo;
    composer.render();
    game.t+=dt;game.speed=Math.abs(st.vf);game.x=st.x;game.z=st.z;game.frames++;
  }
  requestAnimationFrame(frame);

  return {scene,camera,renderer,state:st,showToast,toggleTour,start};
}

// ============================================================================
//  runWalk — 第一人稱步行runtime（本 repo 的分岔）
//  ---------------------------------------------------------------------------
//  只有走路。不做坐騎、不做衝刺、不做輕功衝刺。取代開闊速度快感的是視線：
//  天際的華山、從霧裡浮出來的襄陽城牆、上了脊線才看到官道接下來往哪。
//
//  WALK-CITY 契約（與 runCity 的 CITY 契約平行，但世界回傳的是走路要的東西）：
//    { id, name, subtitle, start:{x,z,heading}, timeOfDay, build(api) -> world }
//    world = { groundH(x,z), canStand(x,z), speedAt(x,z,groundH), locationLabel(x,z),
//              places:[{x,z,name,short}], bounds, size, update?(dt,ctx), stats }
// ============================================================================

const _DEG = 180 / Math.PI;

// 日夜是光，不是濾鏡。這一期它只管照明——遭遇率、客棧打烊那些代價留在 2D 的規則裡。
const SKYKEYS = [
  { h: 0,  top: 0x0a1430, mid: 0x101d38, bot: 0x1b2740, sun: 0x9fb6e0, sunInt: 0.30, hemiSky: 0x2a3c62, hemiGround: 0x14161c, hemiInt: 0.42, amb: 0.16, fog: 0x121a2c, fogD: 0.0030, exp: 1.02 },
  { h: 5,  top: 0x1b2f5e, mid: 0x6b5a72, bot: 0xc98d6a, sun: 0xffb27a, sunInt: 1.05, hemiSky: 0x7d8fb4, hemiGround: 0x3a3028, hemiInt: 0.85, amb: 0.26, fog: 0xb08a76, fogD: 0.0034, exp: 1.14 },
  { h: 7,  top: 0x3f74b8, mid: 0x9fc0d8, bot: 0xf0d2ae, sun: 0xffd9a8, sunInt: 2.35, hemiSky: 0xbcd2e6, hemiGround: 0x4a453a, hemiInt: 1.05, amb: 0.30, fog: 0xcfd8dc, fogD: 0.0026, exp: 1.16 },
  { h: 12, top: 0x4e88c8, mid: 0xa8c8de, bot: 0xdce8ee, sun: 0xfff3dc, sunInt: 3.05, hemiSky: 0xcfe0ee, hemiGround: 0x585044, hemiInt: 1.15, amb: 0.32, fog: 0xc8d6de, fogD: 0.0020, exp: 1.12 },
  { h: 17, top: 0x4676b4, mid: 0xb2bcc8, bot: 0xf0cfa4, sun: 0xffd9a0, sunInt: 2.45, hemiSky: 0xc4cfdc, hemiGround: 0x54483a, hemiInt: 1.02, amb: 0.30, fog: 0xd0cbc0, fogD: 0.0024, exp: 1.16 },
  { h: 19, top: 0x243f78, mid: 0x8a6a80, bot: 0xdc9060, sun: 0xff9c5e, sunInt: 1.20, hemiSky: 0x8a90b4, hemiGround: 0x3c3028, hemiInt: 0.78, amb: 0.24, fog: 0xa8836e, fogD: 0.0032, exp: 1.12 },
  { h: 21, top: 0x0d1836, mid: 0x14223e, bot: 0x223048, sun: 0x9fb6e0, sunInt: 0.36, hemiSky: 0x30436a, hemiGround: 0x16181e, hemiInt: 0.46, amb: 0.17, fog: 0x141c30, fogD: 0.0030, exp: 1.04 },
  { h: 24, top: 0x0a1430, mid: 0x101d38, bot: 0x1b2740, sun: 0x9fb6e0, sunInt: 0.30, hemiSky: 0x2a3c62, hemiGround: 0x14161c, hemiInt: 0.42, amb: 0.16, fog: 0x121a2c, fogD: 0.0030, exp: 1.02 },
];

function skyAt(h) {
  h = ((h % 24) + 24) % 24;
  let a = SKYKEYS[0], b = SKYKEYS[SKYKEYS.length - 1];
  for (let i = 0; i < SKYKEYS.length - 1; i++) {
    if (h >= SKYKEYS[i].h && h <= SKYKEYS[i + 1].h) { a = SKYKEYS[i]; b = SKYKEYS[i + 1]; break; }
  }
  const t = (h - a.h) / ((b.h - a.h) || 1);
  const mixC = (x, y) => {
    const c = new THREE.Color(x); return c.lerp(new THREE.Color(y), t);
  };
  return {
    top: mixC(a.top, b.top), mid: mixC(a.mid, b.mid), bot: mixC(a.bot, b.bot),
    sun: mixC(a.sun, b.sun), fog: mixC(a.fog, b.fog),
    sunInt: lerp(a.sunInt, b.sunInt, t), hemiSky: mixC(a.hemiSky, b.hemiSky),
    hemiGround: mixC(a.hemiGround, b.hemiGround), hemiInt: lerp(a.hemiInt, b.hemiInt, t),
    amb: lerp(a.amb, b.amb, t), fogD: lerp(a.fogD, b.fogD, t), exp: lerp(a.exp, b.exp, t),
  };
}

// 太陽方位：六點自東升，十八點落西，向北偏一點，所以影子往南倒。
function sunDirAt(h) {
  const ang = (h - 6) / 12 * Math.PI;
  const v = new THREE.Vector3(Math.cos(ang), Math.sin(ang), -0.34).normalize();
  if (v.y < 0.04) { v.y = 0.04 - v.y * 0.5; v.normalize(); }     // 夜裡當月光用，不要從地底照上來
  return v;
}

export function runWalk(CITY) {
  const DAY_SECONDS = CITY.daySeconds ?? 210;      // 一個遊戲日約三分半實時
  const EYE = CITY.eye ?? 1.66;

  // ---------- 場 ----------
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.12, 2600);
  scene.add(camera);            // 上馬後那截馬頸掛在相機底下，相機得在場景圖裡才畫得到
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.75, 0.90);
  composer.addPass(bloom);

  // 環境反射（金殿的鎏金、水面）——只生一次，用正午那張
  (function envMap() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, '#3a6ca8'); g.addColorStop(0.48, '#a9c6dc');
    g.addColorStop(0.62, '#dfe8ea'); g.addColorStop(1, '#5c5a4c');
    x.fillStyle = g; x.fillRect(0, 0, 256, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader();
    scene.environment = pmrem.fromEquirectangular(tex).texture;
    tex.dispose(); pmrem.dispose();
  })();

  const hemi = new THREE.HemisphereLight(0xbcd2e6, 0x4a453a, 1.0); scene.add(hemi);
  const amb = new THREE.AmbientLight(0xffffff, 0.3); scene.add(amb);
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.6);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const SS = CITY.shadowSpan ?? 120;
  sun.shadow.camera.left = -SS; sun.shadow.camera.right = SS;
  sun.shadow.camera.top = SS; sun.shadow.camera.bottom = -SS;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.35;
  scene.add(sun); scene.add(sun.target);

  // 天穹
  const skyU = {
    top: { value: new THREE.Color(0x4e88c8) }, mid: { value: new THREE.Color(0xa8c8de) },
    bot: { value: new THREE.Color(0xdce8ee) }, sun: { value: new THREE.Vector3(0, 1, 0) },
    night: { value: 0 },
  };
  (function skyDome() {
    const g = new THREE.SphereGeometry(2000, 40, 24);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, uniforms: skyU,
      vertexShader: `varying vec3 vp;void main(){vp=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 vp;uniform vec3 top,mid,bot,sun;uniform float night;
        float hash(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,45.164)))*43758.5453);}
        void main(){float h=clamp(vp.y*1.15+0.14,0.0,1.0);
          vec3 c=mix(bot,mid,smoothstep(0.0,0.40,h));c=mix(c,top,smoothstep(0.38,0.95,h));
          float s=max(dot(vp,sun),0.0);
          c+=vec3(1.0,0.72,0.42)*pow(s,8.0)*0.55*(1.0-night);
          c+=vec3(1.0,0.86,0.62)*pow(s,220.0)*2.2;
          if(night>0.05){vec3 q=floor(vp*260.0);float st=hash(q);
            float tw=step(0.9975,st)*night*smoothstep(0.02,0.35,vp.y);
            c+=vec3(0.85,0.9,1.0)*tw*1.4;}
          gl_FragColor=vec4(c,1.0);}`,
    });
    scene.add(new THREE.Mesh(g, m));
  })();

  // ---------- 建世界 ----------
  const api = { THREE, scene, renderer, camera, clamp, lerp };
  const world = CITY.build(api) || {};
  const groundH = world.groundH || (() => 0);
  const canStand = world.canStand || (() => true);
  const speedAt = world.speedAt || (() => 1.5);
  const horseSpeedAt = world.horseSpeedAt || speedAt;
  const canRide = world.canRide || (() => false);
  const herd = world.herd || null;
  const minimap = world.minimap || null;
  const places = world.places || [];
  const B = world.bounds || { x0: -400, x1: 400, z0: -300, z1: 300 };

  // ---------- 走的人 ----------
  const START = CITY.start || { x: 0, z: 0, heading: 0 };
  const st = {
    x: START.x, z: START.z, heading: START.heading || 0, pitch: 0,
    y: 0, bob: 0, speed: 0, clock: CITY.timeOfDay ?? 8.5, moving: 0,
    mounted: null, horseGait: 0,
  };
  st.y = groundH(st.x, st.z);

  // ---------- 輸入 ----------
  const keys = {};
  const $ = s => document.querySelector(s);
  addEventListener('keydown', e => {
    const k = e.key.toLowerCase(); keys[k] = true;
    if (k === 'n') { st.clock = (st.clock + 3) % 24; toast(clockLabel()); }
    if (k === 'f') toggleMount();
    if (k === 'm' && minimap) toast(minimap.toggleOrientation() ? '小地圖：朝向在上' : '小地圖：指北');
    if (k === '[' && minimap) minimap.zoom(1.35);
    if (k === ']' && minimap) minimap.zoom(1 / 1.35);
    if (k === 'h') { const el = $('#hint'); if (el) el.style.opacity = el.style.opacity === '0' ? '0.55' : '0'; }
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  });
  addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

  // 滑鼠看向：指標鎖定。沒鎖也能玩——左右方向鍵一樣能轉頭。
  const cv = renderer.domElement;
  cv.addEventListener('click', () => { if (started && !document.pointerLockElement) cv.requestPointerLock?.(); });
  addEventListener('mousemove', e => {
    if (document.pointerLockElement !== cv) return;
    st.heading -= e.movementX * 0.0022;
    st.pitch = clamp(st.pitch - e.movementY * 0.0022, -1.15, 1.05);
  });

  // 觸控：左半邊推著走，右半邊拖著看
  const touch = { move: null, look: null, mx: 0, mz: 0 };
  cv.addEventListener('touchstart', e => {
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.45 && !touch.move) touch.move = { id: t.identifier, x0: t.clientX, y0: t.clientY };
      else if (!touch.look) touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
    }
  }, { passive: true });
  cv.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (touch.move && t.identifier === touch.move.id) {
        touch.mx = clamp((t.clientX - touch.move.x0) / 60, -1, 1);
        touch.mz = clamp((touch.move.y0 - t.clientY) / 60, -1, 1);
      } else if (touch.look && t.identifier === touch.look.id) {
        st.heading -= (t.clientX - touch.look.x) * 0.005;
        st.pitch = clamp(st.pitch - (t.clientY - touch.look.y) * 0.005, -1.15, 1.05);
        touch.look.x = t.clientX; touch.look.y = t.clientY;
      }
    }
    e.preventDefault();
  }, { passive: false });
  const endTouch = e => {
    for (const t of e.changedTouches) {
      if (touch.move && t.identifier === touch.move.id) { touch.move = null; touch.mx = touch.mz = 0; }
      if (touch.look && t.identifier === touch.look.id) touch.look = null;
    }
  };
  cv.addEventListener('touchend', endTouch); cv.addEventListener('touchcancel', endTouch);
  if ('ontouchstart' in window) document.body.classList.add('touch');

  // ---------- HUD ----------
  const placeEl = $('#place'), compassEl = $('#compass'), altEl = $('#alt'),
        clockEl = $('#clock'), toastEl = $('#toast'), speedEl = $('#pace'),
        mountEl = $('#mount');
  let toastT = 0;
  function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text; toastEl.style.opacity = 1;
    clearTimeout(toastT); toastT = setTimeout(() => { toastEl.style.opacity = 0; }, 1700);
  }
  const DIRS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
  function compassLabel() {
    // 慣例：+x 東、+z 南、前方 = (sinθ, cosθ)，heading = π 面北
    const deg = ((st.heading * _DEG) % 360 + 360) % 360;
    const idx = Math.round(((deg + 180) % 360) / 45) % 8;
    return DIRS[idx];
  }
  const SHICHEN = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  function clockLabel() {
    const h = ((st.clock % 24) + 24) % 24;
    const k = Math.floor(((h + 1) % 24) / 2);
    const m = Math.floor((h % 1) * 60);
    return `${SHICHEN[k]}時 ${String(Math.floor(h)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  let lastPlace = '';
  function updateHud() {
    const label = world.locationLabel ? world.locationLabel(st.x, st.z) : '';
    if (placeEl) placeEl.textContent = label;
    if (label && label !== lastPlace && !/^荒/.test(label)) toast(label);
    lastPlace = label;
    if (compassEl) compassEl.textContent = compassLabel();
    if (altEl) altEl.textContent = `海拔 ${Math.round(st.y)} 公尺`;
    if (clockEl) clockEl.textContent = clockLabel();
    if (speedEl) speedEl.textContent = (st.mounted ? '🐴 ' : '') + `${st.speed.toFixed(1)} m/s`;
    if (mountEl) {
      const near = herd && !st.mounted ? herd.nearest(st.x, st.z) : null;
      mountEl.textContent = st.mounted ? 'F · 下馬'
        : (near && near.horse && near.dist <= MOUNT_RANGE ? `F · 上馬（${near.horse.name}）` : '');
    }
  }

  // ---------- 光隨時辰 ----------
  let envDirty = 0;
  function applySky(force) {
    const s = skyAt(st.clock);
    skyU.top.value.copy(s.top); skyU.mid.value.copy(s.mid); skyU.bot.value.copy(s.bot);
    const d = sunDirAt(st.clock);
    skyU.sun.value.copy(d);
    const h = ((st.clock % 24) + 24) % 24;
    skyU.night.value = clamp(h < 5 ? 1 : h < 7 ? (7 - h) / 2 : h < 18.5 ? 0 : h < 21 ? (h - 18.5) / 2.5 : 1, 0, 1);
    sun.color.copy(s.sun); sun.intensity = s.sunInt;
    hemi.color.copy(s.hemiSky); hemi.groundColor.copy(s.hemiGround); hemi.intensity = s.hemiInt;
    amb.intensity = s.amb;
    renderer.toneMappingExposure = s.exp;
    if (!scene.fog) scene.fog = new THREE.FogExp2(s.fog.getHex(), s.fogD);
    scene.fog.color.copy(s.fog); scene.fog.density = s.fogD;
    scene.background = s.fog.clone();
    sun.position.set(st.x + d.x * 260, d.y * 260 + 40, st.z + d.z * 260);
    sun.target.position.set(st.x, st.y, st.z);
    bloom.strength = 0.26 + skyU.night.value * 0.30;
  }

  // ---------- 上馬／下馬 ----------
  //  馬只走得了平地與官道，華山石階整條不給騎——到了山門就得下馬。
  //  「快」是官道的獎賞，登頂仍然是兩條腿的事。
  const MOUNT_RANGE = 4.2;
  function toggleMount() {
    if (!herd) return;
    if (st.mounted) {
      herd.dismount(st.mounted, st.x, st.z, st.heading);
      st.mounted = null; st.horseGait = 0;
      toast('下馬');
      return;
    }
    const { horse, dist } = herd.nearest(st.x, st.z);
    if (!horse || dist > MOUNT_RANGE) { toast('附近沒有馬'); return; }
    if (!canRide(st.x, st.z)) { toast('這裡上不了馬'); return; }
    st.mounted = herd.mount(horse);
    toast('上馬 · ' + horse.name);
  }
  function autoDismount() {
    // 騎到馬過不去的地方（山道口、雪線、陡坡）就自己下來，不要把人卡在那裡
    herd.dismount(st.mounted, st.x, st.z, st.heading);
    st.mounted = null; st.horseGait = 0;
    toast('馬上不去了 · 下馬');
  }

  // ---------- 走 ----------
  function tryMove(nx, nz) {
    const ok = st.mounted ? canRide : canStand;
    if (ok(nx, nz)) return { x: nx, z: nz };
    if (ok(nx, st.z)) return { x: nx, z: st.z };            // 沿牆滑
    if (ok(st.x, nz)) return { x: st.x, z: nz };
    return { x: st.x, z: st.z };
  }

  let auto = null;                       // 自走測試用
  let blockedFor = 0;
  function step(dt) {
    let fwd = 0, side = 0, turn = 0;
    if (keys['w'] || keys['arrowup']) fwd += 1;
    if (keys['s'] || keys['arrowdown']) fwd -= 1;
    if (keys['a']) side -= 1;
    if (keys['d']) side += 1;
    if (keys['arrowleft'] || keys['q']) turn += 1;
    if (keys['arrowright'] || keys['e']) turn -= 1;
    if (touch.move) { side += touch.mx; fwd += touch.mz; }

    if (auto) {
      const tgt = auto.pts[auto.i];
      if (!tgt) { auto = null; }
      else {
        const dx = tgt.x - st.x, dz = tgt.z - st.z;
        const d = Math.hypot(dx, dz);
        if (d < auto.tol) { auto.i++; auto.stuck = 0; }
        else {
          const want = Math.atan2(dx, dz);
          let diff = want - st.heading;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          st.heading += clamp(diff, -3.2 * dt, 3.2 * dt);
          fwd = 1; side = 0;
        }
      }
    }

    st.heading += turn * 1.9 * dt;
    const mag = Math.hypot(fwd, side);
    if (mag > 1) { fwd /= mag; side /= mag; }

    const base = st.mounted ? horseSpeedAt(st.x, st.z, groundH) : speedAt(st.x, st.z, groundH);
    const v = base * Math.min(1, mag);
    st.speed = v;
    if (v > 0.01) {
      const fx = Math.sin(st.heading), fz = Math.cos(st.heading);
      const rx = Math.cos(st.heading), rz = -Math.sin(st.heading);
      const nx = st.x + (fx * fwd + rx * side) * v * dt;
      const nz = st.z + (fz * fwd + rz * side) * v * dt;
      const p = tryMove(clamp(nx, B.x0, B.x1), clamp(nz, B.z0, B.z1));
      const moved = Math.hypot(p.x - st.x, p.z - st.z);
      st.x = p.x; st.z = p.z;
      st.bob += moved * (st.mounted ? 0.9 : 2.1);
      st.moving = moved > 1e-4 ? 1 : 0;
      if (st.mounted && moved < 1e-5 && mag > 0.5) {
        blockedFor += dt;
        if (blockedFor > 0.55) { autoDismount(); blockedFor = 0; }
      } else blockedFor = 0;
      if (auto) { auto.travelled += moved; if (moved < 1e-5) auto.stuck += dt; }
    } else st.moving = 0;

    st.y = groundH(st.x, st.z);
    st.clock = (st.clock + dt / DAY_SECONDS * 24) % 24;
    if (world.update) world.update(dt, st);
  }

  function updateCamera() {
    const bobY = Math.sin(st.bob) * (st.mounted ? 0.035 : 0.055) * st.moving;
    const bobR = Math.cos(st.bob * 0.5) * 0.012 * st.moving;
    const eye = st.mounted ? EYE + 1.05 : EYE;      // 馬背上看得遠一點
    camera.position.set(st.x, st.y + eye + bobY, st.z);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(st.heading + Math.PI);       // heading = π 面北 ⇒ 相機朝 +z 為 heading 0
    camera.rotateX(st.pitch);
    camera.rotateZ(bobR);
  }

  // ---------- 起始遮罩 ----------
  let started = false;
  const overlay = $('#overlay');
  function start() {
    if (started) return; started = true;
    if (overlay) { overlay.style.opacity = 0; setTimeout(() => { overlay.style.display = 'none'; }, 700); }
    cv.requestPointerLock?.();
    setTimeout(() => { const t = $('#title'); if (t) t.style.opacity = 0; }, 9000);
  }
  const startBtn = $('#startBtn');
  if (startBtn) {
    startBtn.addEventListener('click', start);
    startBtn.addEventListener('touchstart', e => { e.preventDefault(); start(); }, { passive: false });
  }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  });

  // ---------- 給無頭測試的把手 ----------
  //  frameMs 收的是真的每幀時間，p95 是算出來的，不是看的。
  const G = window.__jianghu = {
    ready: false, t: 0, frames: 0, frameMs: [],
    get x() { return st.x; }, get z() { return st.z; }, get y() { return st.y; },
    get heading() { return st.heading; }, get clock() { return st.clock; },
    get speed() { return st.speed; }, get place() { return lastPlace; },
    stats: world.stats || {},
    start,
    setTime(h) { st.clock = h; applySky(true); },
    teleport(x, z, heading) { st.x = x; st.z = z; if (heading !== undefined) st.heading = heading; st.y = groundH(x, z); },
    // 沿一串世界座標自走。給 uismoke 驗「揚州出生，走得到華山之巔」用的。
    autowalk(pts, tol = 3.2) { auto = { pts, i: 0, tol, travelled: 0, stuck: 0 }; return auto; },
    get autoState() { return auto ? { i: auto.i, n: auto.pts.length, travelled: auto.travelled, stuck: auto.stuck } : null; },
    // 不畫面、只跑模擬的快轉。432 公尺用走的要五分鐘實時，用這個是幾十毫秒。
    simulate(seconds, dt = 1 / 30) {
      const n = Math.ceil(seconds / dt);
      for (let i = 0; i < n; i++) { step(dt); if (auto && auto.i >= auto.pts.length) return { done: true, steps: i }; }
      return { done: !auto || auto.i >= auto.pts.length, steps: n };
    },
    // 光是不是真的隨時辰在動——日夜是系統的照明，不是一張濾鏡
    lightState() {
      return {
        sunInt: +sun.intensity.toFixed(3), exposure: +renderer.toneMappingExposure.toFixed(3),
        fogD: +(scene.fog ? scene.fog.density : 0).toFixed(5),
        night: +skyU.night.value.toFixed(3),
        sunY: +skyU.sun.value.y.toFixed(3),
      };
    },
    p95() {
      if (this.frameMs.length < 8) return null;
      const a = this.frameMs.slice().sort((x, y) => x - y);
      return a[Math.floor(a.length * 0.95)];
    },
    world,
    get mounted() { return st.mounted ? st.mounted.name : null; },
    mountToggle: () => toggleMount(),
    minimapSample: () => (minimap ? minimap.sample() : null),
    minimapState: () => (minimap ? { ...minimap.state } : null),
    minimapToggle: () => (minimap ? minimap.toggleOrientation() : null),
  };

  // ---------- 迴圈 ----------
  let last = performance.now();
  applySky(true); updateCamera();
  function frame(now) {
    requestAnimationFrame(frame);
    const raw = now - last; last = now;
    const dt = Math.min(0.05, raw / 1000);
    if (started) step(dt);
    updateCamera();
    applySky();
    composer.render();
    G.t += dt; G.frames++;
    if (G.frames > 12) { G.frameMs.push(raw); if (G.frameMs.length > 400) G.frameMs.shift(); }
    if (G.frames % 6 === 0) updateHud();
    if (minimap && G.frames % 2 === 0) minimap.draw(st);
  }
  requestAnimationFrame(frame);
  G.ready = true;

  document.title = `${CITY.name || '江湖'} — ${CITY.subtitle || ''}`;
  if ($('#title h1')) $('#title h1').textContent = CITY.name || '江湖';
  if ($('#title p')) $('#title p').textContent = CITY.subtitle || '';
  return G;
}
