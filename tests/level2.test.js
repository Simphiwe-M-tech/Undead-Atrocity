import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Level2 } from '../src/levels/Level2.js';
import { LevelManager } from '../src/levels/LevelManager.js';
import { Player } from '../src/player/Player.js';
import { Game } from '../src/core/Game.js';
import { StoryUI } from '../src/ui/StoryUI.js';
import { BulletPool } from '../src/weapons/Bullet.js';
import { clearSegment } from '../src/enemies/PursuitMap.js';
import { withKitLoader } from './helpers/kit-loader.js';

const TestLevel2 = withKitLoader(Level2);

class Element {
  constructor() { this.style={}; this.children=new Map(); this.classList={add(){},remove(){},toggle(){}}; }
  appendChild() {}
  getContext() { return new Proxy({}, {get:()=>()=>{}}); }
  querySelector(id) { if(!this.children.has(id))this.children.set(id,new Element());return this.children.get(id); }
}
async function fixture() {
  globalThis.window={};
  const elements=new Map();
  globalThis.document={createElement:()=>new Element(),body:new Element(),exitPointerLock(){},
    getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);}};
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,1,0.1,100);
  const input={pointerLocked:true,mouseDeltaX:0,mouseDeltaY:0,flushMouseDelta(){},clearTransient(){},
    requestPointerLock(){},isDown:()=>false,isMouseButtonDown:()=>true,consumePress:()=>false};
  const level=new TestLevel2(scene);await level.load();
  const player=new Player(scene,input,camera);player.reset(level.spawnPoint);
  player.configureAmmo(level.ammoConfig);player.setCameraProfile(level.cameraProfile);player.setCollidableMeshes(level.wallMeshes);
  const game=Object.create(Game.prototype);
  Object.assign(game,{scene,camera,input,player,currentLevel:level,storyUI:new StoryUI(new Element()),
    STATE:{PLAYING:'playing',LOADING:'loading',GAMEOVER:'gameover',LEVELCOMPLETE:'levelcomplete'},state:'playing',
    bulletPool:new BulletPool(scene),raycaster:new THREE.Raycaster(),shootCooldown:0,shootRate:0.25,shootRange:80,
    hudEl:new Element(),keyIndicator:new Element(),levelTitleDisplay:new Element(),renderer:{domElement:{}},_showOverlay(){},_resetCombatHUD(){},
    _playGunshot(){this.shots=(this.shots||0)+1;}});
  const use=id=>{const item=level.items.find(i=>i.id===id);player.group.position.copy(item.position);return level.interact(player.group.position,player);};
  const tick=(seconds)=>{for(let t=0;t<seconds;t+=0.05)level.update(0.05,player,t);};
  const reveal=()=>{use('security-log');use('personal-note');use('breaker');tick(2.5);use('occupant-record');};
  const dispose=()=>{game.bulletPool.dispose();player.dispose();level.dispose();};
  return {scene,camera,input,level,player,game,use,tick,reveal,dispose};
}

test('residence initializes quietly with distinct rooms, bounded lights and pooled enemies',async()=>{
  const f=await fixture();const {level,player}=f;
  assert.equal(level.root.parent,f.scene);assert.equal(level.lamps.length,6);
  assert.equal(level.zombiePool.pool.pooledCount,32);assert.equal(level.zombiePool.activeCount,0);
  f.tick(4);assert.equal(level.zombiePool.activeCount,0);
  assert.equal(level.requiredCluesFound,0);assert.equal(player.ammoMag+player.ammoReserve,22);
  assert.ok(level.items.length>=8);assert.ok(level.wallMeshes.length>30);
  assert.equal(level.getNearbyInteraction(level.items.find(i=>i.id==='occupant-record').position,player),null);
  f.dispose();
});

test('ammo is consumed once per fired shot, zero prevents feedback, and E pickup is one-shot',async()=>{
  const f=await fixture();const {game,player,level,input}=f;
  player.update(0.016,level.obstacles);f.scene.updateMatrixWorld(true);
  player.configureAmmo({limited:true,mag:1,reserve:1});
  game._handleShooting(0);assert.equal(game.shots,1);assert.equal(player.ammoMag+player.ammoReserve,1);
  game._handleShooting(0.1);assert.equal(game.shots,1);
  game._handleShooting(0.25);assert.equal(game.shots,2);
  game._handleShooting(0.25);assert.equal(game.shots,2);
  assert.equal(game.storyUI.banner.querySelector('.story-banner-title').textContent,'OUT OF AMMO');
  game.storyUI.update(0.5);const messageTime=game.storyUI.bannerTimer;
  game._handleShooting(0.1);assert.equal(game.storyUI.bannerTimer,messageTime,'holding fire must not restart the message every frame');
  player.group.position.copy(level.items.find(i=>i.id==='supplies').position);
  input.consumePress=()=>true;game._handleInteraction();game._handleInteraction();
  assert.equal(player.ammoMag+player.ammoReserve,6);
  player.configureAmmo({limited:false});for(let i=0;i<30;i++)assert.equal(player.consumeAmmo(),true);
  f.dispose();
});

test('three clues gate blackout, progressive power restoration and delayed one-shot chase',async()=>{
  const f=await fixture();const {level,use,player}=f;
  assert.equal(use('personal-note'),null);assert.equal(use('breaker'),null);
  assert.equal(use('security-log').type,'evidence');assert.equal(use('security-log'),null);
  assert.equal(use('personal-note').type,'evidence');assert.equal(level.powerState,'blackout');
  level.update(0,player,0);assert.ok(level.roomAmbient.intensity>0);assert.equal(level.lamps[0].intensity,0.1);
  assert.equal(use('occupant-record'),null);assert.equal(use('breaker').type,'breaker');
  level.update(0.2,player,0.2);assert.equal(level.lamps[0].intensity,5);assert.equal(level.lamps[5].intensity,0.1);
  f.tick(2.5);assert.equal(level.powerState,'restored');assert.equal(use('breaker'),null);
  assert.equal(use('occupant-record').type,'evidence');assert.equal(use('occupant-record'),null);
  assert.equal(level.requiredCluesFound,3);assert.equal(level.checkpointReady,true);
  assert.equal(level.chaseState,'warning');f.tick(5);assert.equal(level.chaseState,'warning');
  const events=[];for(let i=0;i<15;i++)events.push(...level.update(0.05,player,6).storyEvents);
  assert.equal(level.chaseState,'running');assert.equal(events.filter(e=>e.text==='Run.').length,1);
  assert.equal(level.encounterStats.get('residence-chase').requested,30);
  assert.ok(level.encounterStats.get('residence-chase').spawned<30);
  f.dispose();
});

test('checkpoint retries clear combat and UI without duplicating residence or pickups',async()=>{
  const f=await fixture();f.reveal();const {level,player,game,scene}=f;
  const rootCount=level.root.children.length,sceneCount=scene.children.length;
  for(let retry=0;retry<3;retry++) {
    f.tick(14);level._spawnCarrier();player.health=0;player.alive=false;player.hasKey=true;
    level._setDoor('shortcut',true);game.shootCooldown=1;
    game.bulletPool.fire(new THREE.Vector3(),new THREE.Vector3(0,0,-50));
    game.storyUI.showMessage('UNKNOWN','stale');game.storyUI.showMessage('UNKNOWN','stale queued');
    game.state='gameover';game.retryCheckpoint();
    assert.equal(player.health,100);assert.equal(player.hasKey,false);assert.equal(player.ammoMag+player.ammoReserve,24);
    assert.equal(level.powerState,'restored');assert.equal(level.chaseState,'warning');assert.equal(level.requiredCluesFound,3);
    assert.equal(level.zombiePool.activeCount,0);assert.equal(level.janitorZombie,null);
    assert.equal(level.root.children.length,rootCount);assert.equal(scene.children.length,sceneCount);
    assert.equal(level.doors.get('shortcut').open,false);assert.equal(game.storyUI.messageQueue.length,0);
    assert.equal(game.bulletPool.pool.activeCount,0);assert.equal(game.shootCooldown,0);
    assert.equal(game.state,'playing');assert.equal(level.restoreCheckpoint(player),true);
  }
  f.dispose();
});

test('carrier spawns safely, survives chains, drops one E key and unlocks one final exit',async()=>{
  const f=await fixture();f.reveal();const {level,player}=f;
  level._startChase();player.group.position.set(-10,0,-26);level.lastPlayerPosition.copy(player.group.position);
  level._spawnCarrier();const carrier=level.janitorZombie;
  assert.equal(carrier.kitModel.model.userData.kitAsset,'Giant');
  assert.ok(carrier.group.position.distanceTo(player.group.position)>=8);
  const regular=level.zombiePool.spawn(carrier.group.position);regular.takeDamage(level.explosionPool);
  level.handleZombieKilled(regular,carrier.group.position);assert.equal(carrier.alive,true);
  player.group.position.copy(level.exitDoorPosition);assert.equal(level.interact(player.group.position,player),null);
  assert.equal(level.doors.get('lower-exit').open,false);
  assert.equal(carrier.takeDamage(level.explosionPool).killed,true);
  level.handleZombieKilled(carrier,carrier.group.position);const key=level.keyMesh;
  level.handleZombieKilled(carrier,carrier.group.position);assert.equal(level.keyMesh,key);
  player.group.position.copy(key.position).setY(0);
  assert.equal(level.interact(player.group.position,player).type,'key');assert.equal(player.hasKey,true);
  assert.equal(level.update(0,player,0).keyCollected,true);assert.equal(level.update(0,player,0).keyCollected,false);
  player.group.position.copy(level.exitDoorPosition);assert.equal(level.interact(player.group.position,player).levelComplete,true);
  assert.equal(level.interact(player.group.position,player),null);
  assert.equal(level.update(0,player,0).levelComplete,true);assert.equal(level.update(0,player,0).levelComplete,false);
  assert.equal(level.encounterQueue.length,0);f.dispose();
});

test('Level 1 exit advances through the real manager; Level 2 completion stops before Level 3',async()=>{
  const f=await fixture();const {game,player,scene}=f;
  const manager=new LevelManager(scene);let disposed=0;
  const getClass=manager._getLevelClass.bind(manager);
  manager._getLevelClass=index=>index===1?TestLevel2:getClass(index);
  manager.currentLevel={dispose(){disposed++;}};manager.currentLevelIndex=0;
  game.levelManager=manager;player.score=2400;player.health=63;player.hasKey=true;player.isDodging=true;
  game._onLevelComplete();assert.equal(game.pendingAdvanceLevel,true);
  await game._advanceToNextLevel();
  assert.equal(disposed,1);assert.ok(game.currentLevel instanceof Level2);assert.equal(manager.currentLevelIndex,1);
  assert.equal(player.score,2400);assert.equal(player.health,63);assert.equal(player.hasKey,false);assert.equal(player.isDodging,false);
  assert.equal(player.limitedAmmo,true);assert.equal(game.state,'playing');
  game._onLevelComplete();assert.equal(game.pendingAdvanceLevel,false);
  game.showLevelComplete();assert.equal(game.state,'levelcomplete');assert.match(document.getElementById('levelcomplete-text').textContent,/Level 3 is not available/);
  assert.equal(await manager.nextLevel(),null);game.currentLevel.dispose();f.dispose();
});

test('both escape routes and all room entrances connect through the unchanged pursuit map',async()=>{
  const f=await fixture();const {level}=f;
  const target=new THREE.Vector3(0,0,-30);level.navigation.update(0,target);
  const nav=level.navigation;
  for(const [x,z] of [[0,30],[-10,18],[-11,6],[-11,-10],[-10,-26],[8,-10],[16,-10],[16,18],[8,4],[-11,28],[22,-8]]) {
    const index=Math.round(z-nav.minZ)*nav.width+Math.round(x-nav.minX);
    assert.ok(nav.distance[index]>=0,`unreachable room (${x}, ${z})`);
  }
  // Two independent corridor legs reconnect north and south of the records room.
  for(const route of [[[0,-16],[0,-28]],[[16,-16],[16,-28],[0,-28]]]) {
    for(let i=1;i<route.length;i++)assert.equal(clearSegment(...route[i-1],...route[i],level.obstacles,0.6),true);
  }
  for(const start of [new THREE.Vector3(-11,0,-10),new THREE.Vector3(8,0,-10),new THREE.Vector3(16,0,18)]) {
    const zombie=level.zombiePool.spawn(start,{speed:2});let hit=false;
    for(let i=0;i<1500;i++){nav.update(0.05,target);hit ||= zombie.update(0.05,target,level.obstacles,nav,[zombie]).hit;}
    assert.ok(hit,`pursuit failed from ${start.toArray()}`);level.zombiePool.release(zombie);
  }
  f.dispose();
});

test('indoor camera pulls before a wall immediately and first-person stays at the player',async()=>{
  const f=await fixture();const {player,camera,scene}=f;
  player.group.position.set(0,0,31);scene.updateMatrixWorld(true);
  player.update(0.016,f.level.obstacles);
  assert.ok(camera.position.z<32.8,`camera behind entry door: ${camera.position.z}`);
  player.toggleCamera();player.update(0.016,f.level.obstacles);
  assert.ok(camera.position.distanceTo(player.group.position)<2);f.dispose();
});

test('opening the monitored record pauses the chase clock until evidence is closed',async()=>{
  const f=await fixture();f.use('security-log');f.use('personal-note');f.use('breaker');f.tick(2.5);
  const {game,player,level,input}=f;
  player.group.position.copy(level.items.find(i=>i.id==='occupant-record').position);
  globalThis.requestAnimationFrame=()=>{};
  game.clock={getDelta:()=>0.05};game.elapsedTime=0;game.pendingLevelCompleteTimer=0;
  game._updateHUD=()=>{};game.renderer.render=()=>{};input.endFrame=()=>{};
  let pressed=true;input.consumePress=code=>code==='KeyE'&&pressed?(pressed=false,true):false;
  game._animate();assert.equal(game.storyUI.isEvidenceOpen,true);assert.equal(level.chaseState,'warning');
  const time=level.storyClock;
  for(let i=0;i<200;i++)game._animate();
  assert.equal(level.storyClock,time);assert.equal(level.chaseTimer,0);
  pressed=true;game._animate();assert.equal(game.storyUI.isEvidenceOpen,false);
  game._animate();assert.ok(level.chaseTimer>0);f.dispose();
});

test('interior sound repeats reuse PCM and gain with bounded samples and independent tails',()=>{
  let buffers=0,gains=0,plays=0;const sources=[];
  class AudioContext {
    constructor(){this.state='running';this.sampleRate=8000;this.destination={};}
    createBuffer(channels,length){buffers++;const data=new Float32Array(length);return {getChannelData:()=>data};}
    createGain(){gains++;return {gain:{value:1},connect(){}};}
    createBufferSource(){const source={connect(){},disconnect(){},start(){plays++;}};sources.push(source);return source;}
  }
  globalThis.window={AudioContext};const game=Object.create(Game.prototype);
  game._playInteriorSound('bang');game._playInteriorSound('bang');
  assert.equal(buffers,1);assert.equal(gains,1);assert.equal(plays,2);
  assert.equal(sources[0].buffer,sources[1].buffer);assert.notEqual(sources[0],sources[1]);
  assert.ok(sources[0].buffer.getChannelData(0).every(v=>Math.abs(v)<0.2));
});

test('critical-path ammunition is fixed, reachable and collectible once; optional rewards remain',async()=>{
  const f=await fixture();const {level,player,game,input}=f;
  const pickups=[['security-ammo',8],['electrical-ammo',6],['records-ammo',18]];
  player.configureAmmo({limited:true,mag:0,reserve:0});input.consumePress=()=>true;
  for(const [id,amount] of pickups) {
    const item=level.items.find(i=>i.id===id);
    assert.equal(item.mesh.visible,true);assert.equal(item.criticalAmmo,true);
    assert.equal(clearSegment(item.position.x,item.position.z,item.position.x,item.position.z,level.obstacles,0.6),true);
    level.navigation.update(1,item.position);assert.ok(level.navigation.target>=0);
    player.group.position.copy(item.position);
    const before=player.ammoMag+player.ammoReserve;
    game._handleInteraction();assert.equal(player.ammoMag+player.ammoReserve,before+amount);
    game._handleInteraction();assert.equal(player.ammoMag+player.ammoReserve,before+amount);
  }
  assert.equal(level.chaseState,'quiet');assert.equal(level.requiredCluesFound,0);
  assert.equal(player.ammoMag+player.ammoReserve,32);
  assert.deepEqual(['supplies','store-ammo','side-ammo'].map(id=>level.items.find(i=>i.id===id).amount),[6,8,6]);
  const late=level.items.find(i=>i.id==='last-rounds');assert.equal(late.mesh.visible,false);
  level._startChase();level._spawnCarrier();assert.equal(late.mesh.visible,true);assert.equal(late.amount,6);
  f.dispose();
});

test('emergency reserve cannot be wasted on misses, walls or regular infected and kills the carrier once',async()=>{
  const f=await fixture();f.reveal();const {level,player,game,input,scene,camera}=f;
  level._startChase();level._spawnCarrier();const carrier=level.janitorZombie;
  player.configureAmmo({limited:true,mag:0,reserve:0});input.consumePress=()=>true;
  player.group.position.copy(level.items.find(i=>i.id==='last-rounds').position);
  game._handleInteraction();game._handleInteraction();
  assert.equal(player.ammoMag+player.ammoReserve,6);assert.equal(level.carrierAmmoReserve,1);
  player.group.position.set(0,0,-20);player.toggleCamera();player.update(0.016,level.obstacles);
  carrier.group.position.set(0,0,-26);level.zombies=[carrier];scene.updateMatrixWorld(true);
  camera.lookAt(0,100,-20);
  for(let i=0;i<9;i++)game._handleShooting(0.25);
  assert.equal(game.shots,6);assert.equal(player.ammoMag+player.ammoReserve,0);
  assert.equal(level.carrierAmmoReserve,1);assert.equal(carrier.alive,true);
  assert.match(game.storyUI.banner.querySelector('.story-banner-subtitle').textContent,/Aim directly/);
  camera.lookAt(0,1.4,-26);
  const regular=level.zombiePool.spawn(new THREE.Vector3(0,0,-23));level.zombies.push(regular);scene.updateMatrixWorld(true);
  game._handleShooting(0.25);assert.equal(regular.alive,true);assert.equal(level.carrierAmmoReserve,1);
  level.zombiePool.release(regular);
  const wall=new THREE.Mesh(new THREE.BoxGeometry(2,4,0.1),new THREE.MeshBasicMaterial());
  wall.position.set(0,2,-23);scene.add(wall);level.wallMeshes.push(wall);scene.updateMatrixWorld(true);
  game._handleShooting(0.25);assert.equal(carrier.alive,true);assert.equal(level.carrierAmmoReserve,1);
  level.wallMeshes.pop();scene.remove(wall);wall.geometry.dispose();wall.material.dispose();
  game._handleShooting(0.25);
  assert.equal(game.shots,7);assert.equal(carrier.alive,false);assert.equal(level.carrierAmmoReserve,0);assert.ok(level.keyMesh);
  game._handleShooting(0.25);assert.equal(game.shots,7,'reserve is finite');
  player.group.position.copy(level.keyMesh.position).setY(0);game._handleInteraction();
  assert.equal(player.hasKey,true);
  player.group.position.copy(level.exitDoorPosition);
  assert.equal(level.interact(player.group.position,player).levelComplete,true,'exit needs no more ammunition');
  level.restoreCheckpoint(player);
  assert.equal(level.carrierAmmoReserve,0);assert.equal(player.ammoMag+player.ammoReserve,24);
  assert.equal(level._found('last-rounds'),false,'new attempt restores the uncollected emergency cache');
  f.dispose();
});

test('full-route finite ammo budget covers all encounters without requiring optional supplies or chain kills',async()=>{
  const f=await fixture();const {level}=f;
  f.reveal();level._startChase();level._startEncounter('store-risk',3,[1,3],3,1,1.65);
  const regularBudget=[...level.encounterStats.values()].reduce((sum,stats)=>sum+stats.requested,0);
  assert.equal(regularBudget,50);
  const guaranteed=level.items.filter(i=>i.criticalAmmo).reduce((sum,item)=>sum+item.amount,22);
  const optional=level.items.filter(i=>i.type==='ammo'&&!i.criticalAmmo).reduce((sum,item)=>sum+item.amount,0);
  assert.equal(guaranteed,60);assert.equal(optional,20);
  assert.ok(guaranteed>=regularBudget+1+9,'nine misses remain affordable even without chains or optional caches');
  f.dispose();
});
