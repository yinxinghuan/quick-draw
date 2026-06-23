// Quick Draw — a voxel Wild-West standoff reflex duel. Three.js v0.160 ES module.
//
// Two gunslingers face off. After a tense random pause the screen flashes DRAW! —
// TAP as fast as you can. Beat the opponent's reaction and they drop; draw before
// the signal and you FOUL (instant loss). Clear a gauntlet of ever-faster outlaws.
// Single input: one tap, only meaningful at the draw. Score = duels won.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { P, box } from './lib/prims.js';
import { CHARACTERS } from './builders/characters.js?v=1';

// --- tunables ---------------------------------------------------------------
const PLAYER_X = -2.5, OPP_X = 2.5;          // the two marks on the street
const HERO_SCALE = 0.78;
const SET_MIN = 1.2, SET_MAX = 3.6;          // random tense wait before DRAW
const LEAD_IN = 0.45;                        // un-foulable grace at the very start of the wait
const OPP_REACTION_START = 0.54;             // first outlaw is slow…
const OPP_REACTION_FLOOR = 0.17;             // …the Marshal is near-inhuman
const OPP_REACTION_STEP = 0.034;             // faster each duel
const OPP_JITTER = 0.03;

const OUTLAWS = [
  'The Greenhorn', 'Dusty Pete', 'The Drifter', 'One-Eye Jack', 'Calamity Sue',
  'Three-Finger Lou', 'Dead-Eye Dan', 'Black Bart', 'Rattlesnake Kate', 'El Diablo',
  'The Undertaker', 'The Marshal', 'The Reaper',
];
const outlawName = (i) => OUTLAWS[Math.min(i, OUTLAWS.length - 1)] + (i >= OUTLAWS.length ? ' +' + (i - OUTLAWS.length + 2) : '');

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);

export function startGame({ canvas, hud }){
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd9956a, 22, 48);

  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 120);
  const CAM_BASE = new THREE.Vector3(-1.1, 2.7, 9.6);
  const CAM_LOOK = new THREE.Vector3(0, 1.15, 0);
  let camPunch = 0;
  function placeCamera(){
    const z = 1 - camPunch * 0.12;
    camera.position.set(CAM_BASE.x * z, CAM_BASE.y, CAM_BASE.z * z);
    camera.lookAt(CAM_LOOK);
  }
  placeCamera();

  // ── dusk-desert sky: deep indigo crown → blazing amber sun on the horizon ──
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(200, 24, 14),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x2a2148) }, mid: { value: new THREE.Color(0xb5547a) },
        bot: { value: new THREE.Color(0xf2a850) }, glow: { value: new THREE.Color(0xffd27a) },
        glowDir: { value: new THREE.Vector3(0.1, -0.05, -1).normalize() },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform vec3 glow; uniform vec3 glowDir; void main(){ vec3 n=normalize(vP); float h=n.y; vec3 c = h>0.0?mix(mid,top,clamp(h*1.3,0.0,1.0)):mix(mid,bot,clamp(-h*2.2,0.0,1.0)); float g=clamp(dot(n,glowDir),0.0,1.0); c=mix(c,glow,g*g*0.7); gl_FragColor=vec4(c,1.0); }',
    })
  );
  scene.add(sky);
  // low sun disc behind the duel
  const sun = new THREE.Mesh(new THREE.CircleGeometry(4.2, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe39a, fog: false }));
  sun.position.set(0.5, 3.4, -30); scene.add(sun);

  // ── lighting: warm low key + cool fill ──
  scene.add(new THREE.HemisphereLight(0xffe0b0, 0x4a2f3a, 0.85));
  const key = new THREE.DirectionalLight(0xffd9a0, 1.25);
  key.position.set(-3, 9, -8);               // raking light from the sun side
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1; key.shadow.camera.far = 40;
  key.shadow.camera.left = -8; key.shadow.camera.right = 8;
  key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
  key.shadow.bias = -0.0005;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb0ff, 0.35);
  rim.position.set(5, 4, 9); scene.add(rim);

  // ── desert ground + a dirt road strip + a couple of cacti ──
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: 0xcf9b63, roughness: 1, flatShading: true }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(40, 4.4),
    new THREE.MeshStandardMaterial({ color: 0xb07f4e, roughness: 1 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0.01, 0.6); road.receiveShadow = true; scene.add(road);
  function cactus(x, z, s){
    const g = new THREE.Group();
    g.add(box(0.4 * s, 1.7 * s, 0.4 * s, 0x4f7a3a, 0, 0.85 * s, 0, { r: 1 }));
    g.add(box(0.28 * s, 0.7 * s, 0.28 * s, 0x4f7a3a, 0.36 * s, 1.1 * s, 0, { r: 1 }));
    g.add(box(0.28 * s, 0.55 * s, 0.28 * s, 0x4f7a3a, -0.34 * s, 1.3 * s, 0, { r: 1 }));
    g.position.set(x, 0, z); g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }
  scene.add(cactus(-7, -4, 1.1)); scene.add(cactus(8, -6, 0.9)); scene.add(cactus(6.5, -2, 0.6));
  // saloon-ish silhouette backdrop (simple boxes far back)
  const town = new THREE.Group();
  for (let i = -3; i <= 3; i++){
    if (i === 0) continue;
    const h = 2.2 + (i * 37 % 5) * 0.4;
    town.add(box(3.2, h, 2, 0x6e4a3a, i * 4.2, h / 2, -16, { r: 1 }));
    town.add(box(3.6, 0.6, 2.2, 0x553828, i * 4.2, h + 0.2, -16, { r: 1 }));   // false-front cornice
  }
  scene.add(town);

  // ── floating dust motes ──
  const MOTES = 70;
  const mGeo = new THREE.BufferGeometry(); const mPos = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES; i++){ mPos[i*3] = (Math.random()*2-1)*10; mPos[i*3+1] = Math.random()*5; mPos[i*3+2] = (Math.random()*2-1)*6; }
  mGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
  const motes = new THREE.Points(mGeo, new THREE.PointsMaterial({ color: 0xffe6c0, size: 0.07, transparent: true, opacity: 0.6, depthWrite: false, fog: false }));
  scene.add(motes);

  // ── bloom (sun + muzzle flash) ──
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.6, 0.8);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize(){
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();

  // ── the two gunslingers ──────────────────────────────────────────────────
  const ROSTER = Object.keys(CHARACTERS);
  // build a fighter holder { root, rig, gun, flash, baseArmR } facing the centre
  function buildFighter(charKey, side){   // side -1 = player (left, faces +x), +1 = opp (right, faces -x)
    const model = (CHARACTERS[charKey] || CHARACTERS.cowboy)();
    model.scale.setScalar(HERO_SCALE);
    const bb = new THREE.Box3().setFromObject(model);
    model.position.y = -bb.min.y;
    const root = new THREE.Group();
    root.add(model);
    root.position.set(side < 0 ? PLAYER_X : OPP_X, 0, 0);
    root.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;   // face each other
    const rig = model.userData.rig || null;
    // a little voxel six-shooter in the right hand (pointing along local +z = toward foe)
    let gun = null, flash = null;
    if (rig){
      gun = new THREE.Group();
      gun.add(box(0.12, 0.12, 0.4, P.ironD, 0, 0, 0.16));         // barrel
      gun.add(box(0.13, 0.26, 0.13, 0x6b4a2e, 0, -0.14, -0.04));  // grip
      gun.add(box(0.16, 0.16, 0.12, P.ironM, 0, 0, -0.02));       // cylinder
      gun.position.set(0, -0.9 * HERO_SCALE, 0.05);
      rig.armR.add(gun);
      flash = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffe79a, transparent: true, opacity: 0, fog: false }));
      flash.position.set(0, 0, 0.42); gun.add(flash);
    }
    scene.add(root);
    return { root, model, rig, gun, flash, key: charKey, baseArmR: rig ? rig.armR.rotation.x : 0, _baseY: model.position.y, fallen: false, fallT: 0 };
  }
  let player = buildFighter('cowboy', -1);
  let opp = null;

  function setRestPose(f){
    if (!f.rig) return;
    f.rig.armR.rotation.set(f.baseArmR + 0.05, 0, 0);   // hand hovers near the holster
    f.rig.armL.rotation.set(0, 0, 0);
    f.gun && (f.gun.visible = false);
    f.root.rotation.z = 0;
    f.model.visible = true;
  }
  // raise the shooting arm forward + muzzle flash (fire at the foe)
  function drawAndFire(f){
    if (!f.rig) return;
    f.gun && (f.gun.visible = true);
    f.rig.armR.rotation.x = f.baseArmR - 1.5;            // arm swings forward, gun level at foe
    if (f.flash){ f.flash.material.opacity = 1; f.flash.scale.setScalar(1); }
    const wp = new THREE.Vector3();
    if (f.flash){ f.flash.getWorldPosition(wp); burst(wp.x, wp.y, wp.z, { count: 10, color: 0xffd06a, speed: 4, up: 1.5, size: 0.12, life: 0.3, emissive: 1.4 }); }
    sfxShot();
  }

  // ── particle pool (shatter the loser) ──
  const PCOUNT = 120;
  const pGeo = new THREE.BoxGeometry(1, 1, 1);
  const pPool = [];
  for (let i = 0; i < PCOUNT; i++){
    const m = new THREE.Mesh(pGeo, new THREE.MeshStandardMaterial({ flatShading: true, transparent: true }));
    m.visible = false; m.castShadow = false; scene.add(m);
    pPool.push({ m, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 0.1, grav: 9, spin: 0 });
  }
  let pCur = 0;
  function spawnP(x, y, z, color, o){
    const p = pPool[pCur]; pCur = (pCur + 1) % PCOUNT;
    const m = p.m; m.visible = true; m.position.set(x, y, z);
    const s = o.size || 0.12; m.scale.set(s, s, s);
    m.material.color.setHex(color);
    if (o.emissive){ m.material.emissive.setHex(color); m.material.emissiveIntensity = o.emissive; } else { m.material.emissive.setHex(0); m.material.emissiveIntensity = 0; }
    m.material.opacity = 1; m.rotation.set(Math.random()*3, Math.random()*3, Math.random()*3);
    p.vx = o.vx||0; p.vy = o.vy||0; p.vz = o.vz||0; p.grav = o.grav!=null?o.grav:9; p.life = p.maxLife = o.life||0.6; p.size = s; p.spin = o.spin||0;
  }
  function burst(x, y, z, { count=12, color=0xffffff, speed=3, up=3, size=0.13, life=0.6, emissive=0 } = {}){
    for (let i = 0; i < count; i++){ const a = Math.random()*Math.PI*2, r = Math.random();
      spawnP(x, y, z, color, { vx: Math.cos(a)*speed*r, vy: up*(0.4+Math.random()), vz: Math.sin(a)*speed*r, size: size*(0.7+Math.random()*0.6), life: life*(0.7+Math.random()*0.6), grav: 10, emissive, spin: 7 }); }
  }
  function shatter(f){
    f.root.updateWorldMatrix(true, true);
    const wp = new THREE.Vector3();
    const dir = f === player ? -1 : 1;     // blown away from the foe
    f.model.traverse(o => {
      if (!o.isMesh) return;
      o.getWorldPosition(wp);
      const col = (o.material && o.material.color) ? o.material.color.getHex() : 0xcccccc;
      spawnP(wp.x, wp.y, wp.z, col, { vx: dir*(1.5+Math.random()*2.5), vy: 1+Math.random()*2.6, vz: (Math.random()*2-1)*1.6, size: 0.15, life: 1.1, grav: 9, spin: 8 });
    });
    f.model.visible = false; f.fallen = true;
  }
  function updateParticles(dt){
    for (const p of pPool){ if (!p.m.visible) continue; p.life -= dt; if (p.life <= 0){ p.m.visible = false; continue; }
      const m = p.m; m.position.x += p.vx*dt; m.position.y += p.vy*dt; m.position.z += p.vz*dt; p.vy -= p.grav*dt;
      const t = p.life/p.maxLife; m.scale.setScalar(p.size*Math.max(0.2, t)); m.material.opacity = Math.min(1, t*1.6);
      m.rotation.x += p.spin*dt; m.rotation.y += p.spin*dt; }
  }

  // ── slow-mo ──
  let slow = 0, slowAmt = 1, timeScale = 1;
  function doSlow(amt, dur){ slow = dur; slowAmt = amt; }

  // ── WebAudio ──
  let AC = null, master = null, tense = null, tenseGain = null;
  function audioUnlock(){
    if (AC){ if (AC.state !== 'running' && AC.resume) AC.resume(); return; }
    const ACtor = window.AudioContext || window.webkitAudioContext; if (!ACtor) return;
    AC = new ACtor(); master = AC.createGain(); master.gain.value = 0.9;
    const comp = AC.createDynamicsCompressor(); master.connect(comp); comp.connect(AC.destination);
    if (AC.state !== 'running' && AC.resume) AC.resume();
  }
  function tone(freq, dur, o = {}){
    if (!AC) return; const t0 = AC.currentTime + (o.delay||0);
    const osc = AC.createOscillator(); osc.type = o.type||'sine'; osc.frequency.setValueAtTime(freq, t0);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0+dur);
    const g = AC.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(o.gain||0.2, t0+0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
    const lp = AC.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value = o.lp||3200;
    osc.connect(g); g.connect(lp); lp.connect(master); osc.start(t0); osc.stop(t0+dur+0.03);
  }
  function noiseBurst(dur, o = {}){
    if (!AC) return; const t0 = AC.currentTime + (o.delay||0);
    const n = Math.max(1, Math.floor(AC.sampleRate*dur)); const buf = AC.createBuffer(1, n, AC.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random()*2-1)*(1-i/n);
    const src = AC.createBufferSource(); src.buffer = buf; const g = AC.createGain(); g.gain.value = o.gain||0.15;
    const f = AC.createBiquadFilter(); f.type = o.type||'highpass'; f.frequency.value = o.hp||500;
    src.connect(f); f.connect(g); g.connect(master); src.start(t0);
  }
  function startTense(){   // a low ominous standoff drone during the wait
    if (!AC || tense) return;
    tenseGain = AC.createGain(); tenseGain.gain.value = 0; tenseGain.connect(master);
    tense = AC.createOscillator(); tense.type = 'sawtooth'; tense.frequency.value = 55;
    const lp = AC.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value = 180;
    tense.connect(lp); lp.connect(tenseGain); tense.start();
  }
  function tenseUp(on){ if (tenseGain && AC) tenseGain.gain.setTargetAtTime(on ? 0.07 : 0.0001, AC.currentTime, 0.2); }
  function sfxDrawCall(){ tone(1320, 0.16, { type: 'square', gain: 0.16 }); tone(880, 0.2, { gain: 0.12, delay: 0.02 }); }
  function sfxShot(){ noiseBurst(0.18, { gain: 0.3, hp: 300 }); tone(140, 0.16, { type: 'sawtooth', gain: 0.18, slideTo: 50 }); }
  function sfxWin(){ tone(523, 0.12, { gain: 0.16 }); tone(784, 0.18, { gain: 0.14, delay: 0.09 }); }
  function sfxFoul(){ tone(200, 0.4, { type: 'square', gain: 0.18, slideTo: 90 }); noiseBurst(0.3, { gain: 0.1, hp: 200 }); }
  function sfxClick(){ tone(660, 0.07, { gain: 0.12, slideTo: 880 }); }

  // ── state machine ──────────────────────────────────────────────────────────
  const READY = 'ready', SET = 'set', DRAW = 'draw', RESOLVE = 'resolve', DEAD = 'dead';
  let state = READY;
  let duelIdx = 0, wins = 0, best = readBest();
  let setT = 0, setDelay = 0, drawAtMs = 0, oppReaction = 0, resolveT = 0, playerWon = false, lastReaction = 0;

  function readBest(){ try { return Number(localStorage.getItem('qd.best')) || 0; } catch(e){ return 0; } }
  function writeBest(v){ try { localStorage.setItem('qd.best', String(v)); } catch(e){} }

  function oppReactionFor(i){ return clamp(OPP_REACTION_START - i * OPP_REACTION_STEP, OPP_REACTION_FLOOR, OPP_REACTION_START) + (Math.random()*2-1) * OPP_JITTER; }

  function newOpponent(){
    if (opp) scene.remove(opp.root);
    const key = ROSTER[Math.floor(Math.random() * ROSTER.length)];
    opp = buildFighter(key, 1);
    setRestPose(opp);
  }

  function beginDuel(){
    newOpponent();
    setRestPose(player);
    oppReaction = oppReactionFor(duelIdx);
    state = SET; setT = 0;
    setDelay = SET_MIN + Math.random() * (SET_MAX - SET_MIN);
    startTense(); tenseUp(true);
    hud.setWins(wins);
    hud.setOpponent(outlawName(duelIdx));
    hud.setStatus('WAIT FOR IT…', 'wait');
    hud.flashDraw(false);
  }

  function fireDraw(){
    state = DRAW; drawAtMs = performance.now();
    tenseUp(false);
    hud.setStatus('', 'draw'); hud.flashDraw(true);
    sfxDrawCall();
    camPunch = 1;
  }

  function resolve(won, foul){
    state = RESOLVE; resolveT = 0; playerWon = won;
    hud.flashDraw(false);
    tenseUp(false);
    doSlow(0.32, 0.6);
    if (foul){
      // drew too early — opponent guns you down
      drawAndFire(opp); shatter(player);
      hud.setStatus('TOO EARLY!', 'foul');
    } else if (won){
      drawAndFire(player); shatter(opp);
      wins += 1; duelIdx += 1;
      if (lastReaction > 0 && (best === 0 || lastReaction < best)){ best = lastReaction; writeBest(best); }
      hud.setWins(wins);
      hud.setStatus(Math.round(lastReaction * 1000) + ' ms', 'win');
      sfxWin();
    } else {
      drawAndFire(opp); shatter(player);
      hud.setStatus('OUT-DRAWN', 'lose');
    }
  }

  function reset(){
    duelIdx = 0; wins = 0;
    if (opp){ scene.remove(opp.root); opp = null; }
    scene.remove(player.root);
    player = buildFighter(ROSTER[Math.floor(Math.random()*ROSTER.length)], -1);
    setRestPose(player);
    camPunch = 0; slow = 0; timeScale = 1;
    hud.setDead(null); hud.setWins(0); hud.setBest(best);
    beginDuel();
    hud.setReady(true);
  }

  // input — a single tap is the whole game
  function onTap(){
    audioUnlock();
    if (state === SET){
      if (setT < LEAD_IN) return;          // tiny grace so a carried-over tap doesn't foul
      resolve(false, true);                // FOUL — drew before the signal
    } else if (state === DRAW){
      lastReaction = (performance.now() - drawAtMs) / 1000;
      resolve(lastReaction < oppReaction, false);
    }
  }

  function finalizeDeath(){
    state = DEAD;
    submitScore(wins);
    hud.setDead({ wins, best, killer: outlawName(duelIdx) });
  }
  function restart(){ audioUnlock(); sfxClick(); reset(); }

  // ── loop ──
  let last = performance.now(), idleClock = 0;
  function tick(now){
    requestAnimationFrame(tick);
    let dt = (now - last) / 1000; last = now; if (dt > 0.05) dt = 0.05;
    if (slow > 0){ slow -= dt; timeScale = slow > 0 ? slowAmt : 1; } else timeScale = 1;
    const gdt = dt * timeScale;
    camPunch = lerp(camPunch, 0, 6 * dt);
    idleClock += dt;

    sky.position.copy(camera.position);
    // dust drift
    const mp = motes.geometry.attributes.position;
    for (let i = 0; i < mp.count; i++){ let x = mp.getX(i) + dt*0.25; if (x > 10) x = -10; mp.setX(i, x); }
    mp.needsUpdate = true;

    // tense breathing idle for both fighters
    for (const f of [player, opp]){
      if (!f || f.fallen || !f.rig) continue;
      const b = Math.sin(idleClock * 2.2 + (f === opp ? 1.7 : 0)) * 0.5 + 0.5;
      f.model.position.y = (f._baseY || 0) + b * 0.015;
      if (state === SET || state === READY){ f.rig.armR.rotation.x = f.baseArmR + 0.05 + b * 0.04; }
    }

    if (state === SET){
      setT += gdt;
      if (setT >= setDelay) fireDraw();
    } else if (state === DRAW){
      // opponent reacts on its own clock — if the player hasn't fired in time, they lose
      if ((performance.now() - drawAtMs) / 1000 >= oppReaction){ lastReaction = 0; resolve(false, false); }
    } else if (state === RESOLVE){
      resolveT += dt;
      // fade the muzzle flashes
      for (const f of [player, opp]){ if (f && f.flash && f.flash.material.opacity > 0){ f.flash.material.opacity = Math.max(0, f.flash.material.opacity - dt * 6); f.flash.scale.multiplyScalar(1 + dt * 4); } }
      if (resolveT > 1.3){
        if (playerWon) beginDuel();
        else finalizeDeath();
      }
    }

    updateParticles(gdt);
    placeCamera();
    composer.render();
  }

  reset();
  requestAnimationFrame(tick);

  function submitScore(s){
    try { const A = window.Aigram; if (!A || !A.canRank) return;
      A.callAigramAPI('/note/aigram/ai/game/rank/score/save', 'POST', { session_id: A.gameUuid, score: Math.round(s) }).catch(()=>{});
    } catch(e){}
  }

  window.__qd = { get state(){ return state; }, get wins(){ return wins; }, get oppReaction(){ return oppReaction; }, tap: onTap, fireNow(){ if (state === SET) fireDraw(); } };
  return { onTap, restart };
}
