import * as THREE from 'three';
import { Level1 } from './Level1.js';
import { Zombie } from '../enemies/Zombie.js';
import { ZombiePool } from '../enemies/ZombiePool.js';
import { ExplosionPool } from '../effects/ExplosionPool.js';

/** Residence mission. Inherits only the existing pooled encounter scheduler,
 * terrain navigation, event queue and key visual; builds its own world/story.
 */
export class Level2 extends Level1 {
  constructor(scene) {
    super(scene);
    this.mazeWidth = 25; this.mazeHeight = 37;
    this.ammoConfig = { limited: true, mag: 10, reserve: 12, magSize: 10 };
    this.carrierAmmoReserve = 0;
    this.cameraProfile = 'indoor';
    this.objective = 'Find the residence security desk. Follow the blue signs.';
    this.totalRequiredClues = 3;
    this.items = [];
    this.doors = new Map();
    this.lamps = [];
    this.powerState = 'normal';
    this.powerRestoreTime = 0;
    this.checkpointReady = false;
    this.chaseState = 'quiet';
    this.chaseTimer = 0;
    this.carrierSpawned = false;
    this.carrierKilled = false;
    this._completionPending = false;
    this._keyPending = false;
    this.carrierEntryPoints = [[-10,-26],[-16,-24],[16,-26],[0,-28]].map(([x,z])=>new THREE.Vector3(x,0,z));
    this.ambientTimer = 5;
    this.ambientCue = 0;
    this.zonesVisited = new Set();
    this.root = new THREE.Group();
    this.root.name = 'ResidenceLevel2';
    this._geometries = new Set(); this._materials = new Set();
    this._box = new THREE.BoxGeometry(1, 1, 1);
    this._geometries.add(this._box);
    this._checkpoint = null;
  }

  get title() { return 'LEVEL 2 — DOWN THE STAIRS'; }
  get spawnPoint() { return new THREE.Vector3(0, 0, 30); }

  async load(onProgress) {
    this.scene.add(this.root);
    this._buildResidence(); onProgress?.(0.4);
    this._dressResidence(); this._buildStory(); onProgress?.(0.7);
    await this._loadZombieModels();
    this.zombiePool = new ZombiePool(this.scene, 32, this.zombieModels);
    this.explosionPool = new ExplosionPool(this.scene, 12);
    this.encounterSpawnPoints = [
      [-12, 28], [-14, 18], [-14, 6], [8, 4], [16, 18],
      [22, -10], [-14, -10], [-12, -26], [16, -26], [0, -18]
    ].map(([x, z]) => new THREE.Vector3(x, 0, z));
    this._createPursuitMap(); onProgress?.(1);
  }

  _material(color, emissive = 0) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.83, metalness: 0.08,
      emissive, emissiveIntensity: emissive ? 0.7 : 0 });
    this._materials.add(mat); return mat;
  }

  _mesh(x, y, z, sx, sy, sz, mat, solid = false, parent = this.root) {
    const mesh = new THREE.Mesh(this._box, mat);
    mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
    mesh.receiveShadow = true; parent.add(mesh);
    if (solid) {
      const obstacle = { x, z, halfX: sx / 2, halfZ: sz / 2, radius: Math.max(sx, sz) / 2,
        height: y + sy / 2, climbable: false };
      this.obstacles.push(obstacle); this.wallMeshes.push(mesh); mesh.userData.obstacle = obstacle;
    }
    return mesh;
  }

  _buildResidence() {
    this.maze = Array.from({ length: 37 }, () => Array(25).fill('#'));
    const carve = (x1, z1, x2, z2) => {
      for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) this.maze[z][x] = '.';
    };
    carve(11, 2, 13, 34); // main corridor: blue route
    carve(19, 4, 21, 29); // east corridor: amber route
    carve(11, 9, 21, 11); carve(11, 25, 21, 27); carve(11, 3, 21, 5);
    carve(10, 30, 14, 35); // concrete stair landing
    for (const [z1, z2, door] of [[26,29,27],[18,23,21],[10,15,13],[3,7,5]]) {
      carve(3, z1, 9, z2); carve(10, door, 10, door);
    }
    carve(4,31,8,34); carve(9,32,9,32); // risky storeroom
    carve(15,17,17,23); carve(14,20,14,20); carve(18,20,18,20); // common-room loop
    carve(15,12,17,15); carve(18,13,18,13); carve(14,13,14,13); // records / powered shortcut
    carve(22,26,23,29); // bathrooms off east corridor
    carve(23,12,23,15); carve(22,13,22,13); // empty laundry room
    const wall = this._material(0x788384), concrete = this._material(0x535f66);
    this.floorMat = this._material(0x303c44);
    const tiles=document.createElement('canvas');tiles.width=256;tiles.height=256;
    const tile=tiles.getContext('2d');tile.fillStyle='#b2bdc3';tile.fillRect(0,0,256,256);
    tile.fillStyle='#9faab0';tile.fillRect(0,0,128,128);tile.fillRect(128,128,128,128);
    tile.fillStyle='#647077';tile.fillRect(0,0,256,2);tile.fillRect(0,0,2,256);
    tile.fillRect(128,0,2,256);tile.fillRect(0,128,256,2);
    const tileMap=new THREE.CanvasTexture(tiles);tileMap.colorSpace=THREE.SRGBColorSpace;
    tileMap.wrapS=tileMap.wrapT=THREE.RepeatWrapping;tileMap.repeat.set(12.5,18.5);this.floorMat.map=tileMap;
    this._mesh(0,-0.12,0,50,0.24,74,this.floorMat);
    this._mesh(0,3.55,0,50,0.18,74,this._material(0x566068));
    // Merge solid tile runs into boxes. Matches exact player/enemy footprints.
    for (let row = 0; row < 37; row++) for (let col = 0; col < 25;) {
      if (this.maze[row][col] !== '#') { col++; continue; }
      const start = col;
      while (col < 25 && this.maze[row][col] === '#') col++;
      const a = this._cellToWorld(start, row), b = this._cellToWorld(col - 1, row);
      this._mesh((a.x+b.x)/2,1.7,a.z,(col-start)*2,3.4,2, row > 29 ? concrete : wall, true);
    }
    // Repeating skirting shares one draw call across the residence.
    const trim=new THREE.InstancedMesh(this._box,this._material(0x24313b),this.wallMeshes.length*2);
    const transform=new THREE.Object3D();let trimIndex=0;
    for(const wallMesh of this.wallMeshes)for(const side of [-1,1]) {
      transform.position.set(wallMesh.position.x,0.12,wallMesh.position.z+side*1.015);
      transform.scale.set(wallMesh.scale.x,0.24,0.04);transform.updateMatrix();trim.setMatrixAt(trimIndex++,transform.matrix);
    }
    this.root.add(trim);
    this._door('shortcut',4,-10,'x',false);
    this._door('lower-exit',0,-33,'z',false);
    this._door('entry',0,33,'z',false);
    for (const z of [-33,33]) for (const x of [-2.2,2.2])
      this._mesh(x,1.7,z,1.6,3.4,0.24,concrete,true);
    this.exitDoorPosition = new THREE.Vector3(0,0,-31);
    const ambient = new THREE.HemisphereLight(0xc7d8df,0x303c48,1.4);
    this.root.add(ambient); this.roomAmbient = ambient;
    this.scene.background = new THREE.Color(0x090d13);
    this.scene.fog = new THREE.Fog(0x111820,28,65);
    for (const [x,z,color] of [[0,28,0xb8d4ff],[0,14,0xbad6dc],[0,-8,0xbad6dc],[0,-26,0xffbe6b],[16,-16,0xffda9c],[8,4,0xffc889]]) {
      const light = new THREE.PointLight(color,5,19,1.3); light.position.set(x,2.9,z);
      this.root.add(light); this.lamps.push(light);
      const fixture = this._mesh(x,3.35,z,1.5,0.08,0.24,this._material(0xd1dfdf,0xb6d7df));
      light.userData.fixture = fixture.material;
    }
    this.emergency = new THREE.PointLight(0xff3535,0.4,22,1.2);
    this.emergency.position.set(8,2.7,-16); this.root.add(this.emergency);
    const emergencyMat=this._material(0x9c2424,0xff2424);
    for(const z of [22,6,-10,-24])this._mesh(2.9,2.75,z,0.08,0.22,0.35,emergencyMat);
  }

  _door(id,x,z,axis,open) {
    const mesh = this._mesh(x,1.4,z,axis==='x'?0.18:2.8,2.8,axis==='x'?2:0.18,this._material(0x334c59),true);
    const door = { id, mesh, position: new THREE.Vector3(x,0,z), obstacle: mesh.userData.obstacle, open: false, x, z, axis };
    this.doors.set(id,door); if (open) this._setDoor(id,true); return door;
  }

  _setDoor(id,open) {
    const door = this.doors.get(id); if (!door || door.open === open) return;
    door.open = open;
    // Sliding leaf retracts into its frame; arrays are mutated in place because
    // player, raycaster and pursuit map all share them.
    door.mesh.visible = !open;
    for (const [array,item] of [[this.obstacles,door.obstacle],[this.wallMeshes,door.mesh]]) {
      const i = array.indexOf(item);
      if (open && i >= 0) array.splice(i,1);
      else if (!open && i < 0) array.push(item);
    }
    this.navigation?.rebuild();
  }

  _sign(text,x,z,color='#a5d7e5',rotation=0,y=2.35,width=3) {
    const canvas = document.createElement('canvas'); canvas.width=512; canvas.height=128;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='#15212c'; ctx.fillRect(0,0,512,128);
    ctx.fillStyle=color; ctx.fillRect(0,0,10,128); ctx.font='bold 28px sans-serif';
    ctx.fillText(text,24,75,465);
    const texture=new THREE.CanvasTexture(canvas); texture.colorSpace=THREE.SRGBColorSpace;
    const mat=new THREE.MeshBasicMaterial({map:texture}); this._materials.add(mat);
    const mesh=this._mesh(x,y,z,width,0.75,0.04,mat); mesh.rotation.y=rotation; return mesh;
  }

  _dressResidence() {
    const wood=this._material(0x625045), blue=this._material(0x274657), metal=this._material(0x555e61);
    const red=this._material(0x9b282c), fabric=this._material(0x394859), paper=this._material(0xd0c2a6);
    // Stair flights behind the entry landing; playable landing stays level.
    for(let i=0;i<6;i++) this._mesh(-3,0.1+i*0.15,31+i*0.32,1.4,0.2+i*0.3,0.35,metal,true);
    this._mesh(-4,1.4,32,0.08,0.08,3,metal); this._mesh(-2,1.4,32,0.08,0.08,3,metal);
    for(const z of [30.7,32.8]) for(const x of [-4,-2]) this._mesh(x,0.7,z,0.06,1.4,0.06,metal);
    this._sign('FLOOR 02 / RESIDENCE',0,32.8);
    this._sign('SECURITY  ↑    ROOMS 201–204',0,23.5);
    this._sign('LOWER STAIRS  ↑   MAIN ROUTE',0,-16.8,'#8de3b4');
    this._sign('EAST ROUTE  ↑   LOWER STAIRS',16,-25,'#e7b975');
    this._sign('LOWER STAIRWELL / KEY ACCESS',0,-32.85,'#8de3b4');
    this._sign('COMMON ROOM / EAST ROUTE  →',0,5.7,'#e7b975');
    this._sign('ELECTRICAL  ←   KEEP CLEAR',0,-25.5,'#e7b975');
    for(const [text,z] of [['201 / SUPPLIES',18],['SECURITY / ACCESS LOG',6],['203 / YOUR ROOM',-10],['204 / ELECTRICAL',-26]])
      this._sign(text,-4.98,z,'#a5d7e5',Math.PI/2,2.4,3.2);
    this._sign('RECORDS / AUTHORISED ACCESS',11,-10,'#e7b975',Math.PI/2);
    this._sign('BATHROOMS',19.5,20,'#a5d7e5');
    this._sign('LAUNDRY / NO EXIT',22,-8,'#a5d7e5');
    this._sign('FIRE DOORS: DO NOT OBSTRUCT',2.7,29,'#f4ba8c',Math.PI/2);
    // Student bedroom, searched desk and academic material.
    for(const z of [18,-10]) {
      this._mesh(-15,0.3,z+2,2.5,0.6,3.6,wood,true);
      this._mesh(-15,0.66,z+2,2.4,0.12,3.5,fabric);
      this._mesh(-16,0.8,z-2,2,0.12,1.4,wood,true);
      for(let i=0;i<4;i++) this._mesh(-16+i*0.3,0.94,z-2,0.22,0.14,0.6,i%2?paper:blue);
    }
    this._mesh(-13,0.93,-12,1,0.08,0.7,metal); // laptop thrown off the desk
    this._sign('ACADEMIC MERIT / PROJECT EXHIBITION',-15,-13.7,'#e7b975',0,2.4,4.5);
    this._sign('MON / LAB   TUE / DESIGN   WED / SEMINAR',-10,-13.7,'#a5d7e5',0,1.8,3.7);
    for(let i=0;i<4;i++) this._mesh(-10+i*0.35,0.025,-9+i*0.35,0.4,0.025,0.6,paper);
    // Noticeboards, photos, bags, laundry and a broken chair tell the panic.
    this._sign('RESIDENCE NOTICES / STUDY GROUP 18:00',1.95,19,'#d6c0a0',Math.PI/2,1.8,3);
    for(const [x,z] of [[-8,18],[1,22],[18,14],[-12,28]]) {
      this._mesh(x,0.24,z,0.6,0.48,0.7,fabric,true);
      this._mesh(x,0.51,z,0.3,0.04,0.5,metal);
    }
    this._mesh(22,0.3,-12.1,0.9,0.6,1.2,blue,true);
    this._mesh(22,0.66,-12.1,0.8,0.12,1.1,paper);
    this._mesh(7,0.4,8,1.4,0.8,0.8,wood,true).rotation.z=0.25;
    // Common room: furniture remains at the edges of the through route.
    this._mesh(8,0.55,7,2.2,1.1,1.2,wood,true);
    this._mesh(7,0.4,0,1.5,0.8,1,blue,true);
    this._mesh(9,1.1,0,1,2.2,0.8,blue,true);
    this._sign('DRINKS / OUT OF SERVICE',9,-0.45,'#e7b975',0,1.7,0.9);
    this._mesh(6,0.48,0,1.7,0.95,0.8,metal,true); // kitchenette counter
    this._mesh(6,0.98,0,0.65,0.04,0.5,this._material(0x22282a));
    for(const z of [18,21]) {
      this._mesh(22,0.4,z,0.7,0.8,0.8,paper,true); // bathroom sinks
      this._mesh(22,1.65,z-0.5,1,0.8,0.05,metal);
    }
    for(const [x,z] of [[2.6,28],[-5,6],[18.8,-16]]) this._mesh(x,1,z,0.22,0.7,0.22,red);
    for(const x of [-16,-14,-12]) {
      this._mesh(x,1.45,-29,0.08,2.9,0.08,metal);
      this._mesh(x,1.4,-28.5,0.8,1.5,0.35,blue,true);
    }
    this._mesh(-15,0.8,6,3,1.6,1.2,wood,true); // security desk
    this._mesh(8,0.8,-12,2.5,1.6,1,metal,true); // records terminal
    const blood=this._material(0x491c23);
    for(const [x,z] of [[0,22],[-2,18],[-7,8],[-11,6],[16,-2],[16,-12]])
      this._mesh(x,0.015,z,0.45,0.025,1.2,blood);
    this._mesh(-11,0.18,8,0.7,0.36,1.7,blue); // abandoned security uniform
  }

  _item(id,type,x,z,label,extra={}) {
    const mat=this._material(type==='ammo'?0xb99a42:0x568f9f,type==='ammo'?0x5c4006:0x124653);
    const mesh=this._mesh(x,0.95,z,0.35,0.18,0.4,mat);
    const item={id,type,position:new THREE.Vector3(x,0,z),mesh,label,collected:false,...extra};
    this.items.push(item); return item;
  }

  _buildStory() {
    this._item('security-log','evidence',-13,6,'E — Inspect Access Log',{
      title:'SECURITY ACCESS LOG',eyebrow:'RESIDENCE CONTROL / 23:41–23:51',
      body:['23:41 — West service entrance: MANUAL OVERRIDE.','23:44 — Fire doors: SAFETY LOCK DISABLED.',
        '23:47 — Cameras: REMOTE ACCESS.','23:51 — Rooftop access: LOCKED.'],
      insight:'The same remote session opened the service route and sealed the roof. Someone locked us in.'});
    this._item('personal-note','evidence',-11,-10,'E — Inspect Photograph',{
      title:'ALWAYS FIRST.',eyebrow:'ROOM 203 / A SEARCHED DESK',
      body:['Your project exhibition photograph is face down on the desk.','A fresh note on the back reads: “Always first.”',
        'Your timetable has been marked in someone else’s handwriting.'],insight:'This person knows me. They were inside my room.'});
    this._item('occupant-record','evidence',8,-10,'E — Inspect Occupant Record',{
      title:'ROOM 203 — PRIORITY SUBJECT',eyebrow:'RESTRICTED / MOVEMENT HISTORY',
      body:['Room access, lecture times, rooftop entry: your movements were logged.',
        'Only your record carries a live-tracking flag.','A handwritten instruction: KEEP HER ON THE ROOF.'],
      insight:'The building was trapped deliberately. I was being watched before the outbreak.'});
    this._item('breaker','breaker',-10,-26,'E — Restore Power');
    this._item('supplies','ammo',-10,18,'E — Collect Ammo',{amount:6});
    this._item('store-ammo','ammo',-12,28,'E — Collect Ammo',{amount:8});
    this._item('side-ammo','ammo',22,-10,'E — Collect Ammo',{amount:6});
    this._item('security-ammo','ammo',-7,6,'E — Collect Security Ammo (+8)',{amount:8,criticalAmmo:true});
    this._item('electrical-ammo','ammo',-7,-26,'E — Collect Maintenance Ammo (+6)',{amount:6,criticalAmmo:true});
    this._item('records-ammo','ammo',10,-8,'E — Collect Escape Supplies (+18)',{amount:18,criticalAmmo:true});
    this._item('first-aid','health',-8,20,'E — Use First Aid',{amount:30});
    this._item('last-rounds','ammo',1,-29,'E — Collect Emergency Ammo (+6 / 1 carrier reserve)',
      {amount:6,late:true,criticalAmmo:true,carrierRound:true});
    this._sign('ESCAPE SUPPLIES / AMMUNITION',10,-7.5,'#e7b975',0,1.9,2);
    this._sign('EMERGENCY AMMO / KEEP ONE FOR THE KEY',1,-29.5,'#e7b975',0,1.9,2.5);
    this.items.find(i=>i.late).mesh.visible=false;
  }

  _objective(text) { this.objective=text; this._queueEvent({type:'objective',text}); }
  _found(id) { return this.items.find(i=>i.id===id)?.collected; }

  getNearbyInteraction(position,player) {
    if(this.levelComplete) return null;
    let best=null, distance=2.2;
    const consider=(id,label,target)=>{const d=position.distanceTo(target);if(d<distance){distance=d;best={id,label};}};
    for(const item of this.items) {
      if(item.collected || !item.mesh.visible) continue;
      if(item.id==='personal-note'&&!this._found('security-log')) continue;
      if(item.id==='occupant-record'&&this.powerState!=='restored') continue;
      if(item.type==='breaker'&&this.powerState!=='blackout') continue;
      consider(item.id,item.label,item.position);
    }
    const shortcut=this.doors.get('shortcut');
    if(!shortcut.open && this.powerState==='restored') consider('shortcut','E — Open Shortcut',shortcut.position);
    if(this.keyMesh&&!this.keyCollected) consider('key','E — Collect Lower Stairwell Key',this.keyMesh.position);
    if(this.chaseState==='running') consider('lower-exit',player?.hasKey?'E — Unlock Lower Stairwell':'E — Check Locked Stairwell',this.exitDoorPosition);
    return best;
  }

  interact(position,player) {
    this.lastPlayerPosition.copy(position);
    const nearby=this.getNearbyInteraction(position,player); if(!nearby) return null;
    if(nearby.id==='shortcut') {this._setDoor('shortcut',true);this._queueEvent({type:'sound',id:'slam'});return {type:'door'};}
    if(nearby.id==='key') {
      this.keyCollected=true;this._keyPending=true;player.hasKey=true;this.keyMesh.visible=false;
      this._objective('Reach the lower stairwell. Use the key and keep moving.');return {type:'key'};
    }
    if(nearby.id==='lower-exit') {
      if(!player?.hasKey) {
        if(!this.exitDiscovered) {this.exitDiscovered=true;this._queueEvent({type:'banner',title:'LOWER STAIRWELL LOCKED',subtitle:'Intercept the infected carrying the red key tag.'});}
        return null;
      }
      this._setDoor('lower-exit',true);this.levelComplete=true;this._completionPending=true;this._cancelPendingEncounters();
      this._queueEvent({type:'levelOutro',title:'LEVEL 2 COMPLETE',subtitle:'Below the residence — Level 3 to be continued.'});
      this._queueEvent({type:'sound',id:'slam'});return {type:'door',levelComplete:true};
    }
    const item=this.items.find(i=>i.id===nearby.id);
    if(item.type==='breaker') {
      item.collected=true;this.powerState='restoring';this.powerRestoreTime=0;
      this._queueEvent({type:'sound',id:'breaker'});this._objective('Emergency circuits restarting. Reach the records office via the east corridor.');
      return {type:'breaker'};
    }
    item.collected=true;item.mesh.visible=false;
    if(item.type==='ammo') {
      if(item.carrierRound && !this.carrierKilled) this.carrierAmmoReserve=1;
      return {type:'ammo',amount:item.amount,carrierRound:item.carrierRound && !this.carrierKilled};
    }
    if(item.type==='health') {player.heal(item.amount);return {type:'health'};}
    this.requiredCluesFound++;
    if(item.id==='security-log') {
      this._objective('Check your room: 203. Someone manipulated the residence systems.');
      this._queueEvent({type:'dialogue',speaker:'YOU',text:"This wasn't an accident. Someone locked us in."});
      this._queueEvent({type:'message',sender:'UNKNOWN',text:"I was wondering when you'd notice."});
      this._startEncounter('security-search',6,[1,3,4],3,2,1.65);
    } else if(item.id==='personal-note') {
      this._queueEvent({type:'dialogue',speaker:'YOU',text:'This person knows me. They searched my room.'});
      this.powerState='blackout';this._objective('RESTORE EMERGENCY POWER — electrical room 204, blue corridor north.');
      this._queueEvent({type:'sound',id:'bang'});this._queueEvent({type:'flashlight',on:true});
      this._startEncounter('blackout-silhouettes',3,[5,8],1,3.5,1.55);
    } else {
      this._saveCheckpoint(player);
      this.chaseState='warning';this.chaseTimer=0;
      this._queueEvent({type:'message',sender:'UNKNOWN',text:"You weren't supposed to find that."});
      this._objective('Checkpoint saved. Find the two signed routes to the lower stairwell.');
    }
    return {type:'evidence',evidence:item};
  }

  _saveCheckpoint(player) {
    this.checkpointReady=true;
    this._checkpoint={score:player.score,items:this.items.map(i=>i.collected),shortcut:this.doors.get('shortcut').open};
  }

  // Finite emergency reserve: no replenishment, auto-hit or wall penetration.
  // The normal hitscan must already intersect the living carrier. Otherwise
  // the player keeps this last round instead of firing it into empty space.
  consumeCarrierReserve(hitObject) {
    if(this.carrierAmmoReserve!==1 || !this.janitorZombie?.alive || !hitObject) return false;
    let belongsToCarrier=false;
    this.janitorZombie.group.traverse(child=>{if(child===hitObject)belongsToCarrier=true;});
    if(!belongsToCarrier) return false;
    this.carrierAmmoReserve=0;
    return true;
  }

  getEmptyAmmoHint() {
    if(this.carrierAmmoReserve) return '1 round reserved. Aim directly at the key carrier.';
    if(this.carrierSpawned && !this._found('last-rounds')) return 'Emergency ammunition is beside the lower stairwell.';
    if(!this._found('records-ammo') && this.powerState==='restored') return 'Find escape supplies in the records office.';
    return 'Find ammunition. Check security, electrical, or the supply rooms.';
  }

  restoreCheckpoint(player) {
    if(!this.checkpointReady) return false;
    this._cancelPendingEncounters();
    const active=[];this.zombiePool.forEachActive(z=>active.push(z));active.forEach(z=>this.zombiePool.release(z));
    this.explosionPool.update(10);
    if(this.janitorZombie) {this.janitorZombie.dispose();this.janitorZombie=null;}
    if(this.keyMesh) {this.scene.remove(this.keyMesh);this.keyMesh.traverse(c=>{if(c.isMesh){c.geometry.dispose();c.material.dispose();}});this.keyMesh=null;}
    this.zombies.length=0;this.pendingEvents.length=0;this.triggeredEncounters.clear();this.encounterStats.clear();
    this.keyCollected=false;this.carrierKilled=false;this.carrierSpawned=false;this.levelComplete=false;this._completionPending=false;
    this._keyPending=false;
    this.carrierAmmoReserve=0;
    this.exitDiscovered=false;this.chaseState='warning';this.chaseTimer=0;this.powerState='restored';
    this.requiredCluesFound=3;
    this.spawnRetryTimer=0;this.storyClock=0;this.storyStarted=true;this.ambientTimer=5;
    this.items.forEach((item,i)=>{item.collected=this._checkpoint.items[i];item.mesh.visible=!item.collected&&!item.late;});
    this._setDoor('lower-exit',false);this._setDoor('shortcut',this._checkpoint.shortcut);
    player.reset(new THREE.Vector3(8,0,-8));player.score=this._checkpoint.score;
    player.configureAmmo({limited:true,mag:10,reserve:14});player.setCameraProfile('indoor');
    this._objective('Checkpoint restored. Reach the lower stairwell when the alarm sounds.');
    this._queueEvent({type:'message',sender:'UNKNOWN',text:"You weren't supposed to find that."});
    return true;
  }

  _startChase() {
    if(this.chaseState==='running') return;
    this.chaseState='running';this.chaseTimer=0;
    this._objective('REACH THE LOWER STAIRWELL — blue main route or amber east route.');
    this._queueEvent({type:'message',sender:'UNKNOWN',text:'Run.',urgent:true});
    this._queueEvent({type:'alarm'});
    this._startEncounter('residence-chase',30,[2,3,4,5,6,8,9],5,2.2,1.9);
  }

  _spawnCarrier(camera=null) {
    if(this.carrierSpawned) return;
    const entry=this.carrierEntryPoints.find(p=>p.distanceToSquared(this.lastPlayerPosition)>=64 && !this._spawnIsVisible(p,camera));
    if(!entry) return;
    this.carrierSpawned=true;
    // Starts in the maintenance corridor, visible as it approaches the exit.
    this.janitorZombie=new Zombie(this.scene,entry,{isJanitor:true,speed:2.05,modelLibrary:this.zombieModels});
    this.janitorZombie.group.name='LowerStairwellKeyCarrier';
    const tag=new THREE.Mesh(new THREE.BoxGeometry(0.12,0.23,0.06),
      new THREE.MeshStandardMaterial({color:0xff3434,emissive:0x9a1010}));
    tag.position.set(0.23,1.15,0.2);this.janitorZombie.group.add(tag);
    tag.name='RedKeyTag';this._objective('Intercept the red-tag key carrier near the lower stairwell. One direct shot, then collect his key.');
    this._queueEvent({type:'banner',title:'KEY CARRIER AHEAD',subtitle:'Keep moving. Explosions will not kill the carrier.'});
    const rounds=this.items.find(i=>i.late);if(!rounds.collected) rounds.mesh.visible=true;
  }

  isZombieShootable(zombie) { return zombie?.alive; }

  handleZombieKilled(zombie,position) {
    if(zombie.isJanitor) {
      if(this.carrierKilled) return 0;
      this.carrierAmmoReserve=0;
      this.carrierKilled=true;this.spawnKey(position);
      this._objective('Collect the lower stairwell key. The infected are still coming.');
    } else this.zombiePool.release(zombie);
    // Same one-shot cascade rules; the separately owned carrier is excluded.
    let kills=0;const queue=[{position:position.clone(),radius:zombie.explosionRadius}];
    while(queue.length) {
      const blast=queue.shift(), victims=[];
      this.zombiePool.forEachActive(z=>{if(z.alive&&z.group.position.distanceTo(blast.position)<blast.radius) victims.push(z);});
      for(const z of victims) {
        const p=z.group.position.clone();z.explode(this.explosionPool);this.zombiePool.release(z);kills++;
        queue.push({position:p,radius:z.explosionRadius});
      }
    }
    return kills;
  }

  update(dt,player,time,camera=null) {
    this.lastPlayerPosition.copy(player.group.position);this.storyClock+=dt;
    if(!this.storyStarted) {
      this.storyStarted=true;
      this._queueEvent({type:'intro',title:'LEVEL 2 — DOWN THE STAIRS',subtitle:'Something is wrong below.'});
      this._queueEvent({type:'objective',text:this.objective});this._queueEvent({type:'sound',id:'slam'});
      this._queueEvent({type:'message',sender:'UNKNOWN',text:"Much quieter in here, isn't it?"});
      this._queueEvent({type:'dialogue',speaker:'YOU',text:'Ten rounds loaded. Limited reserve. Group them together before firing.'});
    }
    const p=player.group.position;
    if(p.z<24&&!this.zonesVisited.has('hall')) {
      this.zonesVisited.add('hall');this._startEncounter('first-hall',4,[1,3,4],2,2,1.6);
      this._queueEvent({type:'sound',id:'glass'});
    }
    if(p.x<-8&&p.z>25&&!this.zonesVisited.has('store')) {
      this.zonesVisited.add('store');this._startEncounter('store-risk',3,[1,3],3,1,1.65);
      this._queueEvent({type:'sound',id:'growl'});
    }
    if(this.powerState==='restoring') {
      this.powerRestoreTime+=dt;
      if(this.powerRestoreTime>=2.4) {
        this.powerState='restored';this._queueEvent({type:'flashlight',on:false});
        this._objective('Inspect the restricted records office. East corridor, opposite the laundry room.');
        this._startEncounter('power-return',4,[5,8],2,2,1.7);
      }
    }
    if(this.chaseState==='warning') {this.chaseTimer+=dt;if(this.chaseTimer>=5.5)this._startChase();}
    if(this.chaseState==='running') {
      this.chaseTimer+=dt;
      if(!this.carrierSpawned&&(p.z<-21||this.chaseTimer>7))this._spawnCarrier(camera);
    }
    this.ambientTimer-=dt;
    if(this.ambientTimer<=0) {
      const cues=['bang','hum','growl','scream','hum'];
      this._queueEvent({type:'sound',id:cues[this.ambientCue++%cues.length]});this.ambientTimer=11;
    }
    const dark=this.powerState==='blackout'||this.powerState==='restoring';
    this.roomAmbient.intensity=dark?0.65:1.4;
    for(let i=0;i<this.lamps.length;i++) {
      const on=!dark||(this.powerState==='restoring'&&this.powerRestoreTime>i*0.35);
      const flicker=this.chaseState==='running'?0.8+0.2*Math.sin(time*8+i):1;
      this.lamps[i].intensity=on?5*flicker:0.1;
      this.lamps[i].userData.fixture.emissiveIntensity=on?0.7:0.04;
    }
    this.emergency.intensity=dark||this.chaseState==='running'?2+Math.sin(time*5)*0.4:0.4;
    this._updateEncounters(dt,camera);this.navigation.update(dt,p);
    this.zombies.length=0;this.zombiePool.forEachActive(z=>this.zombies.push(z));
    if(this.janitorZombie?.alive)this.zombies.push(this.janitorZombie);
    for(const zombie of this.zombies) {
      const hit=zombie.update(dt,p,this.obstacles,this.navigation,this.zombies);
      if(hit.hit)player.takeDamage(hit.damage);
    }
    this.explosionPool.update(dt);
    if(this.keyMesh&&!this.keyCollected){this.keyMesh.rotation.y+=dt*2;this.keyMesh.position.y=0.8+Math.sin(time*3)*0.12;}
    const complete=this._completionPending;this._completionPending=false;
    const key=this._keyPending;this._keyPending=false;
    return {keyCollected:key,levelComplete:complete,storyEvents:this._drainEvents()};
  }

  getStoryStatus() { return {required:this.requiredCluesFound,totalRequired:3,objective:this.objective}; }
  getWaveStatus() {return {label:this.chaseState==='running'?'PURSUIT — KEEP MOVING':this.powerState==='blackout'?'EMERGENCY POWER OFF':'RESIDENCE / FLOOR 02',
    remaining:this.zombiePool?.activeCount||0,phase:this.chaseState==='running'?'boss':'story'};}
  getObjectivePosition() {
    if(this.chaseState==='running')return this.keyMesh&&!this.keyCollected?this.keyMesh.position:this.exitDoorPosition;
    const id=!this._found('security-log')?'security-log':!this._found('personal-note')?'personal-note':this.powerState!=='restored'?'breaker':'occupant-record';
    return this.items.find(i=>i.id===id)?.position;
  }

  dispose() {
    this._cancelPendingEncounters();this.zombiePool?.dispose();this.explosionPool?.dispose();this.janitorZombie?.dispose();
    this.zombieModels?.dispose();this.zombieModels=null;
    if(this.keyMesh){this.scene.remove(this.keyMesh);this.keyMesh.traverse(c=>{if(c.isMesh){c.geometry.dispose();c.material.dispose();}});}
    this.scene.remove(this.root);
    this.root.traverse(child=>{if(child.isInstancedMesh)child.dispose();});
    for(const geometry of this._geometries)geometry.dispose();
    for(const material of this._materials){material.map?.dispose();material.dispose();}
    this._geometries.clear();this._materials.clear();this.wallMeshes.length=0;this.obstacles.length=0;
    this.zombies.length=0;this.navigation=null;this.scene.fog=null;this.scene.background=null;this.scene.environment=null;
  }
}
