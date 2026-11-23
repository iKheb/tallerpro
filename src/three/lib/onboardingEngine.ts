/**
 * Motor de la escena de bienvenida (coreografía TallerPro): las piezas del
 * celular giran en un anillo como en un carrusel de taller, se desprenden una a
 * una en espiral y encajan con un "clic"; los tornillos entran atornillándose y
 * la pantalla llega volteada y gira para cerrar. Luego se enciende con la
 * palomita de TallerPro y cada paso (`stage`) mueve la cámara; en el paso "por
 * dentro" el teléfono se abre en abanico.
 */
import { Group, MathUtils, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Quaternion, Scene, Vector3, type Object3D } from 'three';
import { Viewport } from './viewport';
import { buildPhone, buildScrew, DISPLAY_ASPECT, fanLayerTransform, PHONE, type LayerKey, type PhoneModel } from './phone';
import { ScreenPainter } from './screen';
import type { ScreenData } from './screenData';
import { addStudioLights, Bokeh, createGlow, createStudioEnvironment, setGlowTheme, type StudioEnv, type StudioLights } from './studio';
import { disposeObject } from './dispose';
import { whenFontsReady, type ThemeName } from './env';
import { BOARD } from './textures';

export interface OnboardingEngineOptions {
  stage: number;
  theme: ThemeName;
  reducedMotion: boolean;
  screen?: ScreenData;
  onReady?: () => void;
  onAssembled?: () => void;
  onContextLost?: () => void;
}

type PartKind = 'layer' | 'screw' | 'lid';

interface Part {
  obj: Object3D;
  home: { pos: Vector3; quat: Quaternion; matrix: Matrix4 };
  /** Ángulo de la pieza en el anillo (rad). */
  angle: number;
  /** Altura propia sobre el anillo (ondulación del carrusel). */
  lift: number;
  delay: number;
  seed: number;
  kind: PartKind;
  /** Capa cuyo abanico sigue (para el paso "por dentro"). */
  follows: LayerKey | null;
}

interface Composition {
  yaw: number;
  pitch: number;
  roll: number;
  explode: number;
  side: number;
  fill: number;
  screen: 'boot' | 'dashboard';
}

/** Composiciones por paso (se repite la última si `stage` es mayor). */
export const ONBOARDING_STAGES: Composition[] = [
  { yaw: -0.24, pitch: 0.06, roll: 0.03, explode: 0, side: 0, fill: 0.6, screen: 'boot' },
  { yaw: Math.PI + 0.55, pitch: 0.1, roll: -0.04, explode: 0, side: 0.2, fill: 0.62, screen: 'boot' },
  { yaw: -0.3, pitch: 0.12, roll: 0.02, explode: 1, side: -0.17, fill: 0.56, screen: 'dashboard' },
  { yaw: -0.3, pitch: 0.05, roll: 0.03, explode: 0, side: 0.2, fill: 0.66, screen: 'dashboard' },
];

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

const T_ORBIT = 1.25; // s girando en el anillo antes del primer encaje
const T_PART = 1.3; // duración de la espiral de cada pieza
const T_STAGGER = 0.17;
const T_BOOT = 1.5;
/** Anillo del carrusel: radio, inclinación hacia la cámara, velocidad (rad/s) y escala de las piezas. */
const RING = { radius: 6.2, tilt: 0.42, speed: 0.6, scale: 0.62 };
const Y_AXIS = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);

export class OnboardingEngine {
  private vp: Viewport;
  private scene = new Scene();
  private camera = new PerspectiveCamera(30, 1, 0.5, 400);
  private env: StudioEnv;
  private lights: StudioLights;
  private painter: ScreenPainter;
  private phone: PhoneModel;
  private rig = new Group();
  private parts: Part[] = [];
  private bokeh: Bokeh;
  private nebula: Mesh[] = [];
  private glow: Mesh;
  private flash: Mesh;
  private o: OnboardingEngineOptions;
  private disposed = false;
  private readyFired = false;
  private clock = 0;
  private assemblyEnd = 0;
  private bootDone = false;
  private assembledFired = false;
  private screenMode: 'off' | 'boot' | 'dashboard' = 'off';
  private pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  private cur = { x: 0, y: 0, yaw: -0.45, pitch: 0.12, roll: 0, explode: 0, dist: 40 };

  constructor(host: HTMLElement, o: OnboardingEngineOptions) {
    this.o = { ...o };
    this.vp = new Viewport({ container: host, continuous: !o.reducedMotion });
    const renderer = this.vp.renderer;
    this.env = createStudioEnvironment(renderer);
    this.scene.environment = this.env.texture;
    this.lights = addStudioLights(this.scene);

    this.painter = new ScreenPainter(DISPLAY_ASPECT, 720);
    this.painter.texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    this.phone = buildPhone(this.painter.texture);
    this.phone.materials.display.emissiveIntensity = 0;
    this.rig.add(this.phone.root);
    this.scene.add(this.rig);
    this.buildParts();

    // fondo: partículas profundas + nebulosa de marca
    const mobile = this.vp.width < 700;
    this.bokeh = new Bokeh({
      count: mobile ? 220 : 420,
      spread: [30, 18, 26],
      center: [0, 0, -16],
      size: [0.05, 0.3],
      seed: 21,
    });
    this.scene.add(this.bokeh.points);
    const neb: [string, number, [number, number, number]][] = [
      ['iris', 46, [-14, 6, -34]],
      ['cyan', 38, [16, -8, -38]],
      ['iris', 30, [10, 12, -30]],
    ];
    for (const [tone, size, pos] of neb) {
      const m = createGlow(size, tone as 'iris' | 'cyan');
      m.position.set(...pos);
      this.nebula.push(m);
      this.scene.add(m);
    }
    this.glow = createGlow(13, 'iris');
    this.glow.position.set(0, 0, -3.6);
    this.rig.add(this.glow);
    this.flash = createGlow(9, 'cyan');
    this.flash.position.set(0, 0, 0.8);
    (this.flash.material as MeshBasicMaterial).opacity = 0;
    this.rig.add(this.flash);

    this.setTheme(o.theme);
    this.vp.onResize = () => this.updateCamera(true);
    this.vp.onFrame = (dt) => this.frame(dt);
    this.vp.onContextLost = () => o.onContextLost?.();
    window.addEventListener('pointermove', this.onPointer, { passive: true });
    if (import.meta.env.DEV) (host as HTMLElement & { __engine?: OnboardingEngine }).__engine = this;

    if (o.reducedMotion) this.skipToAssembled();
    else this.applyAssembly(0);
    this.snapToTarget();
    whenFontsReady().then(() => {
      if (!this.disposed && this.screenMode !== 'off') this.drawScreen(true);
    });
    this.vp.invalidate();
  }

  /* -------------------------------------------------------------- API */

  setStage(stage: number) {
    this.o.stage = stage;
    if (this.o.reducedMotion) this.snapToTarget();
    this.drawScreen();
    this.vp.invalidate();
  }

  setTheme(theme: ThemeName) {
    this.o.theme = theme;
    const light = theme === 'light';
    this.vp.renderer.toneMappingExposure = light ? 1.06 : 1;
    this.scene.environmentIntensity = light ? 1.12 : 1;
    this.lights.setTheme(theme);
    this.bokeh.setTheme(theme);
    this.nebula.forEach((n, i) => setGlowTheme(n, theme, light ? 0.5 : i === 2 ? 0.45 : 0.7));
    setGlowTheme(this.glow, theme, 0.85);
    setGlowTheme(this.flash, theme, 1);
    this.vp.invalidate();
  }

  setScreen(screen: ScreenData | undefined) {
    this.o.screen = screen;
    this.drawScreen(true);
    this.vp.invalidate();
  }

  setReducedMotion(v: boolean) {
    this.o.reducedMotion = v;
    this.vp.setContinuous(!v);
    if (v) {
      this.skipToAssembled();
      this.snapToTarget();
    }
    this.vp.invalidate();
  }

  /** Depuración: salta a un instante de la animación (s). */
  debugSeek(t: number) {
    this.clock = t;
    this.vp.invalidate();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('pointermove', this.onPointer);
    disposeObject(this.scene);
    this.painter.dispose();
    this.env.dispose();
    this.scene.environment = null;
    this.vp.dispose();
  }

  /* ---------------------------------------------------------- piezas */

  private buildParts() {
    const root = this.phone.root;
    root.updateMatrixWorld(true);
    // separar el módulo de cámara para que vuele por su cuenta
    const cam = root.getObjectByName('camera');
    const camPart = new Group();
    root.add(camPart);
    if (cam) camPart.attach(cam);
    // tornillos de la placa
    const screws: Group[] = [];
    const boardY = PHONE.H / 2 - 0.2 - BOARD.h / 2;
    for (const [x, y] of [[-1.5, 1.24], [-1.5, -0.98], [0.02, -1.25], [1.5, -1.25]] as const) {
      const sc = buildScrew(this.phone.materials, 0.05);
      const wrap = new Group();
      sc.position.set(x, boardY + y, 0.016);
      wrap.add(sc);
      root.add(wrap);
      screws.push(wrap);
    }
    const order: [Object3D, LayerKey | null, PartKind][] = [
      [this.phone.layers.back, 'back', 'layer'],
      [camPart, 'back', 'layer'],
      [this.phone.layers.battery, 'battery', 'layer'],
      [this.phone.layers.board, 'board', 'layer'],
      ...screws.map((s) => [s, 'board', 'screw'] as [Object3D, LayerKey, PartKind]),
      [this.phone.layers.frame, 'frame', 'layer'],
      [this.phone.layers.display, 'display', 'lid'],
    ];
    const n = order.length;
    order.forEach(([obj, follows, kind], i) => {
      // repartidas en el anillo, intercalando grandes y pequeñas
      const slot = (i * 7) % n;
      this.parts.push({
        obj,
        home: { pos: obj.position.clone(), quat: obj.quaternion.clone(), matrix: obj.matrix.clone() },
        angle: (slot / n) * Math.PI * 2,
        lift: Math.sin(i * 2.1) * 0.9,
        delay: i * T_STAGGER,
        seed: i * 1.731 + 0.4,
        kind,
        follows,
      });
    });
    this.assemblyEnd = T_ORBIT + (n - 1) * T_STAGGER + T_PART;
  }

  /** Instante en que la pieza `i` encaja en su lugar. */
  private landTime(p: Part) {
    return T_ORBIT + p.delay + T_PART;
  }

  private applyAssembly(time: number) {
    const tilt = new Quaternion().setFromAxisAngle(X_AXIS, RING.tilt);
    const q = new Quaternion();
    const off = new Vector3();
    for (const p of this.parts) {
      const k = MathUtils.clamp((time - T_ORBIT - p.delay) / T_PART, 0, 1);
      const e = ease(k);
      const free = 1 - e;
      // posición: carrusel inclinado que se cierra en espiral hacia su lugar
      const ang = p.angle + time * RING.speed;
      const r = RING.radius * free;
      const bob = Math.sin(time * 1.4 + p.seed) * 0.18 * free;
      off.set(Math.cos(ang) * r, (p.lift + bob) * free, Math.sin(ang) * r).applyQuaternion(tilt);
      // "clic" al encajar: entra un poco de más y rebota
      const click = Math.sin(Math.PI * MathUtils.clamp((k - 0.8) / 0.2, 0, 1));
      off.z -= click * 0.22;
      p.obj.position.copy(p.home.pos).add(off);
      // orientación: de cara hacia afuera del anillo → orientación armada
      q.setFromAxisAngle(Y_AXIS, Math.PI / 2 - ang).premultiply(tilt).multiply(p.home.quat);
      p.obj.quaternion.copy(q).slerp(p.home.quat, e);
      if (p.kind === 'screw') {
        // se atornilla: varias vueltas sobre su eje mientras llega
        p.obj.quaternion.multiply(q.setFromAxisAngle(Z_AXIS, free * Math.PI * 8));
      } else if (p.kind === 'lid') {
        // la pantalla llega volteada y gira para cerrar el teléfono
        p.obj.quaternion.multiply(q.setFromAxisAngle(Y_AXIS, Math.PI * (1 - easeOut(k))));
      }
      p.obj.scale.setScalar(MathUtils.lerp(RING.scale, 1, e) * (1 + click * 0.05));
    }
  }

  /** Suma de destellos breves cada vez que una pieza encaja (0..~1). */
  private clickPulse(time: number) {
    let v = 0;
    for (const p of this.parts) {
      const d = (time - this.landTime(p)) / 0.11;
      if (d > -1 && d < 4) v += Math.exp(-d * d);
    }
    return Math.min(1, v);
  }

  private applyExplode(amount: number) {
    this.phone.setExplode(amount);
    const pos = new Vector3();
    const quat = new Quaternion();
    const layerM = new Matrix4();
    const one = new Vector3(1, 1, 1);
    const scale = new Vector3();
    const wrappers = Object.values(this.phone.layers) as Object3D[];
    for (const p of this.parts) {
      if (wrappers.includes(p.obj)) continue;
      if (!p.follows) continue;
      // las piezas sueltas (cámara, tornillos) viajan con su capa: M = capa · armado
      fanLayerTransform(p.follows, amount, pos, quat);
      layerM.compose(pos, quat, one).multiply(p.home.matrix);
      layerM.decompose(p.obj.position, p.obj.quaternion, scale);
      p.obj.scale.setScalar(1);
    }
  }

  private skipToAssembled() {
    this.clock = this.assemblyEnd + T_BOOT + 0.1;
    this.applyAssembly(this.clock);
    this.phone.materials.display.emissiveIntensity = 1;
    this.bootDone = true;
    this.screenMode = 'off';
    this.drawScreen(true);
    if (!this.assembledFired) {
      this.assembledFired = true;
      this.o.onAssembled?.();
    }
  }

  /* ----------------------------------------------------------- pantalla */

  private stageComp(): Composition {
    const i = MathUtils.clamp(Math.floor(this.o.stage) || 0, 0, ONBOARDING_STAGES.length - 1);
    return ONBOARDING_STAGES[i];
  }

  private drawScreen(force = false) {
    if (!this.bootDone) return;
    const want = this.stageComp().screen;
    if (!force && want === this.screenMode) return;
    this.screenMode = want;
    if (want === 'dashboard') this.painter.drawDashboard(this.o.screen, 'hero');
    else this.painter.drawBoot(1, 1, 1);
  }

  /* ------------------------------------------------------------- cámara */

  private target() {
    const c = this.stageComp();
    const { width, height } = this.vp;
    const aspect = width / height;
    const t = Math.tan(MathUtils.degToRad(this.camera.fov / 2));
    const narrow = aspect < 0.85;
    const fill = narrow ? c.fill * 0.86 : c.fill;
    const halfH = (PHONE.H / 2 + 0.3 + c.explode * 1.3) / fill;
    const halfW = (2.3 + c.explode * 2.3) / fill;
    let dist = Math.max(halfH / t, halfW / (t * aspect));
    // al inicio, encuadre amplio para ver el carrusel de piezas
    const asm = this.o.reducedMotion ? 1 : easeOut(MathUtils.clamp((this.clock - T_ORBIT) / (this.assemblyEnd - T_ORBIT), 0, 1));
    const ringDist = Math.max(7.4 / t, 8.6 / (t * aspect));
    dist = MathUtils.lerp(ringDist, dist, asm);
    const viewW = 2 * dist * t * aspect;
    const viewH = 2 * dist * t;
    const wide = aspect > 1.15;
    return {
      x: wide ? viewW * c.side * asm : 0,
      y: narrow ? viewH * 0.1 * asm : 0,
      yaw: MathUtils.lerp(-0.42, c.yaw, this.bootDone ? 1 : 0),
      pitch: this.bootDone ? c.pitch : 0.12,
      roll: this.bootDone ? c.roll : 0.02,
      explode: this.bootDone ? c.explode : 0,
      dist,
    };
  }

  private snapToTarget() {
    Object.assign(this.cur, this.target());
    this.updateCamera(true);
  }

  private updateCamera(resize = false) {
    if (resize) {
      this.camera.aspect = this.vp.width / this.vp.height;
      this.camera.updateProjectionMatrix();
    }
    const px = this.o.reducedMotion ? 0 : this.pointer.x;
    const py = this.o.reducedMotion ? 0 : this.pointer.y;
    this.camera.position.set(px * 0.9, 0.6 + py * 0.6, this.cur.dist);
    this.camera.lookAt(0, 0, 0);
  }

  private onPointer = (e: PointerEvent) => {
    this.pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    this.pointer.ty = -((e.clientY / window.innerHeight) * 2 - 1);
  };

  /* -------------------------------------------------------------- frame */

  private frame(dt: number) {
    const reduced = this.o.reducedMotion;
    if (!reduced) this.clock += dt;
    const time = this.clock;

    // 1) ensamblaje
    const assembling = !reduced && time < this.assemblyEnd + 0.05;
    if (assembling) this.applyAssembly(time);

    // 2) encendido
    const m = this.phone.materials.display;
    if (!reduced && !this.bootDone && time >= this.assemblyEnd) {
      const b = MathUtils.clamp((time - this.assemblyEnd) / T_BOOT, 0, 1);
      m.emissiveIntensity = Math.min(1, b * 3.2) * (1 + 0.25 * Math.exp(-b * 9));
      this.painter.drawBoot(easeOut(MathUtils.clamp((b - 0.15) / 0.65, 0, 1)), Math.min(1, b * 2), MathUtils.clamp((b - 0.45) / 0.45, 0, 1));
      const fm = this.flash.material as MeshBasicMaterial;
      fm.opacity = Math.exp(-b * 5) * (this.o.theme === 'light' ? 0.5 : 0.9) * Math.min(1, b * 12);
      this.flash.scale.setScalar(0.5 + b * 1.6);
      if (b >= 1) {
        this.bootDone = true;
        this.screenMode = 'boot';
        fm.opacity = 0;
        this.drawScreen();
        if (!this.assembledFired) {
          this.assembledFired = true;
          this.o.onAssembled?.();
        }
      }
    }
    if (this.bootDone) this.drawScreen();

    // 3) composición (amortiguada)
    const tg = this.target();
    const c = this.cur;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 2.4);
    c.x += (tg.x - c.x) * k;
    c.y += (tg.y - c.y) * k;
    c.yaw += (tg.yaw - c.yaw) * k;
    c.pitch += (tg.pitch - c.pitch) * k;
    c.roll += (tg.roll - c.roll) * k;
    c.explode += (tg.explode - c.explode) * (reduced ? 1 : 1 - Math.exp(-dt * 2.0));
    c.dist += (tg.dist - c.dist) * (reduced ? 1 : 1 - Math.exp(-dt * (assembling ? 1.6 : 2.2)));
    if (!assembling) this.applyExplode(ease(MathUtils.clamp(c.explode, 0, 1)));

    const float = reduced ? 0 : Math.sin(time * 0.95) * 0.12;
    this.rig.position.set(c.x, c.y + float, 0);
    this.rig.rotation.set(c.pitch, c.yaw + (reduced ? 0 : Math.sin(time * 0.37) * 0.04), c.roll);
    const p = this.pointer;
    p.x = reduced ? 0 : MathUtils.damp(p.x, p.tx, 2.5, dt);
    p.y = reduced ? 0 : MathUtils.damp(p.y, p.ty, 2.5, dt);
    this.updateCamera();

    // halo trasero: destello en cada encaje y, ya encendido, una respiración lenta
    const clicks = !reduced && assembling ? this.clickPulse(time) : 0;
    const breath = this.bootDone && !reduced ? 0.5 + 0.5 * Math.sin(time * 1.3) : 0;
    const gm = this.glow.material as MeshBasicMaterial;
    const on = this.bootDone ? 1 : MathUtils.clamp((time - this.assemblyEnd) / T_BOOT, 0, 1);
    gm.opacity = (this.o.theme === 'light' ? 0.32 : 0.5) * (0.35 + 0.65 * on) + clicks * 0.2 + breath * 0.08;
    this.glow.scale.setScalar(1 + clicks * 0.08 + breath * 0.03 + c.explode * 0.2);
    this.nebula.forEach((n, i) => {
      n.position.x += Math.sin(time * 0.05 + i * 2) * 0.004;
      n.rotation.z = time * 0.01 * (i % 2 ? 1 : -1);
    });

    const scale = this.vp.height / (2 * Math.tan(MathUtils.degToRad(this.camera.fov / 2)));
    this.bokeh.update(reduced ? 0 : time, this.vp.pixelRatio, scale, 1);
    this.vp.renderer.render(this.scene, this.camera);
    if (!this.readyFired) {
      this.readyFired = true;
      this.o.onReady?.();
    }
  }
}
