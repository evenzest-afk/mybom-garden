/**
 * FlowerSVG — 꽃 SVG 렌더러 (모바일 결과 화면 / 사이니지 공용)
 * 사용: FlowerSVG.render(flower, variantIndex, { seed, stem })
 *  - flower: flowers.json 의 항목 (shape, palettes 포함)
 *  - 반환: <svg> 문자열, viewBox 0 0 200 280 (꽃송이 중심 약 (100, 88))
 * 스타일: 부드러운 플랫 일러스트 + 꽃잎 그라데이션, 약간의 손그림 느낌(시드 기반 흔들림)
 */
(function (global) {
  'use strict';

  let uidCounter = 0;

  // 시드 기반 난수 (같은 꽃은 항상 같은 모양 — 사이니지 재렌더 대비)
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const STEM = '#5E9E57';
  const STEM_DEEP = '#487F45';
  const LEAF = '#6FAE63';
  const LEAF_DEEP = '#549150';

  function rot(deg, cx, cy) {
    return `transform="rotate(${deg.toFixed(2)} ${cx} ${cy})"`;
  }

  // ---- 꽃잎 패스 ----------------------------------------------------------
  // 기준: (0,0)에서 위쪽(-len)으로 뻗는 꽃잎. 호출부에서 translate/rotate.
  function petalPath(len, w, opts = {}) {
    const hw = w / 2;
    if (opts.notch) {
      // 끝이 살짝 갈라진 꽃잎 (코스모스)
      return `M0 0 C ${hw * 1.1} ${-len * 0.3}, ${hw} ${-len * 0.85}, ${hw * 0.35} ${-len}
        L ${hw * 0.18} ${-len * 0.92} L 0 ${-len} L ${-hw * 0.18} ${-len * 0.92} L ${-hw * 0.35} ${-len}
        C ${-hw} ${-len * 0.85}, ${-hw * 1.1} ${-len * 0.3}, 0 0 Z`;
    }
    if (opts.pointed) {
      // 끝이 뾰족한 꽃잎 (별 모양)
      return `M0 0 C ${hw} ${-len * 0.25}, ${hw * 0.55} ${-len * 0.7}, 0 ${-len}
        C ${-hw * 0.55} ${-len * 0.7}, ${-hw} ${-len * 0.25}, 0 0 Z`;
    }
    if (opts.round) {
      // 둥근 꽃잎 (작약/장미 계열)
      return `M0 0 C ${hw * 1.25} ${-len * 0.2}, ${hw * 1.1} ${-len * 0.95}, 0 ${-len}
        C ${-hw * 1.1} ${-len * 0.95}, ${-hw * 1.25} ${-len * 0.2}, 0 0 Z`;
    }
    // 기본: 끝이 부드럽게 둥근 긴 꽃잎
    return `M0 0 C ${hw * 1.05} ${-len * 0.28}, ${hw * 0.92} ${-len * 0.78}, 0 ${-len}
      C ${-hw * 0.92} ${-len * 0.78}, ${-hw * 1.05} ${-len * 0.28}, 0 0 Z`;
  }

  function heartLeafPath(len) {
    // 클로버 잎 (하트형)
    const w = len * 0.9;
    return `M0 0 C ${w * 0.7} ${-len * 0.15}, ${w * 0.62} ${-len * 0.95}, 0 ${-len * 0.72}
      C ${-w * 0.62} ${-len * 0.95}, ${-w * 0.7} ${-len * 0.15}, 0 0 Z`;
  }

  // ---- 공통 파츠 ----------------------------------------------------------
  function stemAndLeaves(rng, cx, topY, opts = {}) {
    const sway = (rng() - 0.5) * 14;
    const bottom = 272;
    const midY = (topY + bottom) / 2;
    const stem = `<path d="M${cx} ${topY} C ${cx + sway} ${midY}, ${cx - sway * 0.6} ${midY + 40}, ${cx} ${bottom}"
      fill="none" stroke="${STEM}" stroke-width="3.6" stroke-linecap="round"/>`;
    if (opts.noLeaves) return stem;
    const ly1 = midY + 8 + rng() * 14;
    const ly2 = midY + 38 + rng() * 12;
    const leaf = (x, y, dir, s) => `<path d="M${x} ${y}
        C ${x + 20 * dir * s} ${y - 13 * s}, ${x + 32 * dir * s} ${y - 2 * s}, ${x + 24 * dir * s} ${y + 8 * s}
        C ${x + 14 * dir * s} ${y + 11 * s}, ${x + 3 * dir} ${y + 6 * s}, ${x} ${y} Z"
        fill="${LEAF}" stroke="${LEAF_DEEP}" stroke-width="1"/>`;
    return stem + leaf(cx, ly1, 1, 0.95 + rng() * 0.2) + leaf(cx, ly2, -1, 0.85 + rng() * 0.2);
  }

  function grad(uid, idx, light, deep, kind = 'linear') {
    const id = `fg${uid}-${idx}`;
    if (kind === 'radial') {
      return {
        id,
        def: `<radialGradient id="${id}" cx="50%" cy="42%" r="65%">
          <stop offset="0%" stop-color="${light}"/><stop offset="100%" stop-color="${deep}"/></radialGradient>`,
      };
    }
    return {
      id,
      def: `<linearGradient id="${id}" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="${deep}"/><stop offset="55%" stop-color="${light}"/></linearGradient>`,
    };
  }

  function centerDisc(cx, cy, r, color, rng, opts = {}) {
    let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`;
    if (opts.seeds) {
      // 해바라기 씨앗 질감
      for (let i = 0; i < 26; i++) {
        const a = rng() * Math.PI * 2;
        const rr = Math.sqrt(rng()) * r * 0.8;
        s += `<circle cx="${(cx + Math.cos(a) * rr).toFixed(1)}" cy="${(cy + Math.sin(a) * rr).toFixed(1)}" r="1.6" fill="rgba(0,0,0,0.22)"/>`;
      }
    } else {
      s += `<circle cx="${cx - r * 0.28}" cy="${cy - r * 0.3}" r="${r * 0.32}" fill="rgba(255,255,255,0.35)"/>`;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + rng();
        s += `<circle cx="${(cx + Math.cos(a) * r * 0.62).toFixed(1)}" cy="${(cy + Math.sin(a) * r * 0.62).toFixed(1)}" r="1.5" fill="rgba(0,0,0,0.15)"/>`;
      }
    }
    return s;
  }

  // ---- 형태별 렌더 --------------------------------------------------------
  const SHAPES = {

    daisy(sh, pal, rng, uid) {
      const cx = 100, cy = 88;
      const g = grad(uid, 0, pal.petal, pal.petalDeep);
      let petals = '';
      const n = sh.petals;
      for (let i = 0; i < n; i++) {
        const ang = (360 / n) * i + (rng() - 0.5) * (180 / n) * 0.5;
        const len = sh.len * (0.92 + rng() * 0.16);
        petals += `<path d="${petalPath(len, sh.w, { notch: sh.notch })}" fill="url(#${g.id})"
          stroke="${pal.petalDeep}" stroke-width="0.8" stroke-opacity="0.5"
          transform="translate(${cx} ${cy}) rotate(${ang.toFixed(1)})"/>`;
      }
      let inner = '';
      if (sh.innerRing) {
        const g2 = grad(uid, 1, pal.petalDeep, pal.petal);
        for (let i = 0; i < n; i++) {
          const ang = (360 / n) * i + 180 / n;
          inner += `<path d="${petalPath(sh.len * 0.45, sh.w * 0.8)}" fill="url(#${g2.id})"
            transform="translate(${cx} ${cy}) rotate(${ang.toFixed(1)})"/>`;
        }
        inner = `<defs>${g2.def}</defs>` + inner;
      }
      const centerR = sh.centerR;
      const center = sh.domed
        ? `<ellipse cx="${cx}" cy="${cy - 2}" rx="${centerR}" ry="${centerR * 1.15}" fill="${pal.center}"/>
           <ellipse cx="${cx - 3}" cy="${cy - 6}" rx="${centerR * 0.35}" ry="${centerR * 0.4}" fill="rgba(255,255,255,0.4)"/>`
        : centerDisc(cx, cy, centerR, pal.center, rng, { seeds: sh.seedCenter });
      return { defs: g.def, body: stemAndLeaves(rng, cx, cy + 10) + petals + inner + center, topY: cy };
    },

    pom(sh, pal, rng, uid) {
      const cx = 100, cy = 90;
      const g = grad(uid, 0, pal.petal, pal.petalDeep);
      let s = '';
      const scales = [1, 0.72, 0.46].slice(0, sh.rings);
      scales.forEach((sc, ring) => {
        const n = Math.round(sh.petals * (ring === 0 ? 1 : 0.75));
        for (let i = 0; i < n; i++) {
          const ang = (360 / n) * i + ring * 9 + (rng() - 0.5) * 6;
          s += `<path d="${petalPath(sh.len * sc * (0.94 + rng() * 0.12), sh.len * sc * 0.30)}"
            fill="url(#${g.id})" transform="translate(${cx} ${cy}) rotate(${ang.toFixed(1)})"/>`;
        }
      });
      s += `<circle cx="${cx}" cy="${cy}" r="${sh.centerR}" fill="${pal.center}"/>`;
      return { defs: g.def, body: stemAndLeaves(rng, cx, cy + 8) + s, topY: cy };
    },

    violet(sh, pal, rng, uid) {
      const cx = 100, cy = 92, L = sh.len;
      const g = grad(uid, 0, pal.petal, pal.petalDeep, 'radial');
      const p = (ang, len, w) => `<path d="${petalPath(len, w, { round: true })}"
        fill="url(#${g.id})" stroke="${pal.petalDeep}" stroke-width="0.8" stroke-opacity="0.45"
        transform="translate(${cx} ${cy}) rotate(${ang})"/>`;
      let s = '';
      s += p(-28, L, L * 0.72) + p(28, L, L * 0.72);          // 위 두 장
      s += p(-95, L * 0.85, L * 0.6) + p(95, L * 0.85, L * 0.6); // 옆 두 장
      s += p(180, L * 1.05, L * 0.95);                          // 아래 큰 잎
      if (sh.face) {
        s += `<path d="${petalPath(L * 0.55, L * 0.5, { round: true })}" fill="rgba(60,35,90,0.55)"
          transform="translate(${cx} ${cy}) rotate(180)"/>`;
      }
      s += `<circle cx="${cx}" cy="${cy}" r="5.5" fill="${pal.center}"/>
            <path d="M${cx - 3} ${cy + 3} L${cx} ${cy + 7} L${cx + 3} ${cy + 3}" fill="none" stroke="${pal.center}" stroke-width="2" stroke-linecap="round"/>`;
      return { defs: g.def, body: stemAndLeaves(rng, cx, cy + 8) + s, topY: cy };
    },

    tulip(sh, pal, rng, uid) {
      const cx = 100, cy = 118, L = sh.len, W = sh.w;
      const g = grad(uid, 0, pal.petal, pal.petalDeep);
      const gLight = grad(uid, 1, pal.center, pal.petal);
      const cup = `M${cx - W / 2} ${cy - L * 0.55}
        C ${cx - W / 2 - 6} ${cy - L * 0.1}, ${cx - W * 0.3} ${cy}, ${cx} ${cy}
        C ${cx + W * 0.3} ${cy}, ${cx + W / 2 + 6} ${cy - L * 0.1}, ${cx + W / 2} ${cy - L * 0.55}
        C ${cx + W / 2} ${cy - L * 0.95}, ${cx + W * 0.22} ${cy - L}, ${cx + W * 0.18} ${cy - L * 0.72}`;
      const s = `
        <path d="M${cx - W * 0.32} ${cy - L * 0.9} C ${cx - W * 0.1} ${cy - L * 1.08}, ${cx + W * 0.1} ${cy - L * 1.08}, ${cx + W * 0.32} ${cy - L * 0.9}
          L ${cx + W * 0.34} ${cy - L * 0.4} L ${cx - W * 0.34} ${cy - L * 0.4} Z" fill="url(#${gLight.id})"/>
        <path d="M${cx - W / 2} ${cy - L * 0.6} C ${cx - W / 2 - 5} ${cy - L * 0.15}, ${cx - W * 0.28} ${cy}, ${cx - W * 0.02} ${cy}
          L ${cx - W * 0.05} ${cy - L * 0.55} C ${cx - W * 0.12} ${cy - L * 0.98}, ${cx - W * 0.42} ${cy - L * 0.92}, ${cx - W / 2} ${cy - L * 0.6} Z"
          fill="url(#${g.id})" stroke="${pal.petalDeep}" stroke-width="0.8" stroke-opacity="0.4"/>
        <path d="M${cx + W / 2} ${cy - L * 0.6} C ${cx + W / 2 + 5} ${cy - L * 0.15}, ${cx + W * 0.28} ${cy}, ${cx + W * 0.02} ${cy}
          L ${cx + W * 0.05} ${cy - L * 0.55} C ${cx + W * 0.12} ${cy - L * 0.98}, ${cx + W * 0.42} ${cy - L * 0.92}, ${cx + W / 2} ${cy - L * 0.6} Z"
          fill="url(#${g.id})" stroke="${pal.petalDeep}" stroke-width="0.8" stroke-opacity="0.4"/>
        <path d="M${cx - W * 0.05} ${cy} C ${cx - W * 0.02} ${cy - L * 0.5}, ${cx + W * 0.02} ${cy - L * 0.5}, ${cx + W * 0.05} ${cy}" fill="${pal.petalDeep}" opacity="0.25"/>`;
      void cup;
      return { defs: g.def + gLight.def, body: stemAndLeaves(rng, cx, cy - 4) + s, topY: cy };
    },

    star(sh, pal, rng, uid) {
      const cx = 100, cy = 90;
      const g = grad(uid, 0, pal.petal, pal.petalDeep);
      let s = '';
      const n = sh.petals;
      for (let i = 0; i < n; i++) {
        const ang = (360 / n) * i + (rng() - 0.5) * 8;
        s += `<path d="${petalPath(sh.len * (0.93 + rng() * 0.14), sh.w, { pointed: true })}"
          fill="url(#${g.id})" stroke="${pal.petalDeep}" stroke-width="0.7" stroke-opacity="0.5"
          transform="translate(${cx} ${cy}) rotate(${ang.toFixed(1)})"/>`;
      }
      if (sh.fuzzy) {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          s += `<circle cx="${(cx + Math.cos(a) * 7).toFixed(1)}" cy="${(cy + Math.sin(a) * 7).toFixed(1)}" r="3.4" fill="${pal.center}"/>`;
        }
        s += `<circle cx="${cx}" cy="${cy}" r="4" fill="${pal.center}"/>`;
      } else {
        s += centerDisc(cx, cy, 8, pal.center, rng);
      }
      return { defs: g.def, body: stemAndLeaves(rng, cx, cy + 8) + s, topY: cy };
    },

    cluster(sh, pal, rng, uid) {
      const cx = 100, cy = 88;
      const g = grad(uid, 0, pal.petal, pal.petalDeep, 'radial');
      let s = '';
      const pts = [];
      for (let i = 0; i < sh.florets; i++) {
        const a = rng() * Math.PI * 2;
        const rr = Math.sqrt(rng()) * sh.spread;
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.85]);
      }
      pts.sort((p, q) => p[1] - q[1]);
      for (const [fx, fy] of pts) {
        const fr = sh.floretR * (0.85 + rng() * 0.3);
        let f = '';
        for (let k = 0; k < sh.petalsPer; k++) {
          const ang = (360 / sh.petalsPer) * k + rng() * 20;
          f += `<path d="${petalPath(fr, fr * 0.75, { round: true })}" fill="url(#${g.id})"
            stroke="${pal.petalDeep}" stroke-width="0.6" stroke-opacity="0.4"
            transform="translate(${fx.toFixed(1)} ${fy.toFixed(1)}) rotate(${ang.toFixed(1)})"/>`;
        }
        f += `<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="${(fr * 0.22).toFixed(1)}" fill="${pal.center}"/>`;
        s += f;
      }
      return { defs: g.def, body: stemAndLeaves(rng, cx, cy + sh.spread * 0.7) + s, topY: cy };
    },

    funnel(sh, pal, rng, uid) {
      const cx = 100, cy = 92, R = sh.w / 2 + 8;
      const g = grad(uid, 0, pal.petal, pal.petalDeep, 'radial');
      const one = (fx, fy, r) => {
        let f = `<circle cx="${fx}" cy="${fy}" r="${r}" fill="url(#${g.id})" stroke="${pal.petalDeep}" stroke-width="1" stroke-opacity="0.5"/>`;
        // 꽃잎 주름(5갈래)
        for (let k = 0; k < 5; k++) {
          const a = -90 + k * 72;
          const rad = (a * Math.PI) / 180;
          f += `<path d="M${fx} ${fy} L ${(fx + Math.cos(rad) * r * 0.96).toFixed(1)} ${(fy + Math.sin(rad) * r * 0.96).toFixed(1)}"
            stroke="${pal.petalDeep}" stroke-width="1" stroke-opacity="0.35"/>`;
          const scallopA = ((a + 36) * Math.PI) / 180;
          f += `<circle cx="${(fx + Math.cos(scallopA) * r * 0.78).toFixed(1)}" cy="${(fy + Math.sin(scallopA) * r * 0.78).toFixed(1)}" r="${r * 0.3}" fill="url(#${g.id})"/>`;
        }
        if (sh.star) {
          const pts = [];
          for (let k = 0; k < 10; k++) {
            const rr = k % 2 === 0 ? r * 0.85 : r * 0.34;
            const a = (-90 + k * 36) * (Math.PI / 180);
            pts.push(`${(fx + Math.cos(a) * rr).toFixed(1)},${(fy + Math.sin(a) * rr).toFixed(1)}`);
          }
          f += `<polygon points="${pts.join(' ')}" fill="${pal.center}" opacity="0.85"/>`;
        }
        f += `<circle cx="${fx}" cy="${fy}" r="${r * 0.2}" fill="${sh.star ? pal.petalDeep : pal.center}"/>`;
        return f;
      };
      let s = '';
      if (sh.blooms === 1) {
        s = one(cx, cy, R);
        return { defs: g.def, body: stemAndLeaves(rng, cx, cy + R * 0.7) + s, topY: cy };
      }
      // 프리지아처럼 3송이
      const offs = [[-30, 12, 0.72], [30, 8, 0.8], [0, -8, 1]];
      let stems = '';
      for (const [dx, dy, sc] of offs) {
        stems += `<path d="M${cx + dx} ${cy + dy} Q ${cx + dx * 0.4} ${cy + 34}, ${cx} ${cy + 46}"
          fill="none" stroke="${STEM}" stroke-width="3.4" stroke-linecap="round"/>`;
      }
      for (const [dx, dy, sc] of offs) s += one(cx + dx, cy + dy, R * sc * 0.62);
      return { defs: g.def, body: stemAndLeaves(rng, cx, cy + 44) + stems + s, topY: cy };
    },

    cup(sh, pal, rng, uid) {
      const cx = 100, cy = 90;
      const g = grad(uid, 0, pal.petal, pal.petalDeep, 'radial');
      let s = '';
      if (sh.glow) {
        const gid = `glow${uid}`;
        s += `<defs><radialGradient id="${gid}"><stop offset="0%" stop-color="${pal.petal}" stop-opacity="0.55"/>
          <stop offset="100%" stop-color="${pal.petal}" stop-opacity="0"/></radialGradient></defs>
          <circle cx="${cx}" cy="${cy}" r="${sh.len * 1.5}" fill="url(#${gid})"/>`;
      }
      const n = sh.petals;
      for (let i = 0; i < n; i++) {
        const ang = (360 / n) * i + (n % 2 ? 0 : 180 / n) + (rng() - 0.5) * 7;
        s += `<path d="${petalPath(sh.len * (0.94 + rng() * 0.12), sh.w, { round: true, notch: sh.notch })}"
          fill="url(#${g.id})" stroke="${pal.petalDeep}" stroke-width="0.9" stroke-opacity="0.45"
          transform="translate(${cx} ${cy}) rotate(${ang.toFixed(1)})"/>`;
      }
      s += centerDisc(cx, cy, sh.len * 0.2, pal.center, rng);
      const stem = sh.branch
        ? `<path d="M${cx} ${cy + 8} C ${cx + 26} ${cy + 60}, ${cx + 10} ${cy + 120}, ${cx + 4} ${cy + 180}"
            fill="none" stroke="#8A6242" stroke-width="5" stroke-linecap="round"/>`
        : stemAndLeaves(rng, cx, cy + 8);
      return { defs: g.def, body: stem + s, topY: cy };
    },

    layered(sh, pal, rng, uid) {
      const cx = 100, cy = 88;
      const g = grad(uid, 0, pal.petal, pal.petalDeep);
      const gIn = grad(uid, 1, pal.petal, pal.petalDeep, 'radial');
      let s = '';
      for (let ring = 0; ring < sh.layers; ring++) {
        const sc = 1 - ring * (0.78 / sh.layers);
        const n = Math.max(5, sh.petals - ring);
        for (let i = 0; i < n; i++) {
          const ang = (360 / n) * i + ring * (180 / n) + (rng() - 0.5) * 5;
          s += `<path d="${petalPath(sh.len * sc * (0.95 + rng() * 0.1), sh.w * (sc * 0.8 + 0.35), { round: sh.round })}"
            fill="url(#${ring >= sh.layers - 2 ? gIn.id : g.id})"
            stroke="${pal.petalDeep}" stroke-width="0.7" stroke-opacity="0.45"
            transform="translate(${cx} ${cy}) rotate(${ang.toFixed(1)})"/>`;
        }
      }
      s += `<circle cx="${cx}" cy="${cy}" r="${sh.centerR}" fill="${pal.center}"/>`;
      return { defs: g.def + gIn.def, body: stemAndLeaves(rng, cx, cy + 10) + s, topY: cy };
    },

    bell(sh, pal, rng, uid) {
      const g = grad(uid, 0, pal.petal, pal.petalDeep);
      const bellPath = (bx, by, w, l) => `
        <path d="M${bx - w / 2} ${by} C ${bx - w / 2 - 2} ${by + l * 0.6}, ${bx - w * 0.42} ${by + l * 0.85}, ${bx - w * 0.34} ${by + l}
          L ${bx - w * 0.12} ${by + l * 0.9} L ${bx + w * 0.12} ${by + l * 1.02} L ${bx + w * 0.34} ${by + l * 0.92}
          C ${bx + w * 0.42} ${by + l * 0.85}, ${bx + w / 2 + 2} ${by + l * 0.6}, ${bx + w / 2} ${by}
          C ${bx + w * 0.2} ${by - l * 0.16}, ${bx - w * 0.2} ${by - l * 0.16}, ${bx - w / 2} ${by} Z"
          fill="url(#${g.id})" stroke="${pal.petalDeep}" stroke-width="1.2" stroke-opacity="0.9"/>`;
      let s = '';
      if (sh.arc) {
        // 은방울꽃: 휘어진 줄기에 방울 여러 개
        const path = 'M100 250 C 96 190, 92 150, 74 118 C 66 104, 70 92, 84 84';
        s += `<path d="${path}" fill="none" stroke="${STEM}" stroke-width="4.5" stroke-linecap="round"/>`;
        const pts = [[84, 92], [80, 116], [88, 140], [98, 164]].slice(0, sh.bells);
        for (const [bx, by] of pts) {
          s += `<path d="M${bx} ${by - 8} Q ${bx + 10} ${by - 4}, ${bx + 12} ${by}" fill="none" stroke="${STEM}" stroke-width="2"/>`;
          s += bellPath(bx + 12, by, sh.w, sh.len);
        }
        s += `<path d="M106 250 C 116 206, 122 170, 118 128 C 138 156, 132 214, 112 252 Z" fill="${LEAF}" stroke="${LEAF_DEEP}" stroke-width="1" opacity="0.9"/>`;
        return { defs: g.def, body: s, topY: 84 };
      }
      // 초롱꽃: 아래를 보는 종 1~2개
      const cx = 100, cy = 84;
      s += stemAndLeaves(rng, cx, cy);
      s += `<path d="M${cx} ${cy} Q ${cx - 18} ${cy + 2}, ${cx - 22} ${cy + 10}" fill="none" stroke="${STEM}" stroke-width="3"/>`;
      s += bellPath(cx - 22, cy + 8, sh.w, sh.len);
      if (sh.bells > 1) {
        s += `<path d="M${cx} ${cy} Q ${cx + 16} ${cy - 6}, ${cx + 22} ${cy - 2}" fill="none" stroke="${STEM}" stroke-width="3"/>`;
        s += bellPath(cx + 24, cy - 2, sh.w * 0.8, sh.len * 0.8);
      }
      return { defs: g.def, body: s, topY: cy };
    },

    spike(sh, pal, rng, uid) {
      const cx = 100, topY = 40, H = sh.len * 1.6;
      const g = grad(uid, 0, pal.petal, pal.petalDeep, 'radial');
      let s = `<path d="M${cx} ${topY + H} L ${cx} 272" fill="none" stroke="${STEM}" stroke-width="5" stroke-linecap="round"/>`;
      s += `<path d="M${cx} ${topY + H + 30} C ${cx + 30} ${topY + H + 22}, ${cx + 44} ${topY + H + 40}, ${cx + 30} ${topY + H + 52}
        C ${cx + 14} ${topY + H + 56}, ${cx + 2} ${topY + H + 42}, ${cx} ${topY + H + 30} Z" fill="${LEAF}" stroke="${LEAF_DEEP}" stroke-width="1.2"/>`;
      for (let i = 0; i < sh.florets; i++) {
        const t = i / (sh.florets - 1);
        const fy = topY + t * H;
        const rowW = sh.w * (0.35 + t * 0.65);
        const fx = cx + (i % 2 === 0 ? -1 : 1) * rowW * 0.4 + (rng() - 0.5) * 5;
        const fr = 5 + t * 4 + (sh.funnelFloret ? 4 : 0);
        if (sh.starFloret) {
          for (let k = 0; k < 5; k++) {
            const ang = (360 / 5) * k + rng() * 30;
            s += `<path d="${petalPath(fr * 1.6, fr, { round: true })}" fill="url(#${g.id})"
              transform="translate(${fx.toFixed(1)} ${fy.toFixed(1)}) rotate(${ang.toFixed(1)})"/>`;
          }
          s += `<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="${(fr * 0.35).toFixed(1)}" fill="${pal.center}"/>`;
        } else if (sh.roundFloret || sh.funnelFloret) {
          s += `<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="${fr.toFixed(1)}" fill="url(#${g.id})" stroke="${pal.petalDeep}" stroke-width="0.8" stroke-opacity="0.5"/>
                <circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="${(fr * 0.32).toFixed(1)}" fill="${pal.center}"/>`;
        } else {
          // 라벤더: 작은 타원 이삭
          s += `<ellipse cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" rx="${(fr * 0.9).toFixed(1)}" ry="${(fr * 0.62).toFixed(1)}"
            fill="url(#${g.id})" transform="rotate(${((rng() - 0.5) * 40).toFixed(0)} ${fx.toFixed(1)} ${fy.toFixed(1)})"/>`;
        }
      }
      return { defs: g.def, body: s, topY };
    },

    daffodil(sh, pal, rng, uid) {
      const cx = 100, cy = 90;
      const g = grad(uid, 0, pal.petal, pal.petalDeep);
      let s = '';
      for (let i = 0; i < sh.petals; i++) {
        const ang = (360 / sh.petals) * i + (rng() - 0.5) * 6;
        s += `<path d="${petalPath(sh.len, sh.w, { pointed: true })}" fill="url(#${g.id})"
          stroke="${pal.petalDeep}" stroke-width="0.8" stroke-opacity="0.5"
          transform="translate(${cx} ${cy}) rotate(${ang.toFixed(1)})"/>`;
      }
      // 트럼펫
      const R = sh.trumpetR;
      s += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${pal.center}"/>`;
      let rim = `M ${cx + R} ${cy}`;
      for (let k = 1; k <= 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const rr = R * (k % 2 ? 1.14 : 0.98);
        rim += ` L ${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)}`;
      }
      s += `<path d="${rim} Z" fill="${pal.center}" opacity="0.85"/>`;
      s += `<circle cx="${cx}" cy="${cy}" r="${R * 0.5}" fill="rgba(0,0,0,0.18)"/>`;
      return { defs: g.def, body: stemAndLeaves(rng, cx, cy + 10) + s, topY: cy };
    },

    butterfly(sh, pal, rng, uid) {
      const cx = 100, cy = 92, L = sh.len;
      const g = grad(uid, 0, pal.petal, pal.petalDeep, 'radial');
      const s = `
        <path d="M${cx} ${cy + 6} C ${cx - L * 1.15} ${cy - L * 0.35}, ${cx - L * 0.7} ${cy - L * 1.25}, ${cx} ${cy - L * 0.95}
          C ${cx + L * 0.7} ${cy - L * 1.25}, ${cx + L * 1.15} ${cy - L * 0.35}, ${cx} ${cy + 6} Z"
          fill="url(#${g.id})" stroke="${pal.petalDeep}" stroke-width="1" stroke-opacity="0.5"/>
        <path d="M${cx} ${cy + 8} C ${cx - L * 0.55} ${cy - L * 0.15}, ${cx - L * 0.3} ${cy - L * 0.6}, ${cx} ${cy - L * 0.42}
          C ${cx + L * 0.3} ${cy - L * 0.6}, ${cx + L * 0.55} ${cy - L * 0.15}, ${cx} ${cy + 8} Z"
          fill="${pal.center}" stroke="${pal.petalDeep}" stroke-width="0.8" stroke-opacity="0.5"/>
        <ellipse cx="${cx}" cy="${cy - L * 0.1}" rx="${L * 0.13}" ry="${L * 0.3}" fill="${pal.petalDeep}" opacity="0.75"/>`;
      return { defs: g.def, body: stemAndLeaves(rng, cx, cy + 6) + s, topY: cy };
    },

    clover(sh, pal, rng, uid) {
      const cx = 100, cy = 92, L = sh.len;
      const g = grad(uid, 0, pal.petal, pal.petalDeep, 'radial');
      let s = '';
      for (let i = 0; i < sh.leaves; i++) {
        const ang = (360 / sh.leaves) * i + 45;
        s += `<path d="${heartLeafPath(L)}" fill="url(#${g.id})" stroke="${pal.petalDeep}" stroke-width="1" stroke-opacity="0.5"
          transform="translate(${cx} ${cy}) rotate(${ang.toFixed(1)})"/>`;
        s += `<path d="M0 0 L 0 ${-L * 0.6}" stroke="${pal.center}" stroke-width="1.4" opacity="0.8"
          transform="translate(${cx} ${cy}) rotate(${ang.toFixed(1)})"/>`;
      }
      s += `<circle cx="${cx}" cy="${cy}" r="3" fill="${pal.petalDeep}"/>`;
      return { defs: g.def, body: stemAndLeaves(rng, cx, cy + 4, { noLeaves: true }) + s, topY: cy };
    },

    magnolia(sh, pal, rng, uid) {
      const cx = 100, cy = 128, L = sh.len * 1.25, W = sh.w * 1.5;
      const g = grad(uid, 0, pal.petal, pal.petalDeep);
      // 위로 벌어진 잔 모양: 바깥 꽃잎(벌어짐) → 안쪽 꽃잎(모임)
      const petal = (a, len, w) => `<path d="${petalPath(len, w, { round: true })}"
        fill="url(#${g.id})" stroke="${pal.petalDeep}" stroke-width="1.3" stroke-opacity="0.75"
        transform="translate(${cx} ${cy}) rotate(${a})"/>`;
      let s = '';
      s += petal(-58, L * 0.8, W * 0.85) + petal(58, L * 0.8, W * 0.85);
      s += petal(-34, L * 0.95, W) + petal(34, L * 0.95, W);
      s += petal(-12, L, W) + petal(12, L, W);
      s += `<ellipse cx="${cx}" cy="${cy - 4}" rx="6.5" ry="8" fill="${pal.center}"/>`;
      // 목련 가지
      const stem = `<path d="M${cx} ${cy} C ${cx - 8} ${cy + 50}, ${cx + 14} ${cy + 90}, ${cx + 4} ${cy + 144}"
        fill="none" stroke="#8A6242" stroke-width="4.5" stroke-linecap="round"/>
        <path d="M${cx + 8} ${cy + 74} C ${cx + 30} ${cy + 66}, ${cx + 42} ${cy + 72}, ${cx + 46} ${cy + 84}"
        fill="none" stroke="#8A6242" stroke-width="3" stroke-linecap="round"/>
        <ellipse cx="${cx + 48}" cy="${cy + 86}" rx="6" ry="9" fill="${pal.petal}" stroke="${pal.petalDeep}" stroke-width="1"
        transform="rotate(38 ${cx + 48} ${cy + 86})"/>`;
      return { defs: g.def, body: stem + s, topY: cy };
    },
  };

  /**
   * @param {object} flower flowers.json 항목
   * @param {number} variant 팔레트 인덱스
   * @param {object} [opts] { seed, size, className }
   */
  function render(flower, variant = 0, opts = {}) {
    const uid = ++uidCounter;
    const seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9);
    const rng = mulberry32(seed + 7);
    const pal = flower.palettes[variant % flower.palettes.length];
    const shapeFn = SHAPES[flower.shape.type] || SHAPES.daisy;
    const { defs, body } = shapeFn(flower.shape, pal, rng, uid);
    const sizeAttr = opts.size
      ? `width="${opts.size}" height="${Math.round(opts.size * 1.4)}"`
      : '';
    const cls = opts.className ? ` class="${opts.className}"` : '';
    return `<svg${cls} viewBox="0 0 200 280" ${sizeAttr} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${flower.name}">
      <defs>${defs}</defs>${body}</svg>`;
  }

  const api = { render, mulberry32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FlowerSVG = api;
})(typeof window !== 'undefined' ? window : globalThis);
