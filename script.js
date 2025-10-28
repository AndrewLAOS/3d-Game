// script.js - Infinite Orangutan Parkour (polished, fixed collisions + height scoring)
// Assumes: three.js, OrbitControls, GLTFLoader are loaded in the page
// Place Orangutan.glb in the same folder as this script

// --------------------
// Basic scene + renderer
// --------------------
import { characters } from './characters.js';

let bananasCollected = parseInt(localStorage.getItem('bananasCollected') || '0', 10);
let selectedCharacter = localStorage.getItem('selectedCharacter') || 'Orangutan';

// keep track of unlocked characters in localStorage
let unlockedChars = JSON.parse(localStorage.getItem('unlockedChars') || '["Orangutan"]');


const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.FogExp2(0x87CEEB, 0.01);

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// --------------------
// Camera & controls
// --------------------
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 6, 12);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableZoom = false;
controls.enableDamping = true;
controls.target.set(0, 2, 0);

// --------------------
// Sky gradient (simple)
function setSkyGradient() {
    const topColor = new THREE.Color(0x87CEEB);
    const bottomColor = new THREE.Color(0xBDECB6);
    scene.background = topColor;
    scene.fog.color = topColor.clone().lerp(bottomColor, 0.25);
}
setSkyGradient();

// --------------------
// Lights
// --------------------
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(10, 30, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.left = -40;
dirLight.shadow.camera.right = 40;
dirLight.shadow.camera.top = 40;
dirLight.shadow.camera.bottom = -40;
scene.add(dirLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 0.25);
rimLight.position.set(-10, 10, -10);
scene.add(rimLight);

// --------------------
// Ground (infinite-look)
const groundGeo = new THREE.PlaneGeometry(1000, 1000);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x228B22 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.position.y = -50;
scene.add(ground);

// --------------------
// Common variables
// --------------------
const clock = new THREE.Clock();
let mixer, orangutan, animations = {}, currentAction = null;

let platforms = [];
let bananas = [];
let powerUps = [];
let obstacles = [];
let particles = [];

let maxHeight = -Infinity; // tracked player's highest Y
let score = 0;             // total score (height gains + pickups)
let heightScore = 0;       // internal height-derived score (optional separate usage)
let bonusScore = 0;        // pickups add here

let keys = {};
let velocityY = 0;
let gravity = -0.02;
let jumping = false;
let doubleJump = false;
let moveSpeed = 0.15;
let baseMoveSpeed = moveSpeed;
let jumpVelocity = 0.6;

let alive = true;
let magnetActive = false;
let magnetTimer = 0;

const world = {
    spawnAhead: 60,
    pruneBelow: -20,
    platformCount: 0,
    difficultyScale: 1,
};


// Hit cooldown to avoid repeated multi-hits
let lastHitTime = -999;
const hitCooldown = 0.8; // seconds

// High score persistence
const highKey = 'orangutan_high';
let highScore = parseInt(localStorage.getItem(highKey) || '0', 10);

// --------------------
// Materials & geometry
// --------------------
const platformMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
const bananaMat = new THREE.MeshStandardMaterial({ color: 0xFFFF66, emissive: 0x333300 });
const puSpeedMat = new THREE.MeshStandardMaterial({ color: 0x00FF00, emissive: 0x006600 });
const puJumpMat = new THREE.MeshStandardMaterial({ color: 0x00B3FF, emissive: 0x003366 });
const puMagnetMat = new THREE.MeshStandardMaterial({ color: 0xCC66FF, emissive: 0x330033 });
const obstacleMat = new THREE.MeshStandardMaterial({ color: 0xFF3333, metalness: 0.2 });

const platformGeo = new THREE.BoxGeometry(3, 0.5, 3);
const bananaGeo = new THREE.SphereGeometry(0.28, 12, 12);
const puGeo = new THREE.IcosahedronGeometry(0.35, 0);
const obstacleGeo = new THREE.BoxGeometry(1, 1, 1);

// --------------------
// Particle factory
// --------------------
function createPickupParticles(pos) {
    const particleCount = 12;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = [];
    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = pos.x;
        positions[i * 3 + 1] = pos.y;
        positions[i * 3 + 2] = pos.z;
        velocities.push(new THREE.Vector3(
            (Math.random() - 0.5) * 0.6,
            Math.random() * 0.8 + 0.2,
            (Math.random() - 0.5) * 0.6
        ));
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ size: 0.12, sizeAttenuation: true });
    const pts = new THREE.Points(geometry, material);
    pts.userData = { velocities, life: 0.9 };
    scene.add(pts);
    particles.push(pts);
}

// --------------------
// Spawners
// --------------------
function spawnPlatform(x, y, z, options = {}) {
    const geo = platformGeo.clone();
    const plat = new THREE.Mesh(geo, platformMat);
    plat.position.set(x, y, z);
    plat.castShadow = true;
    plat.receiveShadow = true;
    plat.userData = {
        id: ++world.platformCount,
        type: options.type || 'static',
        movingAxis: options.axis || 'x',
        range: options.range || (options.type === 'moving' ? 2.5 : 0),
        speed: (options.speed || 0.02) * (1 + Math.random() * 0.5),
        start: x,
        tilt: (Math.random() - 0.5) * 0.15,
    };
    plat.rotation.z = plat.userData.tilt * Math.sin(plat.position.x + plat.position.z);
    scene.add(plat);
    platforms.push(plat);
    return plat;
}

function spawnBanana(x, y, z) {
    const banana = new THREE.Mesh(bananaGeo, bananaMat);
    banana.position.set(x, y, z);
    banana.castShadow = true;
    banana.userData = { collected: false };
    scene.add(banana);
    bananas.push(banana);
    return banana;
}

function spawnPowerUp(x, y, z, kind = 'speed') {
    const mat = kind === 'speed' ? puSpeedMat : (kind === 'jump' ? puJumpMat : puMagnetMat);
    const pu = new THREE.Mesh(puGeo, mat);
    pu.position.set(x, y, z);
    pu.userData = { kind, spawnY: y, bobOffset: Math.random() * Math.PI * 2 };
    scene.add(pu);
    powerUps.push(pu);
    return pu;
}


let santaModel = null;
let santaLoaded = false;

// Load Santa model first
const santaLoader = new THREE.GLTFLoader();
santaLoader.load('./Chicken.glb', (gltf) => {
  santaModel = gltf.scene;
  santaModel.traverse(obj => {
    if (obj.isMesh) obj.castShadow = true;
  });
    santaModel.scale.set(1, 1, 1); // make Santa much bigger
  santaModel.position.set(0, 0, 0); // lift above platform
  santaModel.rotation.y = Math.PI; // face camera
  santaModel.traverse(obj => {
    if (obj.isMesh) {
      obj.receiveShadow = true;
      obj.material.side = THREE.DoubleSide; // ensure visible
    }
  });
  santaLoaded = true;
  console.log("✅ Santa model loaded!");

  // now that Santa is ready, initialize platforms
  initPlatforms();
}, undefined, err => console.error("Error loading Santa model:", err));
function spawnObstacle(x, y, z, axis = 'x', range = 2, speed = 0.05) {
  let obs;
if (santaLoaded && santaModel) {
  obs = santaModel.clone(true);
  obs.scale.set(1, 1, 1);
  obs.position.set(x, y + 1, z);
  obs.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.material.side = THREE.DoubleSide;
    }
  });
} else {
  obs = new THREE.Mesh(obstacleGeo, obstacleMat);
  obs.position.set(x, y + 0.5, z);
}


  obs.castShadow = true;
  obs.userData = { axis, range, speed, start: axis === 'x' ? x : z };
  scene.add(obs);
  obstacles.push(obs);
  return obs;
}




// --------------------
// Initial platforms
// --------------------
function initPlatforms() {
    // clear anything (if re-init)
    for (let p of platforms) scene.remove(p);
    platforms = [];

    const startX = 0, startZ = 0;
    let lastX = startX, lastY = 0, lastZ = startZ;
    spawnPlatform(lastX, lastY, lastZ, { type: 'static' });

    for (let i = 1; i < 12; i++) {
        const dx = (Math.random() * 4 - 2);
        const dz = (Math.random() * 4 - 2);
        const dy = 1 + Math.random() * 1.5;
        lastX += dx; lastY += dy; lastZ += dz;
        const pType = Math.random() < 0.18 ? 'moving' : 'static';
        spawnPlatform(lastX, lastY, lastZ, {
            type: pType,
            axis: Math.random() < 0.5 ? 'x' : 'z',
            range: 2 + Math.random() * 2,
            speed: 0.015 + Math.random() * 0.035
        });
        if (Math.random() < 0.35) spawnBanana(lastX, lastY + 0.75, lastZ);
        if (Math.random() < 0.08) {
            const kinds = ['speed', 'jump', 'magnet'];
            const kind = kinds[Math.floor(Math.random() * kinds.length)];
            spawnPowerUp(lastX + (Math.random() - 0.5) * 1.5, lastY + 0.9, lastZ + (Math.random() - 0.5) * 1.5, kind);
        }
        if (Math.random() < 0.22) spawnObstacle(lastX, lastY + 0.5, lastZ, Math.random() < 0.5 ? 'x' : 'z', 1.6 + Math.random() * 1.6, 0.03 + Math.random() * 0.05);
    }
}
initPlatforms();

// --------------------
// Dynamic spawn + prune
// --------------------
function spawnAheadIfNeeded(highestY) {
    let currentHigh = Math.max(...platforms.map(p => p.position.y));
    while (currentHigh < highestY + world.spawnAhead) {
        const lastPlat = platforms[platforms.length - 1];
        const lastX = lastPlat.position.x, lastY = lastPlat.position.y, lastZ = lastPlat.position.z;
        const dx = (Math.random() * 4 - 2);
        const dz = (Math.random() * 4 - 2);
        const dy = 0.8 + Math.random() * 2.0;
        const newX = lastX + dx, newY = lastY + dy, newZ = lastZ + dz;
        const pType = Math.random() < 0.18 ? 'moving' : 'static';
        const axis = Math.random() < 0.5 ? 'x' : 'z';
        const range = 1.6 + Math.random() * 2.4;
        const speed = (0.02 + Math.random() * 0.05) * (1 + world.difficultyScale * 0.15);

        spawnPlatform(newX, newY, newZ, { type: pType, axis, range, speed });

        if (Math.random() < 0.36) spawnBanana(newX, newY + 0.75, newZ);
        if (Math.random() < 0.10) {
            const kinds = ['speed', 'jump', 'magnet'];
            spawnPowerUp(newX + (Math.random() - 0.5) * 1.2, newY + 0.9, newZ + (Math.random() - 0.5) * 1.2, kinds[Math.floor(Math.random() * kinds.length)]);
        }
        if (Math.random() < 0.26) spawnObstacle(newX, newY + 0.5, newZ, Math.random() < 0.5 ? 'x' : 'z', 1.2 + Math.random() * 2, 0.03 + Math.random() * 0.06 + world.difficultyScale * 0.01);

        currentHigh = Math.max(currentHigh, newY);
    }
}

function pruneBelow(yThreshold) {
    for (let i = platforms.length - 1; i >= 0; i--) {
        if (platforms[i].position.y < yThreshold) { scene.remove(platforms[i]); platforms.splice(i, 1); }
    }
    for (let i = bananas.length - 1; i >= 0; i--) {
        if (bananas[i].position.y < yThreshold) { scene.remove(bananas[i]); bananas.splice(i, 1); }
    }
    for (let i = powerUps.length - 1; i >= 0; i--) {
        if (powerUps[i].position.y < yThreshold) { scene.remove(powerUps[i]); powerUps.splice(i, 1); }
    }
    for (let i = obstacles.length - 1; i >= 0; i--) {
        if (obstacles[i].position.y < yThreshold - 2) { scene.remove(obstacles[i]); obstacles.splice(i, 1); }
    }
}

// --------------------
// Load Orangutan model + animations
// --------------------
const loader = new THREE.GLTFLoader();
const charData = characters.list.find(c => c.name === selectedCharacter) || characters.list[0];

loader.load(charData.modelPath, gltf => {
    orangutan = gltf.scene;
    orangutan.scale.set(charData.scale || 1, charData.scale || 1, charData.scale || 1);
    orangutan.position.set(0, 1, 0);
    orangutan.traverse(obj => { if (obj.isMesh) obj.castShadow = true; });
    scene.add(orangutan);

    mixer = new THREE.AnimationMixer(orangutan);
    gltf.animations.forEach(clip => {
        animations[clip.name.toLowerCase()] = mixer.clipAction(clip);
    });
    if (animations['idle']) { currentAction = animations['idle']; currentAction.play(); }

    maxHeight = orangutan.position.y;
}, undefined, err => console.error('Error loading model:', err));

// --------------------
// Sound (optional)
const sounds = {};
try {
    sounds.jump = new Audio('./jump.wav');
    sounds.pick = new Audio('./pickup.wav');
    sounds.death = new Audio('./death.wav');
    sounds.power = new Audio('./power.wav');
} catch (e) { /* ignore */ }

// --------------------
// UI
const btn = document.createElement('button');
btn.innerText = "Restart Game";
btn.style.position = "absolute";
btn.style.top = "56px";
btn.style.left = "10px";
btn.style.zIndex = 10;
btn.style.padding = "10px 14px";
btn.style.fontSize = "16px";
btn.style.fontFamily = "Arial, sans-serif";
btn.style.display = "none";
btn.style.borderRadius = "8px";
btn.style.background = "rgba(20,20,20,0.7)";
btn.style.color = "white";
btn.style.border = "none";
document.body.appendChild(btn);
btn.addEventListener('click', () => location.reload());

const scoreText = document.createElement('div');
scoreText.id = "score";
scoreText.style.position = "absolute";
scoreText.style.top = "10px";
scoreText.style.left = "10px";
scoreText.style.color = "white";
scoreText.style.fontSize = "22px";
scoreText.style.fontFamily = "Arial, sans-serif";
scoreText.style.padding = "6px 10px";
scoreText.style.background = "rgba(0,0,0,0.3)";
scoreText.style.borderRadius = "6px";
document.body.appendChild(scoreText);

const hud = document.createElement('div');
hud.id = "hud";
hud.style.position = "absolute";
hud.style.top = "10px";
hud.style.right = "10px";
hud.style.color = "white";
hud.style.fontSize = "16px";
hud.style.fontFamily = "Arial, sans-serif";
hud.style.padding = "6px 10px";
hud.style.background = "rgba(0,0,0,0.25)";
hud.style.borderRadius = "6px";
document.body.appendChild(hud);

const bananaText = document.createElement('div');
bananaText.id = "bananas";
bananaText.style.position = "absolute";
bananaText.style.top = "90px";
bananaText.style.left = "10px";
bananaText.style.color = "yellow";
bananaText.style.fontSize = "20px";
bananaText.style.fontFamily = "Arial, sans-serif";
bananaText.style.padding = "6px 10px";
bananaText.style.background = "rgba(0,0,0,0.3)";
bananaText.style.borderRadius = "6px";
document.body.appendChild(bananaText);

// --------------------
// Character Shop & Switching
// --------------------
const shopContainer = document.createElement('div');
shopContainer.style.position = 'absolute';
shopContainer.style.bottom = '10px';
shopContainer.style.left = '50%';
shopContainer.style.transform = 'translateX(-50%)';
shopContainer.style.padding = '10px';
shopContainer.style.background = 'rgba(0,0,0,0.4)';
shopContainer.style.borderRadius = '8px';
shopContainer.style.display = 'flex';
shopContainer.style.gap = '10px';
shopContainer.style.zIndex = 10;
document.body.appendChild(shopContainer);

characters.list.forEach((char) => {
    const btn = document.createElement('button');
    btn.innerText = `${char.name} (${char.cost}🍌)`;
    btn.style.padding = '8px 12px';
    btn.style.border = 'none';
    btn.style.borderRadius = '6px';
    btn.style.cursor = 'pointer';
    btn.style.background = selectedCharacter === char.name ? 'gold' : '#333';
    btn.style.color = 'white';
    btn.onclick = () => {
       if (unlockedChars.includes(char.name) || char.cost === 0) {
            // already owned or free
            selectedCharacter = char.name;
            localStorage.setItem('selectedCharacter', selectedCharacter);
            location.reload();
        } else if (bananasCollected >= char.cost) {
            // buy it
            bananasCollected -= char.cost;
            localStorage.setItem('bananasCollected', bananasCollected);
           unlockedChars.push(char.name);
localStorage.setItem('unlockedChars', JSON.stringify(unlockedChars));
            alert(`Unlocked ${char.name}!`);
            selectedCharacter = char.name;
            localStorage.setItem('selectedCharacter', selectedCharacter);
            location.reload();
        } else {
            alert('Not enough bananas!');
        }
    };
    shopContainer.appendChild(btn);
});


// --------------------
// Input handling
document.addEventListener('keydown', e => {
    if (e.code === 'Space') {
        if (!alive) return;
        if (!jumping) {
            velocityY = jumpVelocity;
            jumping = true;
            doubleJump = false;
            if (sounds.jump) sounds.jump.play().catch(() => {});
        } else if (!doubleJump) {
            velocityY = jumpVelocity;
            doubleJump = true;
            if (sounds.jump) sounds.jump.play().catch(() => {});
        }
    } else {
        keys[e.code] = true;
    }
});
document.addEventListener('keyup', e => {
    if (e.code !== 'Space') keys[e.code] = false;
});

// --------------------
// Helpers
function setAction(name) {
    if (!animations[name]) return;
    if (currentAction === animations[name]) return;
    if (currentAction) currentAction.fadeOut(0.2);
    currentAction = animations[name];
    currentAction.reset().fadeIn(0.2).play();
}
function dist(a, b) { return a.distanceTo(b); }
function mathClamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// --------------------
// Main animate loop
function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (mixer) mixer.update(dt);
    controls.update();

    // Update only when model loaded
    if (orangutan && alive) {
        // Movement
        let moveX = 0, moveZ = 0;
        if (keys['KeyW'] || keys['ArrowUp']) moveZ -= 1;
        if (keys['KeyS'] || keys['ArrowDown']) moveZ += 1;
        if (keys['KeyA'] || keys['ArrowLeft']) moveX -= 1;
        if (keys['KeyD'] || keys['ArrowRight']) moveX += 1;

        if (moveX !== 0 || moveZ !== 0) {
            const angle = Math.atan2(moveX, moveZ);
            orangutan.rotation.y = THREE.MathUtils.lerp(orangutan.rotation.y, angle, 0.15);
            const normalized = new THREE.Vector2(moveX, moveZ).normalize();
            orangutan.position.x += normalized.x * moveSpeed;
            orangutan.position.z += normalized.y * moveSpeed;
            setAction('run');
        } else {
            setAction('idle');
        }

        // Gravity
        velocityY += gravity;
        orangutan.position.y += velocityY;

        // Platform collision
        let onPlatform = false;
        for (let plat of platforms) {
            const dx = Math.abs(orangutan.position.x - plat.position.x);
            const dz = Math.abs(orangutan.position.z - plat.position.z);
            const withinX = dx < 1.5;
            const withinZ = dz < 1.5;
            const above = orangutan.position.y > plat.position.y - 0.1;
            const closeY = orangutan.position.y < plat.position.y + 1.0;
            if (withinX && withinZ && above && closeY && velocityY <= 0) {
                onPlatform = true;
                orangutan.position.y = plat.position.y + 0.25;
                velocityY = 0;
                jumping = false;
                doubleJump = false;
                break;
            }
        }

        // Fall below camera -> game over
        if (orangutan.position.y < camera.position.y - 28) {
            alive = false;
            // show restart after short delay
            setTimeout(() => btn.style.display = "block", 400);
            if (sounds.death) sounds.death.play().catch(() => {});
        }

        // Power-ups
        for (let i = powerUps.length - 1; i >= 0; i--) {
            const pu = powerUps[i];
            pu.position.y = pu.userData.spawnY + Math.sin(clock.elapsedTime * 2 + pu.userData.bobOffset) * 0.12;
            if (dist(orangutan.position, pu.position) < 1.0) {
                const kind = pu.userData.kind;
                if (kind === 'speed') {
                    moveSpeed = baseMoveSpeed * 2.0;
                    setTimeout(() => { moveSpeed = baseMoveSpeed; }, 6000);
                } else if (kind === 'jump') {
                    jumpVelocity = 0.9;
                    setTimeout(() => { jumpVelocity = 0.6; }, 6000);
                } else if (kind === 'magnet') {
                    magnetActive = true;
                    magnetTimer = 6.0;
                }
                createPickupParticles(pu.position.clone());
                scene.remove(pu);
                powerUps.splice(i, 1);
                bonusScore += 150;
                if (sounds.power) sounds.power.play().catch(() => {});
            }
        }
        // --------------------
// Banana collection
for (let i = bananas.length - 1; i >= 0; i--) {
    const banana = bananas[i];

    // Magnet pulls banana
    if (magnetActive) {
        const dir = new THREE.Vector3().subVectors(orangutan.position, banana.position);
        const d = dir.length();
        if (d > 0.1) {
            dir.normalize().multiplyScalar(0.45);
            banana.position.add(dir.multiplyScalar(dt * 60 * 0.01));
        }
    }

    // Check collision
    if (dist(orangutan.position, banana.position) < 1.0) {
        collectBanana(banana);
        bananas.splice(i, 1);
    }
}


      // Obstacles movement + robust collision using bounding boxes
for (let obs of obstacles) {
    const ud = obs.userData;
    if (ud.axis === 'x') {
        obs.position.x += ud.speed * (1 + world.difficultyScale * 0.1);
        if (Math.abs(obs.position.x - ud.start) > ud.range) ud.speed *= -1;
    } else {
        obs.position.z += ud.speed * (1 + world.difficultyScale * 0.1);
        if (Math.abs(obs.position.z - ud.start) > ud.range) ud.speed *= -1;
    }

    // collision via Box3 intersection
    if (orangutan) {
        const obsBox = new THREE.Box3().setFromObject(obs);
        const playerBox = new THREE.Box3().setFromObject(orangutan);

        if (obsBox.intersectsBox(playerBox)) {
            const heightDiff = Math.abs(orangutan.position.y - obs.position.y);
            if (heightDiff < 1.2) {
                // flash obstacle
                if (obs.material && obs.material.emissive) {
                    obs.material.emissive.setHex(0xff0000);
                    setTimeout(() => { if (obs.material && obs.material.emissive) obs.material.emissive.setHex(0x000000); }, 150);
                }

                // push player back instead of ending game
                const knock = new THREE.Vector3().subVectors(orangutan.position, obs.position).setY(0).normalize().multiplyScalar(0.6);
                orangutan.position.add(knock);
                orangutan.position.y += 0.25; // small bounce
                velocityY = 0.1; // upward boost so player isn't stuck

                // optional: play sound or particles
                createPickupParticles(orangutan.position.clone());
                if (sounds.death) sounds.death.play().catch(() => {});
            }
        }
    }
}


        // Move platforms of type 'moving'
        for (let plat of platforms) {
            if (plat.userData.type === 'moving') {
                if (plat.userData.movingAxis === 'x') {
                    plat.position.x += plat.userData.speed * (1 + world.difficultyScale * 0.08);
                    if (Math.abs(plat.position.x - plat.userData.start) > plat.userData.range) plat.userData.speed *= -1;
                } else {
                    plat.position.z += plat.userData.speed * (1 + world.difficultyScale * 0.08);
                    if (Math.abs(plat.position.z - plat.userData.start) > plat.userData.range) plat.userData.speed *= -1;
                }
                plat.rotation.x = Math.sin(clock.elapsedTime * 0.5 + plat.userData.id) * 0.02;
                plat.rotation.z = Math.sin(clock.elapsedTime * 0.35 + plat.userData.id * 0.7) * 0.02;
            }
        }

        // Animations
        if (jumping) {
            setAction('jump');
        } else if ((keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD'] ||
                    keys['ArrowUp'] || keys['ArrowLeft'] || keys['ArrowDown'] || keys['ArrowRight'])) {
            setAction('run');
        } else {
            setAction('idle');
        }

        // Camera follow (smooth)
        const camOffset = new THREE.Vector3(0, 6, 12);
        const desiredCamPos = orangutan.position.clone().add(camOffset);
        camera.position.lerp(desiredCamPos, 0.08);
        camera.lookAt(orangutan.position.clone().add(new THREE.Vector3(0, 1, 0)));

        // Height-based scoring: add only newly gained height
        if (orangutan.position.y > maxHeight) {
            const heightGain = orangutan.position.y - maxHeight;
            maxHeight = orangutan.position.y;

            // tune multiplier as needed
            const heightPoints = Math.floor(heightGain * 50);
            score += heightPoints;
            heightScore += heightPoints;

            // dynamic difficulty
            world.difficultyScale = Math.floor(maxHeight / 12);
        }

        // Add bonusScore (picked up items)
        score = heightScore + bonusScore;

        // Update high score if needed
        if (score > highScore) {
            highScore = score;
            localStorage.setItem(highKey, String(highScore));
        }

        scoreText.innerText = `Score: ${Math.floor(score)}`;
        hud.innerText = `Height: ${Math.floor(maxHeight)}\nDifficulty: ${world.difficultyScale}\nMagnet: ${magnetActive ? magnetTimer.toFixed(1) + 's' : '—'}\nHigh: ${highScore}`;

        // Magnet timer decrement
        if (magnetActive) {
            magnetTimer -= dt;
            if (magnetTimer <= 0) magnetActive = false;
        }

        // Spawn/prune
        spawnAheadIfNeeded(maxHeight);
        pruneBelow(maxHeight + world.pruneBelow);
    }

    // Particles update
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.userData.life -= dt;
        const positions = p.geometry.attributes.position.array;
        for (let j = 0; j < p.userData.velocities.length; j++) {
            const v = p.userData.velocities[j];
            positions[j * 3] += v.x * dt * 12;
            positions[j * 3 + 1] += v.y * dt * 12;
            positions[j * 3 + 2] += v.z * dt * 12;
            v.y += gravity * 0.6;
        }
        p.geometry.attributes.position.needsUpdate = true;
        if (p.userData.life <= 0) {
            scene.remove(p);
            particles.splice(i, 1);
        }
    }

    renderer.render(scene, camera);
}
animate();

// --------------------
// Window resize
// --------------------
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --------------------
// Debug helpers (console tweaking)
// world.spawnAhead = 80
// world.pruneBelow = -30
// baseMoveSpeed = 0.18
// jumpVelocity = 0.6
// --------------------
// --------------------

// --------------------
// Bananas now give coins
// --------------------
function collectBanana(banana) {
    // Increment collected bananas
    bananasCollected += 1;
    localStorage.setItem('bananasCollected', bananasCollected);
    bananaText.innerText = `Bananas: ${bananasCollected}`;

    // Add points
    bonusScore += 25;

    // Create fewer particles
    createPickupParticles(banana.position.clone(), 5); // pass smaller count

    // Remove banana from scene
    scene.remove(banana);

    if (sounds.pick) sounds.pick.play().catch(() => {});
}



// --------------------
// Load default character on game start
// --------------------
if (characters.selected === null) characters.selected = 0;
loadCharacterModel(characters.list[characters.selected]);

