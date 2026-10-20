// 方块世界：地形生成、房屋与树的搭建、面剔除 + 环境光遮蔽的网格构建、按季节重新上色。
import * as THREE from 'three';

export const T = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, PATH: 5, LOG: 6, MUD: 7, PLANK: 8,
  THATCH: 9, COBBLE: 10, MLOG: 11, LEAF_A: 12, LEAF_B: 13, LEAF_C: 14, TLOG: 15, TLEAF: 16, WATER: 17,
  RIDGE: 18, WETSAND: 19, SOIL: 20, CROP: 21, SCREE: 22,
};

// 细分倍数：1 个原方块 = V^3 个小方块，世界尺寸不变。
// 桌面 3（每块 1/3 单位）；触屏退回 2——面数会从 42 万降到 19 万，
// 顶点缓冲从 70MB 降到 31MB，这是手机能接受的量级。
const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
export const V = COARSE ? 2 : 3;

export const R = 56;                       // 世界半径（世界单位）
const RB = R * V;                          // 世界半径（方块）
const O = RB + 4 * V;
const W = 2 * O + 1;
const YMIN = -6 * V;
const YMAX = 52 * V;
const YH = YMAX - YMIN + 1;

// 以下对外导出的数值一律是「世界单位」，main.js 不用关心细分倍数。
export const RIVER_HALF = 2.3;
export const riverZ = (x) => 3 + 4 * Math.sin(x * 0.11) + 2 * Math.sin(x * 0.047 + 1.3);

// 房屋、枣树、小路的位置（世界单位）
export const HUT = { x0: -12, x1: -6, z0: -11, z1: -7, doorX: -9 };
const HUT_ZONE = { x0: -15, x1: -3, z0: -14, z1: -5 };
export const TREE = { x: 6, z: -3 };
const TREE_ZONE = { x0: 0, x1: 12, z0: -9, z1: 2 };
const PATH_X0 = -10, PATH_X1 = -8;
// 农田：在枣树右侧的一块平地
export const FIELD = { x0: 9.2, x1: 14.6, z0: -8, z1: -2.6 };
const FIELD_ZONE = { x0: 8.2, x1: 17, z0: -9.5, z1: -1.2 };

// ---------- 噪声与随机 ----------
function hash2(x, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function hash3(x, y, z) {
  return hash2(hash2(x, y) * 1e6 | 0, z);
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 4; i++) { s += amp * vnoise(x * f, z * f); f *= 2; amp *= 0.5; }
  return s / 0.9375;
}
export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const inRect = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
const rectDist = (r, x, z) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

// ---------- 网格 ----------
class Grid {
  constructor() { this.data = new Uint8Array(W * YH * W); }
  inb(x, y, z) { return x >= -O && x <= O && z >= -O && z <= O && y >= YMIN && y <= YMAX; }
  i(x, y, z) { return ((x + O) * YH + (y - YMIN)) * W + (z + O); }
  get(x, y, z) { return this.inb(x, y, z) ? this.data[this.i(x, y, z)] : 0; }
  set(x, y, z, t) { if (this.inb(x, y, z)) this.data[this.i(x, y, z)] = t; }
}

const isLeaf = (t) => (t >= T.LEAF_A && t <= T.LEAF_C) || t === T.TLEAF;
const isOpaque = (t) => t !== T.AIR && t !== T.WATER;
// 叶子不遮挡非叶子方块（冬天枣树叶子隐藏后，树枝不会露出空洞）
const occludes = (a, b) => isOpaque(b) && (!isLeaf(b) || isLeaf(a));

// ---------- 地形 ----------
function baseHeight(x, z) {
  const d = Math.hypot(x, z);
  let h = 0;
  const hills = fbm(x * 0.07 + 31, z * 0.07 - 17);
  h += Math.max(0, hills - 0.5) * 9 * smoothstep(16, 26, d);
  if (d > 26) {
    const m = fbm(x * 0.05 + 7, z * 0.05 + 3);
    const ridge = 1 - Math.abs(fbm(x * 0.09 - 5, z * 0.09 + 9) * 2 - 1);
    h += (d - 26) * (0.18 + m * 0.34) + ridge * 4 * smoothstep(26, 40, d);
  }
  // 几座明确的远山：给远景主峰，而不是一圈均匀的碗边
  const peaks = [[-30, -36, 28, 13], [20, -40, 32, 14], [38, 10, 22, 11], [-38, 14, 20, 11]];
  for (const [px, pz, ph, pr] of peaks) {
    const dd = Math.hypot(x - px, z - pz);
    if (dd > pr * 2.4) continue;
    const bump = Math.exp(-(dd * dd) / (pr * pr));
    h += ph * bump * (0.82 + 0.36 * fbm(x * 0.11 + px, z * 0.11 + pz));
  }
  return h;
}

// 方块坐标 -> 世界坐标的高度采样；返回值是方块高度（整数）
function heightAtBlock(xb, zb) {
  const xw = xb / V, zw = zb / V;
  const rd = Math.abs(zw - riverZ(xw));
  if (rd < RIVER_HALF) return -V;
  const flat = Math.min(rectDist(HUT_ZONE, xw, zw), rectDist(TREE_ZONE, xw, zw), rectDist(FIELD_ZONE, xw, zw));
  let hw = baseHeight(xw, zw) * smoothstep(0, 7, flat);
  const valley = (rd - RIVER_HALF) * 1.15;
  if (hw > valley) hw = Math.max(0, valley);
  return Math.min(Math.round(hw * V), YMAX - 10 * V);
}

export function generateWorld() {
  const grid = new Grid();
  const rng = mulberry32(20261007);
  const heights = new Int16Array(W * W).fill(-99);
  const hIdx = (x, z) => (x + O) * W + (z + O);
  const getH = (x, z) => (x < -O || x > O || z < -O || z > O) ? -99 : heights[hIdx(x, z)];
  // 把 1 个世界方块写成 V^3 个小方块（房屋、树干这类整块结构）。
  // 起点偏移 -V+1：小方块中心在 b/V，这样 yw 这一层正好落在世界 [yw-0.5, yw+0.5]。
  const cell0 = (c) => c * V - V + 1;
  const fillCell = (xw, yw, zw, t) => {
    const x0 = cell0(xw), y0 = cell0(yw), z0 = cell0(zw);
    for (let i = 0; i < V; i++) for (let j = 0; j < V; j++) for (let k = 0; k < V; k++)
      grid.set(x0 + i, y0 + j, z0 + k, t);
  };

  // 小路范围：从屋门向南穿过小桥
  const rzDoor = riverZ(HUT.doorX);
  const pathZ1 = Math.ceil(rzDoor + RIVER_HALF) + 5;
  const isPath = (xw, zw) => xw >= PATH_X0 && xw <= PATH_X1 && zw >= HUT.z1 + 1 && zw <= pathZ1;

  for (let xb = -RB; xb <= RB; xb++) {
    for (let zb = -RB; zb <= RB; zb++) {
      if (Math.hypot(xb, zb) > RB + 0.5 * V) continue;
      heights[hIdx(xb, zb)] = heightAtBlock(xb, zb);
    }
  }

  for (let xb = -RB; xb <= RB; xb++) {
    for (let zb = -RB; zb <= RB; zb++) {
      const h = getH(xb, zb);
      if (h === -99) continue;
      const xw = xb / V, zw = zb / V;
      const rd = Math.abs(zw - riverZ(xw));
      const river = rd < RIVER_HALF;
      let minN = h;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = getH(xb + dx, zb + dz);
        minN = Math.min(minN, n === -99 ? YMIN : n);
      }
      const steep = h - minN >= 3 * V && h > 4 * V;
      const rocky = h > (11 + fbm(xw * 0.2, zw * 0.2) * 7) * V || h > 26 * V;
      // 山脚碎石带：坡刚起来、高度还不高的一圈，露出碎石和裸土
      const foot = !river && h > 0 && h <= 5 * V && (h - minN) >= 1.5 * V
        && fbm(xw * 0.42 + 6, zw * 0.42 - 3) > 0.4;
      for (let yb = YMIN + 1; yb <= h; yb++) {
        const depth = h - yb;
        let t;
        if (depth === 0) {
          if (river) t = T.SAND;
          else if (isPath(xw, zw)) t = T.PATH;
          else if (h <= 0 && rd < RIVER_HALF + 1.3) t = rd < RIVER_HALF + 0.55 ? T.WETSAND : T.SAND;
          else if (steep || rocky) t = T.STONE;
          else if (foot) t = T.SCREE;
          else t = T.GRASS;
        // 草层保持约 1 个世界单位厚：台阶侧壁才不会被土色切成一圈圈横纹
        } else if (!steep && !rocky && depth < V) t = river ? T.SAND : T.GRASS;
        else if (depth <= 2 * V && !steep && !rocky) t = river ? T.SAND : T.DIRT;
        else t = T.STONE;
        grid.set(xb, yb, zb, t);
      }
      if (river) grid.set(xb, 0, zb, T.WATER);
    }
  }

  // ---- 农田：翻土成垄，隔一垄种一垄 ----
  const fx0 = Math.round(FIELD.x0 * V), fx1 = Math.round(FIELD.x1 * V);
  const fz0 = Math.round(FIELD.z0 * V), fz1 = Math.round(FIELD.z1 * V);
  for (let xb = fx0; xb <= fx1; xb++) {
    for (let zb = fz0; zb <= fz1; zb++) {
      const h = getH(xb, zb);
      if (h < 0) continue;
      grid.set(xb, h, zb, T.SOIL);
      const row = Math.floor((zb - fz0) / V) % 2;
      if (row === 0) {
        const tall = hash3(xb, 3, zb) > 0.4 ? 3 : 2;
        for (let k = 1; k <= tall; k++) grid.set(xb, h + k, zb, T.CROP);
      }
    }
  }
  // 木栅栏：两条长边立柱 + 横杆
  const fencePost = (xb, zb) => {
    const h = getH(xb, zb);
    if (h < 0) return h;
    for (let k = 1; k <= 3; k++) grid.set(xb, h + k, zb, T.MLOG);
    return h;
  };
  for (let xb = fx0 - 1; xb <= fx1 + 1; xb++) {
    for (const zEdge of [fz0 - 1, fz1 + 1]) {
      const atPost = (xb - fx0) % 4 === 0;
      const h = getH(xb, zEdge);
      if (h < 0) continue;
      if (atPost) fencePost(xb, zEdge);
      else if (!grid.get(xb, h + 2, zEdge)) grid.set(xb, h + 2, zEdge, T.MLOG);
    }
  }
  // 稻草人：立在田角
  {
    const sx = fx1 - 2, sz = fz0 + 2;
    const h = getH(sx, sz);
    if (h >= 0) {
      for (let k = 1; k <= 4; k++) grid.set(sx, h + k, sz, T.MLOG);
      for (let dx = -1; dx <= 1; dx++) grid.set(sx + dx, h + 3, sz, T.MLOG);
      grid.set(sx, h + 5, sz, T.MUD);          // 布头
      grid.set(sx, h + 6, sz, T.THATCH);       // 草帽
    }
  }
  // 草垛
  {
    const hx = fx0 + 2, hz = fz1 - 2;
    const h = getH(hx, hz);
    if (h >= 0) {
      for (let dx = 0; dx <= 1; dx++) for (let dz = 0; dz <= 1; dz++) for (let k = 1; k <= 2; k++)
        grid.set(hx + dx, h + k, hz + dz, T.THATCH);
      grid.set(hx, h + 3, hz, T.THATCH);
    }
  }

  // ---- 路上和小路边缘的碎石（让路面不至于像一条贴图带）----
  for (let z = Math.floor(HUT.z1); z <= pathZ1; z++) {
    for (const x of [PATH_X0 - 1, PATH_X1 + 1]) {
      if (rng() > 0.3) continue;
      const xb = Math.round(x * V), zb = Math.round(z * V);
      const h = getH(xb, zb);
      if (h < 0 || grid.get(xb, h, zb) !== T.GRASS) continue;
      grid.set(xb, h, zb, T.PATH);
    }
  }

  // ---- 草坡上的巨石：石包上偶尔盖一块草 ----
  const boulder = (cxw, czw, size) => {
    const xb = Math.round(cxw * V), zb = Math.round(czw * V);
    const h = getH(xb, zb);
    if (h < 0) return;
    const R = Math.max(1, Math.round(size * V / 2));
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      const e = (dx * dx + dz * dz) / (R * R + 0.6);
      if (e > 1) continue;
      const top = h + 1 + Math.round((1 - e) * R * (0.35 + hash3(xb + dx, 7, zb + dz) * 0.7));
      for (let y = h; y <= top; y++) {
        if (grid.get(xb + dx, y, zb + dz)) continue;
        const moss = y === top && hash3(xb + dx, y, zb + dz) > 0.62;
        grid.set(xb + dx, y, zb + dz, moss ? T.GRASS : T.STONE);
      }
    }
  };
  for (let i = 0; i < 24; i++) {
    const a = rng() * Math.PI * 2, r = 9 + rng() * 30;
    const xw = Math.cos(a) * r, zw = Math.sin(a) * r;
    if (rectDist(HUT_ZONE, xw, zw) < 2.6 || rectDist(TREE_ZONE, xw, zw) < 2.6) continue;
    if (Math.abs(zw - riverZ(xw)) < RIVER_HALF + 1.2) continue;
    if (isPath(xw, zw)) continue;
    boulder(xw, zw, 0.45 + rng() * 1.15);
  }

  // ---- 山脚乱石：沿坡起的一圈摆，强化平原与山坡的交界 ----
  for (let i = 0; i < 30; i++) {
    const a = rng() * Math.PI * 2, r = 18 + rng() * 9;
    const xw = Math.cos(a) * r, zw = Math.sin(a) * r;
    const xb = Math.round(xw * V), zb = Math.round(zw * V);
    const h = getH(xb, zb);
    if (h < 1 || h > 7 * V) continue;
    if (rectDist(HUT_ZONE, xw, zw) < 3 || rectDist(TREE_ZONE, xw, zw) < 3) continue;
    boulder(xw, zw, 0.45 + rng() * 1.0);
  }

  // ---- 河里的踏脚石 ----
  for (let x = -24; x <= 24; x++) {
    for (const side of [-1, 1]) {
      if (rng() > 0.2) continue;
      const z = riverZ(x) + side * (RIVER_HALF - 0.2 - rng() * 0.5);
      const xb = Math.round(x * V), zb = Math.round(z * V);
      if (grid.get(xb, 1, zb)) continue;
      grid.set(xb, 1, zb, T.STONE);
      if (rng() < 0.45) grid.set(xb, 2, zb, T.STONE);
    }
  }

  // ---- 杂草：成片的长草（位置导出，main.js 用实例化画）----
  const tufts = [];
  for (let i = 0; i < 4200 && tufts.length < 820; i++) {
    const a = rng() * Math.PI * 2, r = 3.5 + Math.sqrt(rng()) * 19;
    const xw = Math.cos(a) * r, zw = Math.sin(a) * r;
    if (fbm(xw * 0.32 + 2, zw * 0.32 - 5) < 0.4) continue;
    const xb = Math.round(xw * V), zb = Math.round(zw * V);
    const h = getH(xb, zb);
    if (h !== 0 || grid.get(xb, 0, zb) !== T.GRASS || grid.get(xb, 1, zb)) continue;
    if (Math.abs(zw - riverZ(xw)) < RIVER_HALF + 0.7) continue;
    if (isPath(xw, zw)) continue;
    if (rectDist(HUT_ZONE, xw, zw) < 0.7 || rectDist(TREE_ZONE, xw, zw) < 0.9) continue;
    tufts.push({ x: xw, z: zw, y: h / V, s: 0.65 + rng() * 0.7, rot: rng() * 3.14, v: rng() });
  }

  // ---- 河岸：浮萍 + 倒木 ----
  const lilies = [];
  for (let i = 0; i < 90 && lilies.length < 18; i++) {
    const x = -17 + rng() * 34;
    const side = rng() < 0.5 ? -1 : 1;
    const z = riverZ(x) + side * (RIVER_HALF - 0.55 - rng() * 1.2);
    const xb = Math.round(x * V), zb = Math.round(z * V);
    if (grid.get(xb, 0, zb) !== T.WATER) continue;
    lilies.push({ x: xb / V, z: zb / V, s: 0.55 + rng() * 0.55, rot: rng() * 3.14 });
  }
  for (let i = 0; i < 10; i++) {
    const x = -18 + rng() * 36;
    const side = rng() < 0.5 ? -1 : 1;
    const z = riverZ(x) + side * (RIVER_HALF + 0.3 + rng() * 0.9);
    const xb = Math.round(x * V), zb = Math.round(z * V);
    const h = getH(xb, zb);
    if (h !== 0 || grid.get(xb, h, zb) !== T.GRASS) continue;
    const len = 2 + Math.round(rng() * 3);
    for (let k = 0; k < len; k++) {
      if (!grid.get(xb + k, h + 1, zb)) grid.set(xb + k, h + 1, zb, T.LOG);
    }
  }

  // ---- 山上的树：成片分布、三种树型、尺寸抖动 ----
  const blob = (cx, cy, cz, rx, ry, rz, leaf, holes = 0.22) => {
    const RX = Math.ceil(rx), RY = Math.ceil(ry), RZ = Math.ceil(rz);
    const cells = [];
    for (let dx = -RX; dx <= RX; dx++) for (let dy = -RY; dy <= RY; dy++) for (let dz = -RZ; dz <= RZ; dz++) {
      const e = (dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rz) ** 2;
      if (e > 1) continue;
      const x = cx + dx, y = cy + dy, z = cz + dz;
      if (grid.get(x, y, z)) continue;
      if (e > 0.58 && hash3(x, y, z) < holes) continue;
      grid.set(x, y, z, leaf);
      cells.push({ x, y, z, e });
    }
    return cells;
  };

  const sites = [];
  for (let xw = -46; xw <= 46; xw++) {
    for (let zw = -46; zw <= 46; zw++) {
      const d = Math.hypot(xw, zw);
      // 近景留白：太靠近默认机位的树会挡住小屋
      if (d < 23 || d > 44) continue;
      // 低频噪声决定疏密：有林子和空地，而不是均匀撒点
      const patch = fbm(xw * 0.055 + 12, zw * 0.055 - 7);
      if (rng() > 0.012 + patch * 0.06) continue;
      const jx = xw + (rng() - 0.5) * 0.9, jz = zw + (rng() - 0.5) * 0.9;
      const xb = Math.round(jx * V), zb = Math.round(jz * V);
      const h = getH(xb, zb);
      if (h < 0 || h > 30 * V) continue;
      if (Math.abs(jz - riverZ(jx)) < RIVER_HALF + 2.5) continue;
      if (rectDist(HUT_ZONE, jx, jz) < 3 || rectDist(TREE_ZONE, jx, jz) < 3) continue;
      if (grid.get(xb, h, zb) !== T.GRASS) continue;
      if (sites.some((q) => Math.hypot(q.xb - xb, q.zb - zb) < 2.6 * V)) continue;
      sites.push({ xb, zb, h, alt: h / V });
    }
  }

  for (const site of sites.slice(0, 34)) {
    const { xb, zb, h } = site;
    const kind = rng();
    const pine = site.alt > 13 || (site.alt > 9 && kind < 0.45);
    const slim = !pine && kind > 0.74;
    const leaf = pine ? T.LEAF_C : kind < 0.4 ? T.LEAF_A : T.LEAF_B;
    const sc = 0.85 + rng() * 0.45;
    const trunkH = Math.max(2 * V, Math.round((pine ? 3.2 : 2.6) * sc * V));
    for (let y = 1; y <= trunkH; y++) {
      const wide = y <= Math.ceil(trunkH * 0.35);
      const n = wide ? Math.max(2, Math.round(V / 2)) : 1;
      for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) grid.set(xb + i, h + y, zb + k, T.MLOG);
    }
    const top = h + trunkH;
    if (pine) {
      // 松：四层收窄的锥
      for (let L = 0; L < 4; L++) {
        const r = Math.max(2, (3.4 - L * 0.7) * sc * (V / 2));
        blob(xb, top + Math.round(L * 0.85 * V), zb, r, Math.max(1, r * 0.62), r, leaf, 0.16);
      }
    } else if (slim) {
      // 细高（杨树感）
      const r = Math.max(2, 1.55 * sc * (V / 2));
      blob(xb, top + Math.round(1.6 * V), zb, r, 3.1 * sc * (V / 2), r, leaf, 0.2);
    } else {
      // 阔叶：两三个团簇错开
      const n = 2 + (rng() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng() * 0.8;
        const r = Math.max(2, (2.3 + rng() * 0.7) * sc * (V / 2));
        blob(
          xb + Math.round(Math.cos(a) * 0.8 * V),
          top + Math.round((1.1 + rng() * 0.8) * V),
          zb + Math.round(Math.sin(a) * 0.8 * V),
          r, r * 0.82, r, leaf, 0.22,
        );
      }
    }
  }

  // ---- 灌木与小树：把草地的边界做软 ----
  const meadowSpot = (rMin, rMax, pad) => {
    const a = rng() * Math.PI * 2, r = rMin + rng() * (rMax - rMin);
    const xw = Math.cos(a) * r, zw = Math.sin(a) * r;
    const xb = Math.round(xw * V), zb = Math.round(zw * V);
    const h = getH(xb, zb);
    if (h < 0 || h > 2 * V) return null;
    if (Math.abs(zw - riverZ(xw)) < RIVER_HALF + 1) return null;
    if (isPath(xw, zw)) return null;
    if (rectDist(HUT_ZONE, xw, zw) < pad || rectDist(TREE_ZONE, xw, zw) < pad) return null;
    if (grid.get(xb, h, zb) !== T.GRASS) return null;
    return { xb, zb, h, xw, zw };
  };
  for (let i = 0, n = 0; i < 70 && n < 9; i++) {
    const spot = meadowSpot(8, 21, 2.2);
    if (!spot) continue;
    n++;
    const rr = Math.max(2, Math.round((0.45 + rng() * 0.35) * V));
    const bt = rng() < 0.45 ? T.LEAF_A : rng() < 0.6 ? T.TLEAF : T.LEAF_B;
    blob(spot.xb, spot.h + Math.max(1, Math.round(rr * 0.4)), spot.zb, rr, Math.max(2, Math.round(rr * 0.7)), rr, bt, 0.3);
  }
  for (let i = 0, n = 0; i < 70 && n < 7; i++) {
    const spot = meadowSpot(10, 22, 2.4);
    if (!spot) continue;
    n++;
    const th = Math.round((1.3 + rng() * 1.1) * V);
    for (let y = 1; y <= th; y++) grid.set(spot.xb, spot.h + y, spot.zb, T.TLOG);
    const rr = Math.max(2, Math.round((0.7 + rng() * 0.5) * V));
    blob(spot.xb, spot.h + th + Math.round(rr * 0.5), spot.zb, rr, Math.round(rr * 0.9), rr, T.TLEAF, 0.26);
  }

  // ---- 风车：远处山脊上的地标 ----
  const WM = { x: -8, z: -28 };
  const wmx = Math.round(WM.x * V), wmz = Math.round(WM.z * V);
  const wmGround = getH(wmx, wmz);
  let wmTop = 0, hub = null;
  if (wmGround > 0) {
    let hMax = wmGround;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) hMax = Math.max(hMax, getH(wmx + dx, wmz + dz));
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      for (let y = wmGround; y <= hMax; y++) grid.set(wmx + dx, y, wmz + dz, T.COBBLE);
    }
    const base = hMax + 1;
    const height = Math.round(5.6 * V);
    for (let k = 0; k < height; k++) {
      const t = k / height;
      const half = Math.max(1, Math.round(2.2 * (1 - t * 0.4)));
      for (let dx = -half; dx <= half; dx++) for (let dz = -half; dz <= half; dz++) {
        if (Math.abs(dx) === half && Math.abs(dz) === half) continue;
        const t2 = k < 2 ? T.COBBLE : T.MUD;
        grid.set(wmx + dx, base + k, wmz + dz, t2);
      }
    }
    // 门洞
    for (let k = 0; k < 2 * V; k++) {
      if (wmz + 2 < W) grid.set(wmx, base + k, wmz + 2, T.AIR);
    }
    // 茅草顶
    for (let k = 0; k < 3; k++) {
      const half = Math.max(0, 2 - k);
      for (let dx = -half; dx <= half; dx++) for (let dz = -half; dz <= half; dz++) {
        grid.set(wmx + dx, base + height + k, wmz + dz, T.THATCH);
      }
    }
    wmTop = base + height + 3;
    hub = { x: WM.x, y: (base + Math.round(height * 0.72)) / V, z: (wmz + 3) / V };
  }

  // ---- 茅草屋：石基座 + 半木构架 + 窗台门框 + 双坡茅草顶 ----
  // 全部按小方块坐标搭（1 个世界单位 = V 块），对外仍然导出世界坐标。
  const windows = [];
  const hx0 = Math.round(HUT.x0 * V), hx1 = Math.round(HUT.x1 * V);
  const hz0 = Math.round(HUT.z0 * V), hz1 = Math.round(HUT.z1 * V);
  const fy = 1;                        // 石基座：地表方块 0 之上
  const wy0 = fy + 1;                  // 墙底
  const wy1 = wy0 + 3 * V - 1;         // 墙顶（3 个世界单位）
  const doorB = Math.round(HUT.doorX * V);
  const doorX0 = doorB - Math.floor((V - 1) / 2), doorX1 = doorX0 + V - 1;
  const doorY0 = wy0, doorY1 = wy0 + 2 * V - 1;
  const boxFill = (x0, x1, y0, y1, z0, z1, t) => {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) grid.set(x, y, z, t);
  };
  const inRing = (x, z) => x === hx0 || x === hx1 || z === hz0 || z === hz1;

  // 窗洞：前墙两扇、两侧各一扇，1 个单位见方
  const winDefs = [
    { axis: 'z', b: Math.round(-10.6 * V), wall: hz1 },
    { axis: 'z', b: Math.round(-7.4 * V), wall: hz1 },
    { axis: 'x', b: Math.round(-9 * V), wall: hx0 },
    { axis: 'x', b: Math.round(-9 * V), wall: hx1 },
  ].map((w) => {
    const a0 = w.b - Math.floor((V - 1) / 2);
    const y0 = wy0 + 2;
    return { ...w, a0, a1: a0 + V - 1, y0, y1: y0 + V - 1, dir: (w.axis === 'z' ? w.wall === hz1 : w.wall === hx1) ? 1 : -1 };
  });
  const isWindowCell = (x, y, z) => winDefs.some((w) => {
    if (y < w.y0 || y > w.y1) return false;
    return w.axis === 'z' ? (z === w.wall && x >= w.a0 && x <= w.a1) : (x === w.wall && z >= w.a0 && z <= w.a1);
  });

  // 基座 + 地板 + 门前石板
  for (let x = hx0 - 1; x <= hx1 + 1; x++) for (let z = hz0 - 1; z <= hz1 + 1; z++) {
    if (x === hx0 - 1 || x === hx1 + 1 || z === hz0 - 1 || z === hz1 + 1) grid.set(x, fy, z, T.COBBLE);
  }
  boxFill(hx0, hx1, fy, fy, hz0, hz1, T.PLANK);
  boxFill(doorX0 - 1, doorX1 + 1, fy, fy, hz1 + 1, hz1 + 2, T.COBBLE);

  // 灰泥墙（挖出门洞和窗洞）
  for (let y = wy0; y <= wy1; y++) {
    for (let x = hx0; x <= hx1; x++) for (let z = hz0; z <= hz1; z++) {
      if (!inRing(x, z)) continue;
      if (z === hz1 && x >= doorX0 && x <= doorX1 && y <= doorY1) continue;
      if (isWindowCell(x, y, z)) continue;
      grid.set(x, y, z, T.MUD);
    }
  }
  // 木构架：四角立柱 + 顶圈梁 + 转角斜撑
  for (const [cx, cz] of [[hx0, hz0], [hx0, hz1], [hx1, hz0], [hx1, hz1]]) {
    for (let y = wy0; y <= wy1; y++) grid.set(cx, y, cz, T.LOG);
  }
  for (let x = hx0; x <= hx1; x++) { grid.set(x, wy1, hz0, T.LOG); grid.set(x, wy1, hz1, T.LOG); }
  for (let z = hz0; z <= hz1; z++) { grid.set(hx0, wy1, z, T.LOG); grid.set(hx1, wy1, z, T.LOG); }
  const br = Math.min(2, V);
  for (const [x, dx] of [[hx0, 1], [hx1, -1]]) {
    for (let k = 1; k <= br; k++) { grid.set(x + dx * k, wy1 - k, hz1, T.LOG); grid.set(x + dx * k, wy1 - k, hz0, T.LOG); }
  }
  for (const [z, dz] of [[hz0, 1], [hz1, -1]]) {
    for (let k = 1; k <= br; k++) { grid.set(hx0, wy1 - k, z + dz * k, T.LOG); grid.set(hx1, wy1 - k, z + dz * k, T.LOG); }
  }
  // 门框：两侧立柱 + 门楣
  for (let y = wy0; y <= doorY1 + 1; y++) {
    if (doorX0 - 1 > hx0) grid.set(doorX0 - 1, y, hz1, T.LOG);
    if (doorX1 + 1 < hx1) grid.set(doorX1 + 1, y, hz1, T.LOG);
  }
  for (let x = doorX0 - 1; x <= doorX1 + 1; x++) grid.set(x, doorY1 + 1, hz1, T.LOG);

  // 窗：石窗台（外挑一块）+ 木过梁，并导出窗口中心给 main.js
  for (const w of winDefs) {
    for (let a = w.a0 - 1; a <= w.a1 + 1; a++) {
      if (w.axis === 'z') {
        grid.set(a, w.y0 - 1, w.wall, T.COBBLE);
        grid.set(a, w.y0 - 1, w.wall + w.dir, T.COBBLE);
        grid.set(a, w.y1 + 1, w.wall, T.LOG);
      } else {
        grid.set(w.wall, w.y0 - 1, a, T.COBBLE);
        grid.set(w.wall + w.dir, w.y0 - 1, a, T.COBBLE);
        grid.set(w.wall, w.y1 + 1, a, T.LOG);
      }
    }
    const along = (w.a0 + w.a1) / 2 / V, yc = (w.y0 + w.y1) / 2 / V;
    windows.push(w.axis === 'z'
      ? { x: along, y: yc, z: w.wall / V, axis: 'z' }
      : { x: w.wall / V, y: yc, z: along, axis: 'x' });
  }

  // 双坡茅草顶：出挑 1 个单位，每层收 1 块
  const ov = V;
  const roofY = wy1 + 1;
  const half = Math.floor((hz1 - hz0 + 1 + 2 * ov) / 2);
  for (let k = 0; k <= half; k++) {
    const za = hz0 - ov + k, zb = hz1 + ov - k;
    if (za > zb) break;
    boxFill(hx0 - ov, hx1 + ov, roofY + k, roofY + k, za, zb, T.THATCH);
  }
  // 屋脊压条
  for (let x = hx0 - ov; x <= hx1 + ov; x++) {
    for (let z = hz0 - ov + half; z <= hz1 + ov - half; z++) grid.set(x, roofY + half + 1, z, T.RIDGE);
  }
  // 烟囱：石砌 + 帽
  const chimney = { x: -7.5, z: -9 };
  const chx = Math.round(chimney.x * V), chz = Math.round(chimney.z * V);
  const chTop = roofY + half + 4;
  for (let y = wy0 + 3; y <= chTop; y++) {
    for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) grid.set(chx + i, y, chz + k, T.COBBLE);
  }
  for (let i = -1; i <= 2; i++) for (let k = -1; k <= 2; k++) grid.set(chx + i, chTop + 1, chz + k, T.COBBLE);

  // ---- 枣树：根盘 + 三级分枝 + 分离的冠簇 + 挂果 ----
  const tb = TREE;
  const tbx = Math.round(tb.x * V), tbz = Math.round(tb.z * V);
  const W3 = (u) => Math.round(u * V);          // 世界单位 -> 方块

  // 根盘：贴着地面鼓出一圈，别太夸张
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    if (dx * dx + dz * dz > 2) continue;
    if (!grid.get(tbx + dx, 1, tbz + dz)) grid.set(tbx + dx, 1, tbz + dz, T.TLOG);
  }
  // 沿两点铺一段圆树干
  const limb = (x0, y0, z0, x1, y1, z1, r0, r1) => {
    const steps = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0, z1 - z0) * 2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = Math.round(x0 + (x1 - x0) * t);
      const cy = Math.round(y0 + (y1 - y0) * t);
      const cz = Math.round(z0 + (z1 - z0) * t);
      const rr = r0 + (r1 - r0) * t;
      const R = Math.max(0, Math.round(rr));
      for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
        if (dx * dx + dz * dz > rr * rr + 0.35) continue;
        grid.set(cx + dx, cy, cz + dz, T.TLOG);
      }
    }
  };
  // 主干：细一点、带一点倾斜
  limb(tbx, 0, tbz, tbx + W3(0.22), W3(1.9), tbz + W3(0.08), 1.9, 1.5);
  limb(tbx + W3(0.22), W3(1.75), tbz + W3(0.08), tbx + W3(0.42), W3(3.5), tbz + W3(0.16), 1.5, 1.15);
  // 三条主枝
  limb(tbx + W3(0.3), W3(2.9), tbz + W3(0.1), tbx - W3(1.4), W3(6.2), tbz + W3(0.9), 1.25, 0.8);
  limb(tbx + W3(0.3), W3(3.1), tbz + W3(0.1), tbx + W3(1.5), W3(6.4), tbz - W3(1.0), 1.25, 0.8);
  limb(tbx + W3(0.3), W3(3.2), tbz + W3(0.1), tbx + W3(0.2), W3(6.6), tbz + W3(1.5), 1.25, 0.8);
  // 二级小枝
  limb(tbx - W3(1.4), W3(6.2), tbz + W3(0.9), tbx - W3(2.4), W3(7.2), tbz + W3(1.8), 0.7, 0.5);
  limb(tbx + W3(1.5), W3(6.4), tbz - W3(1.0), tbx + W3(2.5), W3(7.4), tbz - W3(1.8), 0.7, 0.5);

  // 冠簇：五团分离的球，彼此留缝
  const clusters = [
    { x: tbx - W3(1.9), y: W3(7.5), z: tbz + W3(1.1), r: 6 },
    { x: tbx + W3(2.0), y: W3(7.6), z: tbz - W3(1.2), r: 6 },
    { x: tbx + W3(0.3), y: W3(8.3), z: tbz + W3(1.5), r: 5 },
    { x: tbx + W3(0.1), y: W3(8.5), z: tbz - W3(0.2), r: 6 },
    { x: tbx - W3(1.2), y: W3(7.8), z: tbz - W3(1.8), r: 5 },
  ];
  const leafCells = [];
  for (const c of clusters) {
    const R = Math.max(3, Math.round(c.r * V / 3));
    for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
      const e = (dx * dx + dy * dy + dz * dz) / (R * R);
      if (e > 1) continue;
      const x = c.x + dx, y = c.y + dy, z = c.z + dz;
      if (grid.get(x, y, z)) continue;
      // 边缘多挖一点，剪影才不像一个整球
      if (e > 0.55 && hash3(x, y, z) < 0.16) continue;
      grid.set(x, y, z, T.TLEAF);
      leafCells.push({ x, y, z, e, cy: c.y, R });
    }
  }
  const pickCells = (arr, n) => {
    const a = arr.slice(), out = [];
    while (out.length < n && a.length) out.push(a.splice(Math.floor(rng() * a.length), 1)[0]);
    return out;
  };
  // 枣子：只在每个冠簇的下半部、贴着外沿挂，成小组
  const under = leafCells.filter((c) => c.e > 0.45 && c.y < c.cy && !grid.get(c.x, c.y - 1, c.z));
  const fruitSpots = [];
  for (const c of pickCells(under, Math.round(14 * V / 3))) {
    const n = 1 + Math.floor(rng() * 2);
    for (let k = 0; k < n; k++) {
      fruitSpots.push({
        x: (c.x + (rng() - 0.5) * 0.9) / V,
        y: (c.y - 1.2 - rng() * 0.4) / V,
        z: (c.z + (rng() - 0.5) * 0.9) / V,
        v: hash3(c.x, c.y, c.z),
      });
    }
  }
  const flowerSpots = pickCells(leafCells.filter((c) => c.e > 0.45), Math.round(40 * V / 3)).map((c) => ({
    x: c.x / V, y: (c.y - 0.4) / V, z: c.z / V, v: hash3(c.x, c.y, c.z),
  }));

  // ---- 草地上的小花、河边芦苇 ----
  const groundFlowers = [];
  for (let i = 0; i < 700 && groundFlowers.length < 78; i++) {
    const x = (rng() * 2 - 1) * 20, z = (rng() * 2 - 1) * 20;
    const xb = Math.round(x * V), zb = Math.round(z * V);
    if (Math.hypot(x, z) > 20) continue;
    // 成片开花：有花丛也有空草地
    if (fbm(x * 0.16 + 4, z * 0.16 - 9) < 0.46) continue;
    if (getH(xb, zb) !== 0 || grid.get(xb, 0, zb) !== T.GRASS || grid.get(xb, 1, zb)) continue;
    if (Math.abs(z - riverZ(x)) < RIVER_HALF + 1.6) continue;
    if (Math.hypot(x - tb.x, z - tb.z) < 2) continue;
    groundFlowers.push({ x, z, c: rng(), s: 0.7 + rng() * 0.5, v: rng() });
  }
  const reeds = [];
  for (let x = -26; x <= 26; x++) {
    for (const side of [-1, 1]) {
      if (rng() > 0.26) continue;
      if (x >= PATH_X0 - 1 && x <= PATH_X1 + 1) continue;
      // 一丛 2-5 根，高矮不一，别像插了一排杆子
      const n = 2 + Math.floor(rng() * 4);
      for (let k = 0; k < n; k++) {
        const cx = x + (rng() - 0.5) * 0.8;
        const z = riverZ(cx) + side * (RIVER_HALF + 0.15 + rng() * 0.8);
        const zb = Math.round(z * V), xb = Math.round(cx * V);
        const h = getH(xb, zb);
        if (h !== 0 || grid.get(xb, 1, zb)) continue;
        reeds.push({ x: cx, z, h: 0.75 + rng() * 0.95, v: rng() });
      }
    }
  }

  // 桥的跨度
  let bz0 = Infinity, bz1 = -Infinity;
  for (let x = PATH_X0; x <= PATH_X1; x++) {
    bz0 = Math.min(bz0, riverZ(x) - RIVER_HALF);
    bz1 = Math.max(bz1, riverZ(x) + RIVER_HALF);
  }
  const bridge = { x0: PATH_X0 - 0.5, x1: PATH_X1 + 0.5, z0: Math.floor(bz0) - 0.5, z1: Math.ceil(bz1) + 0.5 };

  // 每一列最高的方块（含树），给相机做碰撞用
  const tops = new Int16Array(W * W).fill(-99);
  for (let x = -O; x <= O; x++) for (let z = -O; z <= O; z++) {
    for (let y = YMAX; y >= YMIN; y--) if (grid.get(x, y, z)) { tops[hIdx(x, z)] = y; break; }
  }
  const topAt = (xw, zw) => {
    const x = Math.round(xw * V), z = Math.round(zw * V);
    if (x < -O || x > O || z < -O || z > O) return -99;
    const t = tops[hIdx(x, z)];
    return t === -99 ? -99 : t / V;
  };
  // 对外：世界坐标进，世界高度出
  const heightAtWorld = (xw, zw) => heightAtBlock(Math.round(xw * V), Math.round(zw * V)) / V;

  return {
    grid, getH: heightAtWorld, topAt, windows, chimney, fruitSpots, flowerSpots, groundFlowers, reeds, bridge,
    tufts, lilies,
    windmill: hub ? { hub, ground: wmGround / V, top: wmTop / V } : null,
    door: { x: (doorX0 + doorX1) / 2 / V, z: HUT.z1 },
  };
}

// ---------- 纹理图集 ----------
const TILE = 16, TILES = 16;
export const TILE_ID = { NOISE: 0, STONE: 1, PLANK: 2, LOG: 3, LOGTOP: 4, THATCH: 5, LEAF: 6, MUD: 7, GRAVEL: 8, GRASS: 9 };

export function makeAtlas() {
  const cv = document.createElement('canvas');
  cv.width = TILE * TILES; cv.height = TILE;
  const g = cv.getContext('2d');
  const rnd = mulberry32(7);
  const px = (tile, x, y, v) => {
    const c = Math.max(0, Math.min(255, Math.round(v * 255)));
    g.fillStyle = `rgb(${c},${c},${c})`;
    g.fillRect(tile * TILE + x, y, 1, 1);
  };
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const r = rnd();
    px(0, x, y, 0.9 + r * 0.1);
    px(1, x, y, (fbm(x * 0.35, y * 0.35) > 0.55 ? 0.8 : 0.92) + rnd() * 0.07);
    px(2, x, y, (y % 4 === 0 ? 0.68 : 0.9 + rnd() * 0.08) * ((x === (y < 8 ? 5 : 11) && y % 4 !== 0) ? 0.78 : 1));
    px(3, x, y, (x % 4 === 1 ? 0.7 : 0.88 + rnd() * 0.12));
    const rr = Math.hypot(x - 7.5, y - 7.5);
    px(4, x, y, (Math.floor(rr) % 3 === 0 ? 0.72 : 0.92) + rnd() * 0.06);
    px(5, x, y, ((x + Math.floor(y / 3)) % 3 === 0 ? 0.87 : 0.95 + rnd() * 0.04));
    px(6, x, y, r < 0.18 ? 0.82 : 0.9 + rnd() * 0.08);
    px(7, x, y, r < 0.06 ? 0.82 : 0.94 + rnd() * 0.05);
    px(8, x, y, r < 0.3 ? 0.78 : 0.9 + rnd() * 0.09);
    px(9, x, y, r < 0.12 ? 0.87 : 0.94 + rnd() * 0.05);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  // 远处用三线性：Nearest 在方块密集的坡面上会糊出摩尔纹（斜向格纹）
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  // 斜坡是斜视角看贴图，不给各向异性就会织出摩尔纹（那种斜向格纹）
  tex.anisotropy = 8;
  return tex;
}

function tileFor(t, dir) {
  const top = dir === 2 || dir === 3;
  switch (t) {
    // 顶面和侧面用同一张图：两张图平均亮度不同，台阶坡面会交替成棋盘格
    case T.GRASS: return TILE_ID.GRASS;
    case T.STONE: case T.COBBLE: return TILE_ID.STONE;
    case T.PATH: return TILE_ID.GRAVEL;
    case T.WETSAND: return TILE_ID.GRAVEL;
    case T.SOIL: return TILE_ID.GRAVEL;
    case T.SCREE: return TILE_ID.GRAVEL;
    case T.CROP: return TILE_ID.LEAF;
    case T.LOG: case T.MLOG: case T.TLOG: return top ? TILE_ID.LOGTOP : TILE_ID.LOG;
    case T.MUD: return TILE_ID.MUD;
    case T.PLANK: return TILE_ID.PLANK;
    case T.THATCH: case T.RIDGE: return TILE_ID.THATCH;
    case T.LEAF_A: case T.LEAF_B: case T.LEAF_C: case T.TLEAF: return TILE_ID.LEAF;
    default: return TILE_ID.NOISE;
  }
}

// ---------- 季节配色 ----------
const C = (hex) => new THREE.Color(hex);
const PALETTE = {
  spring: { grass: C('#9ed682'), leafA: C('#a4d789'), leafB: C('#b9e2a2'), leafC: C('#6ba268'), tleaf: C('#a8d98a'), thatch: C('#dcc08a'), crop: C('#93c76b') },
  summer: { grass: C('#7cbb66'), leafA: C('#5d9a55'), leafB: C('#6da85f'), leafC: C('#477f4e'), tleaf: C('#74b063'), thatch: C('#d6b57c'), crop: C('#a8bd5e') },
  autumn: { grass: C('#c3bb7a'), leafA: C('#dca465'), leafB: C('#cc8a59'), leafC: C('#5e8a58'), tleaf: C('#c8a86a'), thatch: C('#cfa76a'), crop: C('#d9b45c') },
  winter: { grass: C('#eef3f7'), leafA: C('#8a7a63'), leafB: C('#8a7a63'), leafC: C('#4a7050'), tleaf: C('#8a7a63'), thatch: C('#c2a06a'), crop: C('#bdaa86') },
};
const FIXED = {
  dirt: C('#8e6a4e'), stone: C('#a09a8c'), sand: C('#ddcba0'), path: C('#b3a68c'), log: C('#7a5c42'), logTop: C('#a88a63'),
  mud: C('#f0e6cf'), plank: C('#c09a6b'), cobble: C('#9a927f'), mlog: C('#6d5238'), tlog: C('#82684c'), tlogTop: C('#94765a'),
  snow: C('#f2f6fa'), autumnYellow: C('#e8c23a'), wetsand: C('#b8a078'), soil: C('#96755c'), scree: C('#a39684'),
};
const SNOW_LINE = { spring: 25, summer: 99, autumn: 27, winter: -99 };

const tmp = new THREE.Color(), tmpSide = new THREE.Color();
function faceColor(t, dir, y, v, season, out) {
  const p = PALETTE[season];
  const snowy = dir === 2 && t !== T.WATER && (season === 'winter' ? t !== T.TLEAF : y >= SNOW_LINE[season] && (t === T.STONE || t === T.GRASS || t === T.DIRT));
  if (snowy && !(t === T.MUD)) { out.copy(FIXED.snow); return out; }
  switch (t) {
    // 侧面直接用草色压暗一点。原来掺土色，方块减半后每一级台阶都会变成一条褐色横纹
    case T.GRASS: out.copy(season === 'winter' ? FIXED.snow : p.grass); break;
    case T.DIRT: out.copy(FIXED.dirt); break;
    case T.STONE: out.copy(FIXED.stone); break;
    case T.SAND: out.copy(FIXED.sand); break;
    case T.WETSAND: out.copy(FIXED.wetsand); break;
    case T.SOIL: out.copy(FIXED.soil); break;
    case T.SCREE: out.copy(FIXED.scree); break;
    case T.CROP: out.copy(p.crop); if (season === 'winter') out.lerp(FIXED.snow, 0.25); break;
    case T.PATH: out.copy(FIXED.path); break;
    case T.LOG: out.copy(dir === 2 || dir === 3 ? FIXED.logTop : FIXED.log); break;
    case T.MUD: out.copy(FIXED.mud); break;
    case T.PLANK: out.copy(FIXED.plank); break;
    case T.THATCH: out.copy(p.thatch); break;
    case T.RIDGE: out.copy(p.thatch).multiplyScalar(0.78); break;
    case T.COBBLE: out.copy(FIXED.cobble); break;
    case T.MLOG: out.copy(FIXED.mlog); break;
    case T.TLOG: out.copy(dir === 2 || dir === 3 ? FIXED.tlogTop : FIXED.tlog); break;
    case T.LEAF_A: out.copy(p.leafA); if (season === 'autumn' && v > 0.6) out.lerp(FIXED.autumnYellow, 0.6); break;
    case T.LEAF_B: out.copy(p.leafB); if (season === 'autumn' && v > 0.7) out.lerp(p.leafA, 0.5); break;
    case T.LEAF_C: out.copy(p.leafC); break;
    case T.TLEAF: out.copy(p.tleaf); if (season === 'autumn' && v > 0.55) out.lerp(FIXED.autumnYellow, 0.55); break;
    default: out.setRGB(1, 0, 1);
  }
  // 方块越小，逐块明暗差越要收敛，否则整片地形会变成噪点
  // 地表不做逐块色差：方块只有 4-8 像素时，这点差异会织成一层布纹
  const k = (t === T.GRASS || t === T.DIRT || t === T.STONE || t === T.SAND || t === T.PATH || t === T.WETSAND || t === T.SOIL || t === T.CROP || t === T.SCREE) ? 1 : 0.975 + v * 0.05;
  out.r *= k; out.g *= k; out.b *= k;
  return out;
}

// ---------- 网格构建 ----------
const DIRS = [
  { n: [1, 0, 0], c: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
  { n: [-1, 0, 0], c: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
  { n: [0, 1, 0], c: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
  { n: [0, -1, 0], c: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
  { n: [0, 0, 1], c: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
  { n: [0, 0, -1], c: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
];
const FACE_SHADE = [0.9, 0.9, 1.0, 0.72, 0.84, 0.84];
const AO_CURVE = [0.62, 0.78, 0.9, 1.0];
const UVS = [[0, 0], [1, 0], [1, 1], [0, 1]];
// 每个方向上，与法线垂直的两个轴（0=x 1=y 2=z）。预先算好，避免逐面分配数组。
const AXIS_A = [1, 1, 0, 0, 0, 0];
const AXIS_B = [2, 2, 2, 2, 1, 1];
const WATER_DROP = 0.22;
// 地表类：坡面是台阶拼出来的，一旦逐面加 AO/朝向差就会连成棋盘格。
// 让它们保持纯色（只有大尺度 tint），体积感交给建筑与树。
const isGround = (t) => t === T.GRASS || t === T.DIRT || t === T.STONE || t === T.SAND
  || t === T.PATH || t === T.WETSAND || t === T.SOIL || t === T.CROP || t === T.SCREE;

/**
 * 把网格里满足 filter 的方块转成一个 BufferGeometry（只生成外露的面，带顶点环境光遮蔽）。
 * 返回 { geometry, recolor(season) }。
 */
export function buildMesh(grid, filter, origin = [0, 0, 0]) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const meta = []; // 每个面：type, dir, y, v, ao0..ao3
  let vcount = 0;
  const d = grid.data;
  for (let x = -O; x <= O; x++) {
    for (let y = YMIN; y <= YMAX; y++) {
      const base = ((x + O) * YH + (y - YMIN)) * W;
      for (let z = -O; z <= O; z++) {
        const t = d[base + z + O];
        if (!t || !filter(t)) continue;
        const v = hash3(x, y, z);
        for (let f = 0; f < 6; f++) {
          const dir = DIRS[f];
          const nx = x + dir.n[0], ny = y + dir.n[1], nz = z + dir.n[2];
          const nb = grid.get(nx, ny, nz);
          if (t === T.WATER) { if (nb === T.WATER || occludes(t, nb)) continue; }
          else if (occludes(t, nb)) continue;
          const tile = tileFor(t, f);
          const u0 = (tile * TILE + 0.02) / (TILE * TILES), u1 = (tile * TILE + TILE - 0.02) / (TILE * TILES);
          const ao = [0, 0, 0, 0];
          const a0 = AXIS_A[f], a1 = AXIS_B[f];
          for (let k = 0; k < 4; k++) {
            const c = dir.c[k];
            const o0 = c[a0] > 0 ? 1 : -1;
            const o1 = c[a1] > 0 ? 1 : -1;
            const s1x = nx + (a0 === 0 ? o0 : 0), s1y = ny + (a0 === 1 ? o0 : 0), s1z = nz + (a0 === 2 ? o0 : 0);
            const s2x = nx + (a1 === 0 ? o1 : 0), s2y = ny + (a1 === 1 ? o1 : 0), s2z = nz + (a1 === 2 ? o1 : 0);
            const crx = s1x + (a1 === 0 ? o1 : 0), cry = s1y + (a1 === 1 ? o1 : 0), crz = s1z + (a1 === 2 ? o1 : 0);
            const a = occludes(t, grid.get(s1x, s1y, s1z)) ? 1 : 0;
            const b = occludes(t, grid.get(s2x, s2y, s2z)) ? 1 : 0;
            const cc = occludes(t, grid.get(crx, cry, crz)) ? 1 : 0;
            ao[k] = t === T.WATER ? 3 : (a && b ? 0 : 3 - (a + b + cc));
          }
          for (let k = 0; k < 4; k++) {
            const c = dir.c[k];
            let py = y + c[1];
            if (t === T.WATER && c[1] > 0) py -= WATER_DROP;
            pos.push(x + c[0] - origin[0], py - origin[1], z + c[2] - origin[2]);
            // 地表所有面法线朝上：受光一致，台阶就不会一格亮一格暗；阴影照常接收
            if (isGround(t)) nor.push(0, 1, 0);
            else nor.push(dir.n[0], dir.n[1], dir.n[2]);
            uv.push(UVS[k][0] ? u1 : u0, UVS[k][1] ? 0.998 : 0.002);
            col.push(1, 1, 1);
          }
          if (ao[0] + ao[2] < ao[1] + ao[3]) idx.push(vcount + 1, vcount + 2, vcount + 3, vcount + 1, vcount + 3, vcount);
          else idx.push(vcount, vcount + 1, vcount + 2, vcount, vcount + 2, vcount + 3);
          vcount += 4;
          // 用 fbm 而不是两三层 vnoise：后者是网格状值噪声，斜看会显出一块块方格
          const tint = fbm(x * 0.028 + 11, z * 0.028 - 4);
          meta.push(t, f, y, v, tint, ao[0], ao[1], ao[2], ao[3]);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const colorAttr = new THREE.Float32BufferAttribute(col, 3);
  geometry.setAttribute('color', colorAttr);
  geometry.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geometry.computeBoundingSphere();

  const colors = colorAttr.array;
  function recolor(season) {
    const faces = meta.length / 9;
    for (let i = 0; i < faces; i++) {
      const m = i * 9;
      faceColor(meta[m], meta[m + 1], meta[m + 2], meta[m + 3], season, tmp);
      const ground = isGround(meta[m]);
      const shade = (ground ? 1 : FACE_SHADE[meta[m + 1]]) * (0.96 + meta[m + 4] * 0.08);
      for (let k = 0; k < 4; k++) {
        const s = shade * (ground ? 1 : AO_CURVE[meta[m + 5 + k]]);
        const o = (i * 4 + k) * 3;
        colors[o] = tmp.r * s; colors[o + 1] = tmp.g * s; colors[o + 2] = tmp.b * s;
      }
    }
    colorAttr.needsUpdate = true;
  }
  return { geometry, recolor, faces: meta.length / 9 };
}

export const filters = {
  world: (t) => t !== T.WATER && t !== T.TLOG && t !== T.TLEAF,
  water: (t) => t === T.WATER,
  trunk: (t) => t === T.TLOG,
  leaves: (t) => t === T.TLEAF,
};
