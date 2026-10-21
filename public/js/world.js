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
// 小屋置于河流内侧的干燥台地，向远离河道的 -Z 方向后退 2 世界单位。
// 锁定小屋主体尺寸与中轴，路径、烟囱、门窗、照明必须跟随这个锚点。
// 保持门与院落中轴 -9 不变：两侧各延伸 0.3 单位，屋后延伸 0.5 单位。
// 房子实际体量约 +10%，不让门口重新朝河岸挤去。
export const HUT = { x0: -12.3, x1: -5.7, z0: -13.5, z1: -9, doorX: -9 };
const HUT_ZONE = { x0: -15, x1: -3, z0: -16, z1: -7 };
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
  h += Math.max(0, hills - 0.5) * 7 * smoothstep(16, 26, d);
  // 出谷的坡要缓：原来 0.18~0.52 的抬升会把四周糊成一圈高墙，天空全被挡掉
  if (d > 30) {
    const m = fbm(x * 0.05 + 7, z * 0.05 + 3);
    const ridge = 1 - Math.abs(fbm(x * 0.09 - 5, z * 0.09 + 9) * 2 - 1);
    h += (d - 30) * (0.055 + m * 0.115) + ridge * 2.0 * smoothstep(30, 44, d);
  }
  // 最外圈抬一点挡住地图边界，但不是均匀一圈：留几处低地，
  // 视线越过山脊能看到远景剪影（否则四周会糊成一道等高墙）
  const gapMask = smoothstep(0.3, 0.66, fbm(x * 0.042 + 5, z * 0.042 - 2));
  h += (1.0 + 3.8 * gapMask) * smoothstep(42, 55, d) * (0.72 + 0.5 * fbm(x * 0.11 + 21, z * 0.11 - 13));
  // 近处这几座只当「山脚」：真正的高山交给远景剪影层，否则永远会把画面堵死
  const peaks = [[-33, -30, 8.5, 14], [24, -36, 10, 16], [40, -4, 6, 11], [-41, -2, 5.5, 11], [-8, -45, 7.5, 12]];
  for (const [px, pz, ph, pr] of peaks) {
    const dd = Math.hypot(x - px, z - pz);
    if (dd > pr * 2.4) continue;
    const bump = Math.exp(-(dd * dd) / (pr * pr));
    h += ph * bump * (0.86 + 0.28 * fbm(x * 0.11 + px, z * 0.11 + pz));
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
  // 主路连接桥面与门厅；支路按行走动线通往枣树树荫，避免把院子铺成广场。
  const isPrimaryPath = (xw, zw) =>
    xw >= PATH_X0 && xw <= PATH_X1 && zw >= HUT.z1 + 0.3 && zw <= pathZ1;
  const yardSpur = (xw, zw) => {
    const start = HUT.doorX, end = TREE.x - 1.25;
    if (xw < start || xw > end) return false;
    const t = (xw - start) / (end - start);
    const centerZ = (HUT.z1 + 1.82) + 2.24 * Math.pow(t, 0.82) + 0.16 * Math.sin(t * Math.PI);
    const halfWidth = 1.14 - 0.46 * t;
    const wornEdge = 0.08 * (hash3(Math.round(xw * V), 13, Math.round(zw * V)) - 0.5);
    return Math.abs(zw - centerZ) < halfWidth + wornEdge;
  };
  // 农田需有可走通路：从枣树支路向东南伸到田块西边，
  // 不压种植垄，不穿过树根，也不把院子铺成硬地广场。
  const farmApproach = (xw, zw) => {
    const start = 3.8, end = FIELD.x0 - 1.05;
    if (xw < start || xw > end) return false;
    const t = (xw - start) / (end - start);
    const centerZ = -4.96 - 3.04 * t - 0.13 * Math.sin(Math.PI * t);
    return Math.abs(zw - centerZ) <= 0.62 + 0.05 * (hash3(Math.round(xw * V), 19, Math.round(zw * V)) - 0.5);
  };
  // 风车的步道绕屋东侧向山坡延伸，终点停在风车基础之外。
  // 不允许从屋墙内部直穿过去，也不应当铺到风车门坎的石基座里。
  const millWaypoints = [[-5.7, -6.5], [-3.5, -10], [-3.5, -17.5],
    [-5.4, -22.5], [-8.0, -26.2]];
  const windmillTrack = (xw, zw) => {
    for (let i = 1; i < millWaypoints.length; i++) {
      const [ax, az] = millWaypoints[i - 1], [bx, bz] = millWaypoints[i];
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((xw - ax) * dx + (zw - az) * dz) / (dx * dx + dz * dz)));
      if ((xw - ax - t * dx) ** 2 + (zw - az - t * dz) ** 2 <= 0.55 ** 2) return true;
    }
    return false;
  };
  const isPath = (xw, zw) =>
    isPrimaryPath(xw, zw) || yardSpur(xw, zw) || farmApproach(xw, zw) || windmillTrack(xw, zw);
  // 留一块近门端有植被空隙的庭院，而非让河岸上的路径直接贴住屋墙。
  const inYard = (xw, zw) => {
    const dx = (xw - HUT.doorX) / 3.3, dz = (zw - (HUT.z1 + 1.8)) / 2.45;
    return dx * dx + dz * dz < 1 && fbm(xw * 0.72 + 8, zw * 0.68 - 1) > 0.39;
  };

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
      // 裸岩线：两条噪声叠出参差的分界，免得山腰上出现一条水平的灰色横切线
      const rockLine = (11.5 + fbm(xw * 0.13 + 3, zw * 0.13 - 8) * 3.2) * V;
      const rocky = h > rockLine;
      // 山脚碎石带：坡刚起来、高度还不高的一圈，露出碎石和裸土
      const foot = !river && h > 0 && h <= 7 * V && (h - minN) >= 1.2 * V
        && fbm(xw * 0.42 + 6, zw * 0.42 - 3) > 0.42;
      for (let yb = YMIN + 1; yb <= h; yb++) {
        const depth = h - yb;
        let t;
        if (depth === 0) {
          if (river) t = T.SAND;
          else if (isPath(xw, zw) || inYard(xw, zw)) t = T.PATH;
          // 溪流两侧的淤沙带不应当是固定宽度的“砌边”：借助两尺度岸滩噪声
          // 形成宽窄变化。紧邻水面的细带保持潮湿，向草甸过渡处自然变干。
          else if (h <= 0 && rd < RIVER_HALF + 0.14 +
            0.83 * fbm(xw * 0.38 + 2.7, zw * 0.41 - 6.4) +
            0.22 * fbm(xw * 1.09 - 4.2, zw * 1.16 + 8)) {
            const wetLimit = 0.12 + 0.41 * fbm(xw * 0.73 + 5, zw * 0.80 - 8);
            t = rd - RIVER_HALF < wetLimit ? T.WETSAND : T.SAND;
          }
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
  // 稻草人：一捆稻草 + 草帽，别只剩一根杆子顶个白方块（远看像墓碑）
  {
    const sx = fx1 - 2, sz = fz0 + 2;
    const h = getH(sx, sz);
    if (h >= 0) {
      const half = Math.max(1, Math.floor(V / 2));
      const b0 = Math.round(1.3 * V), b1 = b0 + Math.round(1.4 * V);
      const armY = b1 - 1, headY = b1 + 1, hatY = headY + 1;
      for (let k = 1; k < b0; k++) grid.set(sx, h + k, sz, T.MLOG);
      for (let dx = -half; dx <= half; dx++) for (let dz = -half; dz <= half; dz++) {
        for (let k = b0; k <= b1; k++) grid.set(sx + dx, h + k, sz + dz, T.THATCH);
      }
      for (let dx = -2 * V; dx <= 2 * V; dx++) if (Math.abs(dx) > half) grid.set(sx + dx, h + armY, sz, T.MLOG);
      grid.set(sx, h + headY, sz, T.MUD);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > 1) continue;
        grid.set(sx + dx, h + hatY, sz + dz, T.THATCH);
      }
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
      if (rng() > 0.11) continue;
      const z = riverZ(x) + side * (RIVER_HALF - 0.65 - rng() * 0.6);
      const xb = Math.round(x * V), zb = Math.round(z * V);
      // 放在水面那一层：露头一点点，才是踏脚石，砌到 2 格就成了一排系船柱
      if (grid.get(xb, 1, zb)) continue;
      grid.set(xb, 0, zb, T.STONE);
      if (rng() < 0.3) grid.set(xb + 1, 0, zb, T.STONE);
    }
  }

  // ---- V3.1 草甸：斑块生长，降低粗糙重复的草丛密度 ----
  const tufts = [];
  for (let i = 0; i < 7600 && tufts.length < 460; i++) {
    const a = rng() * Math.PI * 2, r = 4.2 + Math.sqrt(rng()) * 23.5;
    const xw = Math.cos(a) * r, zw = Math.sin(a) * r;
    const patch = fbm(xw * 0.19 + 2, zw * 0.19 - 5);
    if (patch < 0.51 || rng() > 0.48 + (patch - 0.51) * 1.5) continue;
    const xb = Math.round(xw * V), zb = Math.round(zw * V);
    const h = getH(xb, zb);
    if (h !== 0 || grid.get(xb, 0, zb) !== T.GRASS || grid.get(xb, 1, zb)) continue;
    const rd = Math.abs(zw - riverZ(xw));
    if (rd < RIVER_HALF + 1.5 || isPath(xw, zw)) continue;
    if (rectDist(HUT_ZONE, xw, zw) < 1.8 || rectDist(TREE_ZONE, xw, zw) < 1.65) continue;
    // 桥边留出轮廓清晰的步道
    if (xw > PATH_X0 - 3 && xw < PATH_X1 + 3 && rd < RIVER_HALF + 5) continue;
    tufts.push({ x: xw, z: zw, y: h / V, s: 0.69 + rng() * 0.48,
      rot: rng() * Math.PI * 2, v: rng(), n: 2 + Math.floor(rng() * 3) });
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
      if (d < 26 || d > 50) continue;
      // 低频噪声决定疏密：有林子和空地，而不是均匀撒点
      // 成片而不是均匀撒点：噪声高的地方长林子，低的地方留空草地
      const patch = fbm(xw * 0.062 + 12, zw * 0.062 - 7);
      if (patch < 0.47) continue;
      if (rng() > (patch - 0.47) * 0.26) continue;
      const jx = xw + (rng() - 0.5) * 0.9, jz = zw + (rng() - 0.5) * 0.9;
      const xb = Math.round(jx * V), zb = Math.round(jz * V);
      const h = getH(xb, zb);
      if (h < 0 || h > 11 * V) continue;
      if (Math.abs(jz - riverZ(jx)) < RIVER_HALF + 2.5) continue;
      // 双视觉主角周边留出呼吸空间，外围树林不能遮住房屋和枣树轮廓。
      if (Math.hypot(jx + 9, jz + 9) < 19 || Math.hypot(jx - TREE.x, jz - TREE.z) < 17) continue;
      if (rectDist(HUT_ZONE, jx, jz) < 3 || rectDist(TREE_ZONE, jx, jz) < 3) continue;
      if (grid.get(xb, h, zb) !== T.GRASS) continue;
      if (sites.some((q) => Math.hypot(q.xb - xb, q.zb - zb) < 2.6 * V)) continue;
      sites.push({ xb, zb, h, alt: h / V });
    }
  }

  // V3.1: 候选点原先按 x 坐标顺序排列，只取前 30 棵会让地图一侧过密、另一侧荒凉。
  // 独立随机源打散候选并按八个方位均衡选树，最多 32 棵，不扩大总模型开销。
  const forestSites = [...sites];
  const forestPick = mulberry32(20261021);
  for (let i = forestSites.length - 1; i > 0; i--) {
    const j = Math.floor(forestPick() * (i + 1));
    [forestSites[i], forestSites[j]] = [forestSites[j], forestSites[i]];
  }
  const forestSectorCounts = new Array(8).fill(0), balancedForest = [];
  for (const site of forestSites) {
    const sector = Math.min(7, Math.floor((Math.atan2(site.zb, site.xb) + Math.PI) / (Math.PI * 2) * 8));
    if (forestSectorCounts[sector] >= 4) continue;
    balancedForest.push(site);
    forestSectorCounts[sector]++;
    if (balancedForest.length >= 32) break;
  }
  // 按形态而不是只按半径分四种树：高挑、低展、圆冠、不规则松。
  // 用世界位置决定形态，保证同一视角刷新后造型稳定。
  const forestShapeCounts = { round: 0, tall: 0, spreading: 0, pine: 0 };
  let forestGroundedCount = 0, forestPedestalViolations = 0;
  for (const site of balancedForest) {
    const { xb, zb, h } = site;
    const kind = hash3(xb, h + 17, zb);
    const species = site.alt > 8 && kind < 0.70 ? 'pine'
      : kind < 0.18 ? 'pine'
      : kind < 0.43 ? 'tall'
      : kind < 0.72 ? 'round' : 'spreading';
    forestShapeCounts[species]++;
    const leaf = species === 'pine' ? T.LEAF_C
      : species === 'spreading' ? T.LEAF_B : kind < 0.48 ? T.LEAF_A : T.LEAF_B;
    const sc = 0.83 + hash3(xb, 81, zb) * 0.43;
    const tall = species === 'tall';
    const trunkH = Math.max(2 * V, Math.round((tall ? 3.45 : species === 'pine' ? 3.05 : 2.3) * sc * V));
    const bendX = Math.round((hash3(xb, 29, zb) - 0.5) * 0.7 * V);
    const bendZ = Math.round((hash3(xb, 51, zb) - 0.5) * 0.6 * V);
    // 主干连续生长，上下不再从高达 30% 树高的 3x3 黑方柱突然收成细杆。
    for (let y = 1; y <= trunkH; y++) {
      const sx = xb + Math.round(bendX * y / trunkH);
      const sz = zb + Math.round(bendZ * y / trunkH);
      grid.set(sx, h + y, sz, T.MLOG);
    }
    // 保守回退：撤销四方向伸出的块状树根，只保留紧贴地面的低矮根颈。
    // 树冠/树种/树位仍沿用早先好看的稳定版本，山坡上的细干直接扎进坡面。
    // 桌面 V=3 仅贴地加两片不连成方柱的短木根，避免低端视角看见黑底座。
    if (V >= 3 && !tall) {
      const rootSides = hash3(xb, 43, zb) > 0.5 ? [[1, 0], [0, -1]] : [[-1, 0], [0, 1]];
      for (const [dx, dz] of rootSides) {
        const rx = xb + dx, rz = zb + dz, soil = getH(rx, rz);
        if (soil === h && grid.get(rx, h + 1, rz) === T.AIR)
          grid.set(rx, h + 1, rz, T.MLOG);
      }
    }
    // 真实检查每棵树中心根与土地相连，检查距地面约 2 小格处已没有方形底座。
    if (grid.get(xb, h + 1, zb) === T.MLOG) forestGroundedCount++;
    const pedestalY = h + Math.max(2, Math.round(0.75 * V));
    const pedestalArms = [[1,0],[-1,0],[0,1],[0,-1]]
      .filter(([dx,dz]) => grid.get(xb + dx, pedestalY, zb + dz) === T.MLOG).length;
    if (pedestalArms >= 3) forestPedestalViolations++;
    const cx = xb + bendX, cz = zb + bendZ, top = h + trunkH;
    const S = (u) => Math.round(u * V * sc);
    if (species === 'pine') {
      // 不规则的针叶片层，局部轻微偏心，不再是相同等宽五层锥体。
      for (let L = 0; L < 4; L++) {
        const height = top + S(0.34 + L * 0.80);
        const radius = Math.max(2, S((1.72 - L * 0.32) * (0.88 + hash3(xb, L, zb) * 0.24)));
        const ox = L % 2 ? Math.round(V * 0.18) : 0;
        blob(cx + ox, height, cz, radius, Math.max(2, Math.round(radius * 0.6)), Math.round(radius * 0.84), leaf, 0.16);
      }
    } else if (tall) {
      // 高挑阔叶：上提长椭圆冠，留出更多裸露树干。
      const r = Math.max(2, S(1.14));
      blob(cx, top + S(1.35), cz, r, Math.max(3, S(2.35)), Math.round(r * 0.86), leaf, 0.18);
      blob(cx + S(0.23), top + S(2.48), cz - S(0.18),
        Math.max(2, Math.round(r * 0.72)), Math.max(2, S(1.03)), Math.max(2, Math.round(r * 0.8)), leaf, 0.18);
    } else if (species === 'spreading') {
      // 横展阔叶：有意保留左右高低落差，树冠低矮而开阔。
      const side = hash3(xb, 38, zb) > 0.5 ? 1 : -1;
      blob(cx, top + S(0.83), cz, Math.max(2, S(1.62)), Math.max(2, S(0.93)), Math.max(2, S(1.20)), leaf, 0.19);
      blob(cx - S(1.24), top + S(0.48), cz + S(0.32), Math.max(2, S(1.39)), Math.max(2, S(0.78)), Math.max(2, S(1.17)), leaf, 0.20);
      blob(cx + S(1.47), top + S(0.72 + side * 0.18), cz - S(0.24), Math.max(2, S(1.37)), Math.max(2, S(0.88)), Math.max(2, S(1.09)), leaf, 0.19);
    } else {
      // 饱满圆冠：中心球量与不等大副冠组成连续剪影，避免单块球体。
      const r = Math.max(2, S(1.64));
      blob(cx, top + S(1.05), cz, r, Math.max(2, S(1.43)), r, leaf, 0.17);
      blob(cx - S(0.78), top + S(0.77), cz + S(0.42), Math.max(2, S(1.19)), Math.max(2, S(0.96)), Math.max(2, S(1.05)), leaf, 0.17);
      blob(cx + S(0.93), top + S(0.89), cz - S(0.34), Math.max(2, S(1.16)), Math.max(2, S(0.90)), Math.max(2, S(0.98)), leaf, 0.17);
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

  // 院落生活层：只在支路两侧放少量矮植和一张坐凳，不再用大树填满主景留白。
  // 布局固定，避免刷新后随机堆到道路、门口或枣树根部。
  const courtyardShrubs = [];
  for (const [x, z, scale] of [
    [-4.2, -3.7, 0.62], [-1.1, -8.6, 0.52], [2.2, -7.8, 0.67], [3.1, -1.8, 0.54],
  ]) {
    if (isPath(x, z) || rectDist(HUT_ZONE, x, z) < 0.65 || Math.hypot(x - TREE.x, z - TREE.z) < 2.2) continue;
    const xb = Math.round(x * V), zb = Math.round(z * V), h = getH(xb, zb);
    if (h < 0 || grid.get(xb, h, zb) !== T.GRASS) continue;
    const rr = Math.max(1, Math.round(scale * V));
    const leaf = x < 0 ? T.LEAF_B : T.LEAF_A;
    // 两片低矮相连的自然冠团与短木质根茎，替代漂浮在草上的方形叶盒。
    const crownY = h + Math.max(1, Math.round(rr * 0.67));
    const added = blob(xb, crownY, zb,
      rr, Math.max(1, Math.round(rr * 0.53)), rr + (x > 2 ? 1 : 0), leaf, 0.12);
    blob(xb + (x > 0 ? 1 : -1), crownY, zb + 1,
      Math.max(1, rr - 1), Math.max(1, Math.round(rr * 0.43)), rr, leaf, 0.16);
    if (added.length) {
      if (!grid.get(xb, h + 1, zb)) grid.set(xb, h + 1, zb, T.TLOG);
      courtyardShrubs.push({ x, z });
    }
  }
  // 小坐凳放在枣树方向小径外侧；尺寸控制在约 1.8 世界单位，无需新增贴图/纹理资源。
  const bench = { x: 0.8, z: -2.85 };
  const benchX = Math.round(bench.x * V), benchZ = Math.round(bench.z * V);
  const benchH = getH(benchX, benchZ);
  if (benchH >= 0 && !isPath(bench.x, bench.z) && grid.get(benchX, benchH, benchZ) === T.GRASS) {
    const halfSeat = Math.max(1, Math.round(0.85 * V));
    // 旧模型座面只有离地一格，立柱循环一次也不执行，远看就是悬浮木块。
    const seatY = benchH + Math.max(2, Math.round(0.75 * V));
    const backZ = benchZ - Math.max(1, Math.round(0.3 * V));
    const backTop = seatY + Math.max(2, Math.round(0.7 * V));
    // 两条腿分别下探至本地地形，不假定木凳两端的坡面完全等高。
    for (const dx of [-halfSeat, halfSeat]) {
      const legX = benchX + dx, soil = getH(legX, benchZ);
      for (let y = soil + 1; y < seatY; y++) grid.set(legX, y, benchZ, T.LOG);
      for (let y = seatY; y <= backTop; y++) grid.set(legX, y, backZ, T.LOG);
    }
    for (let dx = -halfSeat; dx <= halfSeat; dx++) {
      grid.set(benchX + dx, seatY, benchZ, T.PLANK);
      grid.set(benchX + dx, backTop, backZ, T.PLANK);
    }
  }

  // ---- V3.1 山坡微生态：独立于河边草甸的布景规则 ----
  // 贴合真实高度场；山脊留白，山脚略密，林缘聚集，避免填满每一个坡面。
  const hillShrubs = [], hillStones = [];
  const hillRng = mulberry32(20261020);
  for (let i = 0; i < 4600 && (hillShrubs.length < 165 || hillStones.length < 180); i++) {
    const a = hillRng() * Math.PI * 2, r = 16 + Math.sqrt(hillRng()) * 34;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const xb = Math.round(x * V), zb = Math.round(z * V);
    const h = getH(xb, zb);
    if (h <= V || h > 12 * V) continue;
    if (grid.get(xb, h, zb) !== T.GRASS || grid.get(xb, h + 1, zb)) continue;
    if (Math.abs(z - riverZ(x)) < RIVER_HALF + 2.6) continue;
    if (isPath(x, z) || rectDist(HUT_ZONE, x, z) < 4 || rectDist(TREE_ZONE, x, z) < 4) continue;
    const patch = fbm(x * 0.085 + 7, z * 0.085 - 3);
    const exposed = fbm(x * 0.14 - 9, z * 0.14 + 12);
    const onShrubPatch = patch > 0.45 && exposed > 0.29;
    // 山腰和山脚有元素，山顶只保留少量孤立岩石。
    const shrub = onShrubPatch && hillRng() > 0.30 && hillShrubs.length < 165;
    const stone = (patch < 0.51 || exposed > 0.63) && hillStones.length < 180;
    const y = (h + 0.5) / V;
    if (shrub && !hillShrubs.some(p => Math.hypot(p.x - x, p.z - z) < 1.6)) {
      hillShrubs.push({ x, z, y, size: 0.57 + hillRng() * 0.63, rot: hillRng() * 6.283,
        v: hillRng() });
    } else if (stone && hillRng() < 0.58 && !hillStones.some(p => Math.hypot(p.x - x, p.z - z) < 1.05)) {
      hillStones.push({ x, z, y, size: 0.45 + hillRng() * 0.7, rot: hillRng() * 6.283,
        v: hillRng() });
    }
  }

  // ---- 风车：山坡上有石基、可进出的塔身与真正连接的风翼 ----
  const WM = { x: -8, z: -28 };
  const wmx = Math.round(WM.x * V), wmz = Math.round(WM.z * V);
  const wmGround = getH(wmx, wmz);
  let wmTop = 0, hub = null;
  let windmillDoorOpen = false;
  if (wmGround > 0) {
    // 统一以世界单位确定塔身比例，避免手机版胖、桌面版细得像柱子。
    const baseHalf = Math.max(2, Math.round(1.16 * V));
    let hMax = wmGround;
    for (let dx = -baseHalf; dx <= baseHalf; dx++)
      for (let dz = -baseHalf; dz <= baseHalf; dz++)
        hMax = Math.max(hMax, getH(wmx + dx, wmz + dz));
    for (let dx = -baseHalf; dx <= baseHalf; dx++)
      for (let dz = -baseHalf; dz <= baseHalf; dz++)
        for (let y = wmGround; y <= hMax; y++) grid.set(wmx + dx, y, wmz + dz, T.COBBLE);
    const base = hMax + 1;
    const height = Math.round(5.6 * V);
    const halfAt = (k) => Math.max(1, Math.round((1.16 - 0.20 * k / height) * V));
    for (let k = 0; k < height; k++) {
      const half = halfAt(k);
      for (let dx = -half; dx <= half; dx++) for (let dz = -half; dz <= half; dz++) {
        if (Math.abs(dx) === half && Math.abs(dz) === half) continue;
        grid.set(wmx + dx, base + k, wmz + dz, k < Math.max(2, Math.round(.45 * V)) ? T.COBBLE : T.MUD);
      }
    }
    // 门口面向前来的人走土路：真正凿通木门后的短通道，不是外墙贴一个黑格。
    const doorHalf = V % 2 === 0 ? 1 : Math.floor(V / 2);
    for (let k = 0; k < 2 * V; k++) {
      const wallZ = wmz + halfAt(k);
      for (let dx = -doorHalf; dx <= doorHalf; dx++)
        for (let dz = wmz; dz <= wallZ; dz++) grid.set(wmx + dx, base + k, dz, T.AIR);
    }
    windmillDoorOpen = grid.get(wmx, base + 1, wmz + halfAt(1)) === T.AIR;
    // 轻盈的四面斜屋面依塔身比例生长，屋顶至少包住塔身顶部。
    const roofLayers = Math.max(2, Math.round(1.25 * V));
    const roofBase = halfAt(height - 1) + 1;
    for (let k = 0; k < roofLayers; k++) {
      const half = Math.max(0, Math.round(roofBase * (1 - k / roofLayers)));
      for (let dx = -half; dx <= half; dx++)
        for (let dz = -half; dz <= half; dz++) grid.set(wmx + dx, base + height + k, wmz + dz, T.THATCH);
    }
    wmTop = base + height + roofLayers;
    // 叶片旋转轴安装在外侧立面之前，避免风叶嵌进泥墙里。
    hub = { x: WM.x, y: (base + Math.round(height * 0.72)) / V,
      z: (wmz + halfAt(Math.round(height * 0.72)) + 1) / V };
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
  // 偶数细分 V=2 无法用偶数个格子以整数轴线为中心：采用 3 格门洞。
  const doorCells = V % 2 === 0 ? V + 1 : V;
  const doorX0 = doorB - Math.floor(doorCells / 2), doorX1 = doorX0 + doorCells - 1;
  const doorY0 = wy0, doorY1 = wy0 + 2 * V - 1;
  const boxFill = (x0, x1, y0, y1, z0, z1, t) => {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) grid.set(x, y, z, t);
  };
  const inRing = (x, z) => x === hx0 || x === hx1 || z === hz0 || z === hz1;

  // 小屋主墙略加宽之后，门窗保留原有节奏：两扇前窗对称，两侧窗自动随深度居中。
  // 窗洞：前墙两扇、两侧各一扇，1 个单位见方
  // 窗洞宽度取奇数体素格，保证两窗与房屋中心的镜像轴严格吻合。
  const windowCells = V % 2 === 0 ? V + 1 : V;
  // V=2 的三格窗若沿用旧坐标，会与门框两侧立柱各撞上一列体素。
  // 将左窗限制在外墙角柱与门框外侧之间，右窗沿房屋中轴镜像生成。
  const frontLeftNominal = Math.round(-10.6 * V - (windowCells - 1) / 2);
  const frontLeft0 = Math.max(hx0 + 1, Math.min(frontLeftNominal, doorX0 - windowCells - 1));
  const frontRight0 = hx0 + hx1 - (frontLeft0 + windowCells - 1);
  const side0 = Math.round((hz0 + hz1 - windowCells + 1) / 2);
  const winDefs = [
    { axis: 'z', a0: frontLeft0, wall: hz1 },
    { axis: 'z', a0: frontRight0, wall: hz1 },
    { axis: 'x', a0: side0, wall: hx0 },
    { axis: 'x', a0: side0, wall: hx1 },
  ].map((w) => {
    const y0 = wy0 + 2;
    return { ...w, a1:w.a0 + windowCells - 1, y0, y1:y0 + windowCells - 1,
      dir: (w.axis === 'z' ? w.wall === hz1 : w.wall === hx1) ? 1 : -1 };
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
    for (let k = 1; k <= br; k++) {
      const beamX = x + dx * k, beamY = wy1 - k;
      // 小体素移动版的窗更靠近墙角，前墙斜撑若进入窗洞必须让位。
      // 背面斜撑仍保留，门、窗与屋顶轮廓不动。
      if (!isWindowCell(beamX, beamY, hz1)) grid.set(beamX, beamY, hz1, T.LOG);
      grid.set(beamX, beamY, hz0, T.LOG);
    }
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

  // V3.2 Hero cottage：减轻原屋顶过大外挑，保持两侧严格对称。
  // 墙身不变，屋脊与山墙全部继续共用这一个坡度几何源。
  const ov = Math.max(1, Math.round(V * 0.67));
  const roofY = wy1 + 1;
  // 屋顶从厚实阶梯填充改成真实双坡覆面：仅铺斜面，露出有承重关系的山墙。
  // 同一 ridgeZ / pitch 同时驱动瓦面、山墙、木边框和屋脊；两侧不会再各算各的。
  const ridgeZ = (hz0 + hz1) / 2;
  const roofStartZ = hz0 - ov, roofEndZ = hz1 + ov;
  const roofHalfSpan = (roofEndZ - roofStartZ) / 2;
  const riseAt = (z) => Math.max(0, Math.round(Math.max(0, roofHalfSpan - Math.abs(z - ridgeZ)) * 0.68));
  const roofTop = roofY + riseAt(Math.round(ridgeZ));
  for (let z = roofStartZ; z <= roofEndZ; z++) {
    const surfaceY = roofY + riseAt(z);
    for (let x = hx0 - ov; x <= hx1 + ov; x++) grid.set(x, surfaceY, z, T.THATCH);
    // 两侧外露木质坡沿；这是屋架结构，不是第二层厚厚的茅草屋顶。
    grid.set(hx0 - ov, surfaceY - 1, z, T.LOG);
    grid.set(hx1 + ov, surfaceY - 1, z, T.LOG);
  }
  // 前后屋檐两道连续檐口：实际覆盖住外墙，同时保持屋檐下空间通透。
  for (let x = hx0 - ov; x <= hx1 + ov; x++) {
    grid.set(x, roofY - 1, roofStartZ, T.LOG);
    grid.set(x, roofY - 1, roofEndZ, T.LOG);
  }
  // 山墙内部按斜屋面升起泥墙，沿双坡布置斜向木梁，顶部是完整的木屋架。
  for (const gx of [hx0, hx1]) {
    for (let z = hz0; z <= hz1; z++) {
      const capY = roofY + riseAt(z);
      for (let y = roofY; y < capY; y++) {
        if (!grid.get(gx, y, z)) grid.set(gx, y, z, T.MUD);
      }
      if (capY > roofY) grid.set(gx, capY - 1, z, T.LOG);
    }
    const midZ = Math.round(ridgeZ);
    for (let y = roofY; y < roofTop; y++) {
      if (grid.get(gx, y, midZ) === T.MUD) grid.set(gx, y, midZ, T.LOG);
    }
  }
  // 屋脊单列压条：明确屋顶纵轴，不再产生平直一大块厚瓦面。
  for (let x = hx0 - ov; x <= hx1 + ov; x++) grid.set(x, roofTop + 1, Math.round(ridgeZ), T.RIDGE);
  // 烟囱：石砌 + 帽
  const chimney = { x: HUT.x1 - 1.5, z: HUT.z0 + 2 };
  const chx = Math.round(chimney.x * V), chz = Math.round(chimney.z * V);
  const chTop = roofTop + Math.max(2, Math.round(V * 0.85));
  for (let y = wy0 + 3; y <= chTop; y++) {
    for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) grid.set(chx + i, y, chz + k, T.COBBLE);
  }
  // 烟囱帽由 4×4 缩为 3×3 体素；移动端避免它看起来和小屋半间房一样宽。
  for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) grid.set(chx + i, chTop + 1, chz + k, T.COBBLE);

  // ---- 枣树：根盘 + 三级分枝 + 分离的冠簇 + 挂果 ----
  const tb = TREE;
  const tbx = Math.round(tb.x * V), tbz = Math.round(tb.z * V);
  const W3 = (u) => Math.round(u * V);          // 世界单位 -> 方块

  // 主角树需要真实根基：随细分倍数增加少量向外鼓出的根趾，仍保持低矮。
  const rootRadius = Math.max(1, Math.round(V * 0.62));
  for (let dx = -rootRadius; dx <= rootRadius; dx++) for (let dz = -rootRadius; dz <= rootRadius; dz++) {
    if (dx * dx + dz * dz > rootRadius * rootRadius + 0.2) continue;
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
  // 半径按细分倍数折算：V=2 时同样的「块数」会粗出 1.5 倍，树干会胖成一堵墙
  const TR = V / 3;
  // 枣树体量：根部扎实而树腰渐细，避免粗直柱支撑大云朵。
  // 缩冠时保留 3D 主枝承重层，粗细由树根→树腰→主枝→末梢逐级递减。
  limb(tbx, 0, tbz, tbx + W3(0.08), W3(2.1), tbz + W3(0.05), 2.12 * TR, 1.58 * TR);
  limb(tbx + W3(0.08), W3(2.0), tbz + W3(0.05),
    tbx + W3(0.18), W3(4.1), tbz + W3(0.08), 1.58 * TR, 1.18 * TR);
  const crownArms = [
    {x:-2.35,z:0.92,y:6.28}, {x:2.35,z:-0.78,y:6.38},
    {x:-0.96,z:-2.12,y:6.48}, {x:1.13,z:2.08,y:6.52},
    {x:0.05,z:0.1,y:7.5},
  ];
  for (const arm of crownArms) {
    limb(tbx + W3(0.17), W3(3.62), tbz + W3(0.08),
      tbx + W3(arm.x * 0.66), W3((arm.y + 3.62) / 2),
      tbz + W3(arm.z * 0.65), 1.47 * TR, 1.03 * TR);
    limb(tbx + W3(arm.x * 0.66), W3((arm.y + 3.62) / 2),
      tbz + W3(arm.z * 0.65), tbx + W3(arm.x), W3(arm.y),
      tbz + W3(arm.z), 1.03 * TR, 0.54 * TR);
  }
  // 横向回增有承重的中下层树冠，让枣树形成真实树荫而非顶冠大团。
  // 六个冠团保留负空间，主枝能看见；落果/花仍随真实叶格采样。
  const clusters = [
    {x:0.00,z:0.00,y:7.10,rx:2.04,ry:1.36,rz:1.76},
    {x:-2.04,z:0.73,y:6.90,rx:1.91,ry:1.23,rz:1.49},
    {x:2.15,z:-0.67,y:6.95,rx:1.94,ry:1.21,rz:1.51},
    {x:-0.98,z:-1.76,y:7.08,rx:1.43,ry:1.12,rz:1.46},
    {x:0.97,z:1.78,y:7.09,rx:1.44,ry:1.09,rz:1.48},
    {x:0.16,z:-0.08,y:8.02,rx:1.39,ry:1.07,rz:1.34},
  ];
  const leafCells = [];
  for (let k=0; k<clusters.length; k++) {
    const c=clusters[k];
    const cx=tbx+W3(c.x), cy=W3(c.y), cz=tbz+W3(c.z);
    const rx=Math.max(3,W3(c.rx)), ry=Math.max(3,W3(c.ry)), rz=Math.max(3,W3(c.rz));
    for(let dx=-rx; dx<=rx; dx++) for(let dy=-ry; dy<=ry; dy++) for(let dz=-rz; dz<=rz; dz++){
      const e=(dx/rx)**2+(dy/ry)**2+(dz/rz)**2;
      // 控制体积明暗起伏，但只在轮廓附近扣边，不要挖穿树冠。
      const rough=0.075*(hash3(cx+dx*2,cy+dy*3,cz+dz*2)-0.5);
      if(e>1-rough)continue;
      const x=cx+dx,y=cy+dy,z=cz+dz;
      if(grid.get(x,y,z))continue;
      if(e>0.65 && hash3(x,y,z)<0.14)continue;
      grid.set(x,y,z,T.TLEAF);
      leafCells.push({x,y,z,e,cy,R:Math.max(rx,rz)});
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

  // ---- 草甸野花与水岸芦苇：按生境群落生长，而非在视野内均匀撒彩色点 ----
  const groundFlowers = [];
  const wildflowerPatches = [
    [-17.5, -7.5, 2.9], [-13.8, -3.1, 2.1], [-3.8, -1.8, 2.5],
    [0.1, -9.7, 2.5], [5.4, -10.4, 2.2], [12.6, -11.4, 2.5],
    [12.1, 0.3, 2.4], [1.4, 0.0, 2.1],
  ];
  // 小群落之间保留草地和常走的路：彩色花朵不能占据门、道路、农田或树根。
  for (let i = 0; i < 1500 && groundFlowers.length < 74; i++) {
    const patch = wildflowerPatches[Math.floor(rng() * wildflowerPatches.length)];
    const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * patch[2];
    const x = patch[0] + Math.cos(a) * d, z = patch[1] + Math.sin(a) * d;
    const xb = Math.round(x * V), zb = Math.round(z * V);
    if (getH(xb, zb) !== 0 || grid.get(xb, 0, zb) !== T.GRASS || grid.get(xb, 1, zb)) continue;
    if (isPath(x, z) || inYard(x, z)) continue;
    if (rectDist(HUT_ZONE, x, z) < 0.9 || rectDist(FIELD_ZONE, x, z) < 0.75) continue;
    if (Math.abs(z - riverZ(x)) < RIVER_HALF + 1.35) continue;
    if (Math.hypot(x - TREE.x, z - TREE.z) < 2.35) continue;
    // 群落内部有疏有密，外围逐渐变稀，减少等密度撒点的人工感。
    if (d > patch[2] * 0.76 && rng() > 0.42) continue;
    groundFlowers.push({ x, z, c: rng(), s: 0.65 + rng() * 0.52, v: rng() });
  }
  // 芦苇：成丛长，不要沿河一根一根排成栅栏
  const reeds = [];
  for (let x = -25; x <= 25; x += 1.2 + rng() * 3.4) {
    for (const side of [-1, 1]) {
      if (rng() > 0.58) continue;
      if (x >= PATH_X0 - 3 && x <= PATH_X1 + 3) continue;
      const bx = x + (rng() - 0.5) * 0.7;
      const bz = riverZ(bx) + side * (RIVER_HALF + 0.1 + rng() * 0.55);
      const xb0 = Math.round(bx * V), zb0 = Math.round(bz * V);
      const h0 = getH(xb0, zb0);
      if (h0 !== 0 || grid.get(xb0, 1, zb0)) continue;
      const n = 2 + Math.floor(rng() * 4);
      for (let k = 0; k < n; k++) {
        const a = rng() * Math.PI * 2, rr = rng() * 0.5;
        reeds.push({
          x: bx + Math.cos(a) * rr, z: bz + Math.sin(a) * rr,
          h: 0.32 + rng() * 0.54, v: rng(), a, r: rr,
        });
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

  // 在所有墙、构架、山墙生成之后验证窗洞，捕获中心线检查无法发现的占格重叠。
  const windowObstructions = winDefs.map((w) => {
    let blocked = 0;
    for (let a = w.a0; a <= w.a1; a++) for (let y = w.y0; y <= w.y1; y++) {
      const t = w.axis === 'z' ? grid.get(a, y, w.wall) : grid.get(w.wall, y, a);
      if (t !== T.AIR) blocked++;
    }
    return blocked;
  });

  return {
    grid, getH: heightAtWorld, topAt, windows, chimney: { ...chimney, y: (chTop + 1) / V }, fruitSpots, flowerSpots, groundFlowers, reeds, bridge,
    tufts, lilies, hillShrubs, hillStones, courtyardShrubs, bench,
    windmill: hub ? { hub, ground: wmGround / V, top: wmTop / V } : null,
    door: { x: (doorX0 + doorX1) / 2 / V, z: HUT.z1, width: doorCells / V },
    yard: {
      x: HUT.doorX, z: HUT.z1 + 1.8, pathStartZ: HUT.z1 + 0.3,
      bankDistance: Math.abs(HUT.z1 - riverZ(HUT.doorX)) - RIVER_HALF,
      spurEnd: { x: TREE.x - 1.25, z: (HUT.z1 + 1.82) + 2.24 },
      connectsToTree: isPath(TREE.x - 1.25, (HUT.z1 + 1.82) + 2.24),
      farmApproach: { x: FIELD.x0 - 1.05, z: -8.0 },
      windmillApproach: { x: -8.0, z: -26.2 },
    },
    windowWidth: windowCells / V,
    modelQA: {
      doorCenterError: Math.abs((doorX0 + doorX1) / 2 / V - HUT.doorX),
      frontWindowMirrorError: Math.abs((windows[0].x + windows[1].x) / 2 - HUT.doorX),
      sideWindowAlignError: Math.abs(windows[2].z - windows[3].z),
      windowObstructions,
      totalWindowObstructions: windowObstructions.reduce((sum, n) => sum + n, 0),
      treeCanopyTop: Math.max(...leafCells.map((cell) => cell.y)) / V,
      forestShapeCounts,
      forestGroundRootMode: 'minimal-ground-collar',
      forestGroundedCount,
      forestPedestalViolations,
      benchSeatWorldHeight: Math.max(2, Math.round(0.75 * V)) / V,
      cottageRoofRise: riseAt(Math.round(ridgeZ)) / V,
      cottageRoofAxisError: Math.abs(riseAt(roofStartZ) - riseAt(roofEndZ)),
      heroCanopyDiameter: (Math.max(...leafCells.map(c => c.x)) - Math.min(...leafCells.map(c => c.x))) / V,
      heroCanopyDepth: (Math.max(...leafCells.map(c => c.z)) - Math.min(...leafCells.map(c => c.z))) / V,
      cottageWidth: (hx1 - hx0) / V,
      cottageDepth: (hz1 - hz0) / V,
      windmillDoorOpen,
    },
  };
}

// ---------- 纹理图集 ----------
// 每块贴图两侧带 4px 的重复边。放大时用 Nearest 没问题，但远处会走 mipmap，
// 没有这条护边，线性过滤会把邻格的像素混进边缘 —— 一整片草地就会浮出一层细网格。
export const ATLAS = { TILE: 16, PAD: 4, SLOT: 24, TILES: 16 };
const { TILE, PAD, SLOT, TILES } = ATLAS;
export const TILE_ID = { NOISE: 0, STONE: 1, PLANK: 2, LOG: 3, LOGTOP: 4, THATCH: 5, LEAF: 6, MUD: 7, GRAVEL: 8, GRASS: 9, HILL_GRASS: 10 };

export function makeAtlas() {
  const cv = document.createElement('canvas');
  cv.width = SLOT * TILES; cv.height = TILE + 2 * PAD;
  const g = cv.getContext('2d');
  const rnd = mulberry32(7);
  const px = (tile, x, y, v) => {
    const c = Math.max(0, Math.min(255, Math.round(v * 255)));
    g.fillStyle = `rgb(${c},${c},${c})`;
    g.fillRect(tile * SLOT + PAD + x, PAD + y, 1, 1);
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
    px(8, x, y, r < 0.24 ? 0.86 : 0.95 + rnd() * 0.05);
    px(9, x, y, r < 0.05 ? 0.968 : 0.986 + rnd() * 0.014);
    // 高坡专用柔和纹理：抑制小方块在远景不断重复产生的亮暗细条纹。
    // 保留近景草地原纹理，让河边仍有细节与层次。
    px(10, x, y, 0.991 + 0.008 * fbm(x * 0.14 + 8, y * 0.14 - 6));
  }
  // 护边：把每格的边缘像素往外复制一圈
  const img = g.getImageData(0, 0, cv.width, cv.height);
  const put = (x, y, sx, sy) => {
    const a = (sy * cv.width + sx) * 4, b = (y * cv.width + x) * 4;
    img.data[b] = img.data[a]; img.data[b + 1] = img.data[a + 1];
    img.data[b + 2] = img.data[a + 2]; img.data[b + 3] = 255;
  };
  for (let tile = 0; tile < TILES; tile++) {
    const x0 = tile * SLOT + PAD;
    for (let y = 0; y < TILE; y++) {
      for (let k = 1; k <= PAD; k++) {
        put(x0 - k, PAD + y, x0, PAD + y);
        put(x0 + TILE - 1 + k, PAD + y, x0 + TILE - 1, PAD + y);
      }
    }
    for (let x = x0 - PAD; x < x0 + TILE + PAD; x++) {
      put(x, PAD - 1, x, PAD);
      put(x, PAD + TILE, x, PAD + TILE - 1);
    }
  }
  g.putImageData(img, 0, 0);
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

function tileFor(t, dir, y) {
  const top = dir === 2 || dir === 3;
  switch (t) {
    // 顶面和侧面用同一张图：两张图平均亮度不同，台阶坡面会交替成棋盘格
    case T.GRASS: return y >= 2 * V ? TILE_ID.HILL_GRASS : TILE_ID.GRASS;
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
// 绘本配色的关键是「明度分层」：地面最亮、草与树最深、房子在中间调。
// 之前四季都挤在中明度的黄绿调里，远看就糊成一团。
const PALETTE = {
  spring: { grass: C('#abc49b'), grassDry: C('#c5ba96'), grassCool: C('#8fb8a5'), leafA: C('#83ab81'), leafB: C('#a2b98f'), leafC: C('#648c76'), tleaf: C('#99b58b'), thatch: C('#e5cfaa'), crop: C('#91ac78') },
  summer: { grass: C('#90ac83'), grassDry: C('#b5b08a'), grassCool: C('#749b8b'), leafA: C('#668e72'), leafB: C('#8fa885'), leafC: C('#4f786d'), tleaf: C('#789a80'), thatch: C('#dcc398'), crop: C('#9aa877') },
  autumn: { grass: C('#dcc878'), leafA: C('#d99a54'), leafB: C('#c07a47'), leafC: C('#4f7d50'), tleaf: C('#c9a259'), thatch: C('#e0bd7f'), crop: C('#d19b33') },
  winter: { grass: C('#f2f7fb'), leafA: C('#8b857a'), leafB: C('#8b857a'), leafC: C('#3f6647'), tleaf: C('#8b857a'), thatch: C('#c8a672'), crop: C('#b9a37e') },
};
const FIXED = {
  dirt: C('#9c7352'), stone: C('#968d80'), sand: C('#d8caa9'), path: C('#bfae8e'), log: C('#7a5c42'), logTop: C('#b0916a'),
  mud: C('#f8f0dc'), plank: C('#c79b69'), cobble: C('#a49b88'), mlog: C('#6d5238'), tlog: C('#8a6e50'), tlogTop: C('#9d7d5e'),
  snow: C('#f7fbff'), autumnYellow: C('#eec13c'), wetsand: C('#aa9f89'), soil: C('#a07b5e'), scree: C('#aca69b'),
};
// 雪线按「世界高度」算，faceColor 里再乘回 V（方块坐标）
const SNOW_LINE = { spring: 99, summer: 99, autumn: 99, winter: -99 };

const tmp = new THREE.Color(), tmpSide = new THREE.Color();
function faceColor(t, dir, y, v, season, out, tint = 0.5) {
  const p = PALETTE[season];
  const yw = y / V;
  const snowy = dir === 2 && t !== T.WATER && (season === 'winter' ? t !== T.TLEAF : yw >= SNOW_LINE[season] && (t === T.STONE || t === T.GRASS || t === T.DIRT));
  if (snowy && !(t === T.MUD)) { out.copy(FIXED.snow); return out; }
  switch (t) {
    // 侧面直接用草色压暗一点。原来掺土色，方块减半后每一级台阶都会变成一条褐色横纹
    case T.GRASS:
      out.copy(season === 'winter' ? FIXED.snow : p.grass);
      // 春夏用低频整片冷暖草地，而不是逐格棋盘色差；山丘随之有自然色带。
      if (p.grassDry) {
        const dry = smoothstep(0.51, 0.68, tint);
        const cool = 1 - smoothstep(0.32, 0.48, tint);
        out.lerp(p.grassDry, dry * 0.55);
        out.lerp(p.grassCool, cool * 0.48);
      }
      break;
    case T.DIRT: out.copy(FIXED.dirt); break;
    // 岩体：高度做沉积层理，越高越偏冷；再叠一层低频斑驳当风化
    case T.STONE: out.copy(FIXED.stone).multiplyScalar(0.94 + v * 0.1); break;
    case T.SAND: out.copy(FIXED.sand); break;
    case T.WETSAND: out.copy(FIXED.wetsand); break;
    case T.SOIL: out.copy(FIXED.soil); break;
    case T.SCREE: out.copy(FIXED.scree).multiplyScalar(0.96 + 0.05 * Math.sin(yw * 3 + v)); break;
    case T.CROP: out.copy(p.crop); if (season === 'winter') out.lerp(FIXED.snow, 0.25); break;
    case T.PATH: out.copy(FIXED.path); break;
    case T.LOG: out.copy(dir === 2 || dir === 3 ? FIXED.logTop : FIXED.log); break;
    case T.MUD: out.copy(FIXED.mud); break;
    case T.PLANK: out.copy(FIXED.plank); break;
    case T.THATCH: out.copy(p.thatch); break;
    case T.RIDGE: out.copy(p.thatch).multiplyScalar(0.84); break;
    case T.COBBLE: out.copy(FIXED.cobble); break;
    case T.MLOG: out.copy(FIXED.mlog); break;
    case T.TLOG: out.copy(dir === 2 || dir === 3 ? FIXED.tlogTop : FIXED.tlog); break;
    case T.LEAF_A: out.copy(p.leafA); if (season === 'autumn' && v > 0.6) out.lerp(FIXED.autumnYellow, 0.6); break;
    case T.LEAF_B: out.copy(p.leafB); if (season === 'autumn' && v > 0.7) out.lerp(p.leafA, 0.5); break;
    case T.LEAF_C: out.copy(p.leafC); break;
    case T.TLEAF: out.copy(p.tleaf); if (season === 'autumn' && v > 0.55) out.lerp(FIXED.autumnYellow, 0.5); break;
    default: out.setRGB(1, 0, 1);
  }
  // 冠部受光：叶子从下往上提亮，树冠才不是一颗纯色球
  if (isLeaf(t)) out.multiplyScalar(0.82 + 0.3 * smoothstep(3, 11, yw));
  // 方块越小，逐块明暗差越要收敛，否则整片地形会变成噪点
  // 地表不做逐块色差：方块只有 4-8 像素时，这点差异会织成一层布纹
  const k = isGround(t) ? 1 : 0.975 + v * 0.05;
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
export function buildMesh(grid, filter, origin = [0, 0, 0], skipFarTerrain = false) {
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
        if (skipFarTerrain && isGround(t) && isDistantSlopeColumn(x,z)) continue;
        const v = hash3(x, y, z);
        for (let f = 0; f < 6; f++) {
          const dir = DIRS[f];
          const nx = x + dir.n[0], ny = y + dir.n[1], nz = z + dir.n[2];
          const nb = grid.get(nx, ny, nz);
          if (t === T.WATER) { if (nb === T.WATER || occludes(t, nb)) continue; }
          else if (occludes(t, nb)) continue;
          const tile = tileFor(t, f, y);
          // 图集带护边，UV 直接取格子边界：mipmap 混到的是自己边缘的复制像素，不是邻格
          const u0 = (tile * SLOT + PAD) / (SLOT * TILES), u1 = (tile * SLOT + PAD + TILE) / (SLOT * TILES);
          const v0 = PAD / (TILE + 2 * PAD), v1 = (PAD + TILE) / (TILE + 2 * PAD);
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
            uv.push(UVS[k][0] ? u1 : u0, UVS[k][1] ? v1 : v0);
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
      faceColor(meta[m], meta[m + 1], meta[m + 2], meta[m + 3], season, tmp, meta[m + 4]);
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


// 远景坡面 LOD：只替换小屋后方的北向山地表层。
// 地形格与 W.getH 的整数体素高度不变，因此现有树、建筑、碰撞仍使用原来的坐标。
// 边界处保留半格体素过渡，避免与前景/河岸的规则混用。
const LOD_NORTH_EDGE = -24 * V;
export function isDistantSlopeColumn(x, z) {
  // Use a contiguous background region. Radial inner masks left crescent cracks.
  // Keep a 3-world-unit voxel rim so the circular map edge never opens.
  return z <= LOD_NORTH_EDGE && x * x + z * z < ((R - 3) * V) ** 2;
}

export function buildDistantSlopeLOD({ grid, getH }) {
  const positions = [], colors = [], indices = [], shades = [];
  const step = 2; // 比原始体素面更稀疏；每两个小方格共享三角形坡面
  const yAt = (x, z) => getH(x / V, z / V) + 0.5 / V;
  // Surface samples retain exact height at their sample locations. Objects and
  // collisions remain attached to the untouched underlying voxel world.
  const verts = new Map();
  const vertex = (x, z) => {
    const key = x + ':' + z;
    if (verts.has(key)) return verts.get(key);
    const y = yAt(x, z);
    const idx = positions.length / 3;
    positions.push(x / V, y + 0.016, z / V);
    colors.push(1, 1, 1);
    const h = Math.round(getH(x / V, z / V) * V);
    const material = grid.get(x, h, z);
    shades.push(material === T.STONE || material === T.SCREE ? material : T.GRASS,
      h, hash3(x, h, z), fbm(x * 0.028 + 11, z * 0.028 - 4));
    verts.set(key, idx);
    return idx;
  };
  const min = -R * V, max = R * V;
  for (let x = min; x + step <= max; x += step) {
    for (let z = min; z + step <= -22 * V; z += step) {
      const corners = [[x,z],[x+step,z],[x+step,z+step],[x,z+step]];
      // Coverage extends past the removed voxel region by ~2 world units,
      // so the smooth surface has a physical overlap instead of an empty seam.
      if (!corners.every(([cx,cz]) => cx*cx+cz*cz < ((R - 1) * V)**2)) continue;
      const [a,b,c,d] = corners.map(([cx,cz]) => vertex(cx,cz));
      // CCW winding when viewed from above.
      indices.push(a,c,b, a,d,c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  const colorAttr = new THREE.Float32BufferAttribute(colors,3);
  geometry.setAttribute('color',colorAttr);
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const color = new THREE.Color();
  function recolor(season) {
    const out = colorAttr.array;
    for (let i=0; i<shades.length; i+=4) {
      const [t,h,v,tint] = shades.slice(i,i+4);
      faceColor(t,2,h,v,season,color,tint);
      const p=i / 4 * 3;
      out[p]=color.r;out[p+1]=color.g;out[p+2]=color.b;
    }
    colorAttr.needsUpdate=true;
  }
  return {geometry,recolor,faces:indices.length/3};
}

export const filters = {
  world: (t) => t !== T.WATER && t !== T.TLOG && t !== T.TLEAF,
  water: (t) => t === T.WATER,
  trunk: (t) => t === T.TLOG,
  leaves: (t) => t === T.TLEAF,
};
