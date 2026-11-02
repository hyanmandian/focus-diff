const read = (name) =>
  fetch(`badges/${name}.json`)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
const worth = (badge) => {
  const [, number, unit] = /^([\d.]+)([KMB]?)$/iu.exec(badge?.message ?? "") ?? [];
  const value = Number(number) * ({ k: 1e3, m: 1e6, b: 1e9 }[unit?.toLowerCase()] ?? 1);
  return value >= 100 ? badge.message : null;
};
const pointer =
  '<svg viewBox="0 0 32 32" width="24" height="24"><g transform="translate(10 7)"><path d="m6.148 18.473 1.863-1.003 1.615-.839-2.568-4.816h4.332l-11.379-11.408v16.015l3.316-3.221z" fill="#fff"/><path d="m6.431 17 1.765-.941-2.775-5.202h3.604l-8.025-8.043v11.188l2.53-2.442z" fill="#000"/></g></svg>';
const strip = `<span class="strip">${[..."0123456789"].map((digit) => `<span>${digit}</span>`).join("")}</span>`;
const chain = (items, step) => items.reduce((done, item) => done.then(() => step(item)), Promise.resolve());
const roll = (number, text) => {
  const chars = [...text];
  while (number.children.length < chars.length) {
    const slot = document.createElement("span");
    slot.className = "slot gone";
    number.prepend(slot);
  }
  number.getBoundingClientRect();
  const slots = [...number.children];
  const offset = slots.length - chars.length;
  slots.forEach((slot, index) => {
    const char = chars[index - offset];
    slot.style.transitionDelay = `${(slots.length - 1 - index) * 45}ms`;
    slot.classList.toggle("gone", char === undefined);
    if (char === undefined) return;
    const digit = /\d/u.test(char);
    if (digit && !slot.firstElementChild) slot.innerHTML = strip;
    if (!digit) slot.textContent = char;
    slot.style.setProperty("--n", digit ? char : "0");
  });
};
const separator = /[,.:/\s]/u;
const board = (element, text, flip) => {
  const wide = [...element.dataset.wide];
  const chars = [...text];
  const cells = wide
    .toReversed()
    .map((cell) => {
      if (separator.test(cell)) return separator.test(chars.at(-1) ?? "") ? chars.pop() : "";
      while (separator.test(chars.at(-1) ?? "")) chars.pop();
      return chars.pop() ?? "";
    })
    .toReversed();
  if (element.children.length !== wide.length) {
    element.replaceChildren(
      ...wide.map((cell) => {
        const slot = document.createElement("span");
        slot.className = separator.test(cell) ? "cell sep" : "cell";
        return slot;
      }),
    );
  }
  cells.forEach((char, index) => {
    const cell = element.children[index];
    if (cell.textContent === char) return;
    cell.textContent = char;
    cell.classList.remove("flip");
    if (!flip || !char) return;
    cell.getBoundingClientRect();
    cell.classList.add("flip");
  });
};
const glide = (root) => {
  for (const group of root.querySelectorAll("[data-glide]")) {
    const mark = group.querySelector(".glide");
    for (const item of group.querySelectorAll("[data-key]")) {
      const on = item.dataset.key === root.dataset[group.dataset.glide];
      item.toggleAttribute("data-on", on);
      if (!on) continue;
      mark.style.width = `${item.offsetWidth}px`;
      mark.style.height = `${item.offsetHeight}px`;
      mark.style.translate = `${item.offsetLeft}px ${item.offsetTop}px`;
    }
  }
};
const snap = (root, change) => {
  root.classList.add("snap");
  change();
  root.getBoundingClientRect();
  root.classList.remove("snap");
};
const timeline = () => {
  const pending = [];
  let now = 0;
  let last = 0;
  let frame = 0;
  let running = false;
  const tick = (stamp) => {
    now += last ? Math.min(stamp - last, 50) : 0;
    last = stamp;
    for (const item of pending.filter((each) => each.due <= now)) {
      pending.splice(pending.indexOf(item), 1);
      item.done();
    }
    frame = running && pending.length > 0 ? requestAnimationFrame(tick) : 0;
    if (!frame) last = 0;
  };
  const kick = () => {
    if (running && !frame && pending.length > 0) frame = requestAnimationFrame(tick);
  };
  return {
    wait: (ms) =>
      new Promise((done) => {
        pending.push({ due: now + ms, done });
        kick();
      }),
    run: (value) => {
      running = value;
      kick();
    },
  };
};
const stage = (root) => {
  const time = timeline();
  const cursor = document.createElement("span");
  cursor.className = "cursor";
  cursor.setAttribute("aria-hidden", "true");
  cursor.innerHTML = pointer;
  root.append(cursor);
  let spot = { x: 0, y: 0 };
  const find = (name) => root.querySelector(`[data-target="${name}"]`);
  const place = (point, ms) => {
    cursor.style.transitionDuration = `${ms}ms, 300ms`;
    cursor.style.translate = `${point.x}px ${point.y}px`;
    spot = point;
  };
  const locate = (target, fx, fy) => {
    const frame = root.getBoundingClientRect();
    if (Array.isArray(target)) return { x: frame.width * target[0], y: frame.height * target[1] };
    const box = find(target).getBoundingClientRect();
    return { x: box.left - frame.left + box.width * fx, y: box.top - frame.top + box.height * fy };
  };
  return {
    root,
    find,
    run: time.run,
    wait: time.wait,
    compact: () => root.clientWidth <= 520,
    async move(target, fx = 0.9, fy = 0.78) {
      const point = locate(target, fx, fy);
      if (!cursor.dataset.shown) {
        place(locate([0.62, 1.06]), 0);
        cursor.getBoundingClientRect();
        cursor.dataset.shown = "";
      }
      const ms = Math.round(Math.min(950, 340 + Math.hypot(point.x - spot.x, point.y - spot.y) * 1.3));
      place(point, ms);
      await time.wait(ms + 60);
    },
    async click() {
      cursor.dataset.pressed = "";
      await time.wait(110);
      delete cursor.dataset.pressed;
      await time.wait(150);
    },
    set(values) {
      for (const [key, value] of Object.entries(values)) {
        if (value === null) delete root.dataset[key];
        else root.dataset[key] = value;
      }
      glide(root);
    },
    count(values) {
      for (const [key, value] of Object.entries(values)) roll(root.querySelector(`[data-num="${key}"]`), value);
    },
    boards(values) {
      for (const [key, value] of Object.entries(values))
        board(root.querySelector(`[data-board="${key}"]`), value, true);
    },
    type(name) {
      const field = find(name);
      field.textContent = "";
      return chain([...field.dataset.text], async (char) => {
        field.textContent += char;
        await time.wait(char === " " ? 70 : 34);
      });
    },
    hide() {
      delete cursor.dataset.shown;
    },
  };
};
const filters = {
  all: { files: "9", add: "+910", del: "−443", time: "0:28", conv: "3" },
  frontend: { files: "2", add: "+150", del: "−25", time: "0:07", conv: "1" },
  backend: { files: "2", add: "+118", del: "−23", time: "0:07", conv: "1" },
};
const parts = {
  1: { part: "1", wfiles: "1", wadd: "+5", wdel: "−1" },
  2: { part: "2", wfiles: "2", wadd: "+10", wdel: "−6" },
  3: { part: "3", wfiles: "1", wadd: "+1", wdel: "−1" },
};
const scenes = {
  bar: (act) =>
    chain(
      [
        ["backend", 1900],
        ["all", 1500],
        ["frontend", 1800],
      ],
      async ([key, hold]) => {
        await act.wait(900);
        await act.move(key);
        await act.click();
        act.set({ filter: key });
        const { conv, ...stats } = filters[key];
        act.boards(stats);
        act.count({ conv });
        await act.wait(hold);
      },
    ),
  async queue(act) {
    snap(act.root, () => {
      act.set({ open: null, toast: null, fresh: null, hover: null });
      act.count({ review: "2", all: "2", web: "1", group: "1" });
    });
    await act.wait(700);
    act.set({ toast: "" });
    await act.wait(2600);
    act.set({ toast: null });
    await act.wait(300);
    await act.move("tray", 0.55, 0.75);
    await act.click();
    act.set({ open: "" });
    await act.wait(350);
    act.set({ fresh: "" });
    act.count({ review: "4", all: "4", web: "3", group: "3" });
    await act.wait(700);
    await act.move("row", 0.66, 0.5);
    act.set({ hover: "" });
    await act.wait(2200);
  },
  async review(act) {
    snap(act.root, () => act.set({ step: null, sent: null, pending: null, finish: null, kind: "comment" }));
    act.find("field").textContent = "";
    await act.wait(900);
    await act.move("line-a", 0.5, 0.55);
    await act.click();
    act.set({ step: "pick" });
    await act.move("line-b", 0.5, 0.55);
    await act.click();
    act.set({ step: "compose" });
    await act.wait(500);
    await act.type("field");
    await act.wait(450);
    await act.move("comment", 0.7, 0.7);
    await act.click();
    act.set({ step: "posted", pending: "" });
    await act.wait(1000);
    await act.move("submit", 0.6, 0.7);
    await act.click();
    act.set({ finish: "" });
    await act.wait(600);
    await act.move("kind", 0.6, 0.7);
    await act.click();
    act.set({ kind: "approve" });
    await act.wait(450);
    await act.move("approve", 0.7, 0.7);
    await act.click();
    act.set({ finish: null, pending: null, sent: "" });
    await act.move(act.compact() ? [0.86, 0.94] : [0.9, 0.9]);
    await act.wait(2200);
  },
  async walk(act) {
    snap(act.root, () => {
      act.set({ ch: "1" });
      act.count(parts[1]);
    });
    await chain(["2", "3"], async (key) => {
      await act.wait(key === "2" ? 1300 : 2100);
      await act.move("next", 0.6, 0.7);
      await act.click();
      act.set({ ch: key });
      act.count(parts[key]);
    });
    await act.wait(2000);
  },
};
{
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const agent = navigator.userAgent;
  const top = document.querySelector(".top");
  if (top) {
    const edge = () => top.classList.toggle("scrolled", scrollY > 8);
    addEventListener("scroll", edge, { passive: true });
    edge();
  }
  const system = /Windows/u.test(agent)
    ? "windows"
    : /Linux|X11/u.test(agent) && !/Android/u.test(agent)
      ? "linux"
      : "mac";
  const browser = /Firefox\//u.test(agent)
    ? "firefox"
    : /Safari\//u.test(agent) && !/Chrome\/|Chromium\//u.test(agent)
      ? "safari"
      : "chrome";
  for (const group of document.querySelectorAll("[data-pick]")) {
    const want = group.dataset.pick === "os" ? system : browser;
    const links = [...group.querySelectorAll("[data-for]")];
    if (!links.some((link) => link.dataset.for === want)) continue;
    for (const link of links) link.classList.toggle("primary", link.dataset.for === want);
  }
  for (const name of ["installs", "stars"]) {
    const slots = document.querySelectorAll(`[data-count="${name}"]`);
    if (slots.length === 0) continue;
    read(name).then((badge) => {
      const value = worth(badge);
      if (!value) return;
      for (const slot of slots) {
        slot.querySelector("[data-value]").textContent = value;
        slot.hidden = false;
      }
    });
  }
  const glyph = {
    play: '<path d="M4 2.5v11l9-5.5z"/>',
    pause: '<path d="M4 2h3v12H4zM9 2h3v12H9z"/>',
    muted:
      '<path d="M2 6h3l4-3v10l-4-3H2zM11 6l4 4M15 6l-4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M2 6h3l4-3v10l-4-3H2z"/>',
    sound:
      '<path d="M2 6h3l4-3v10l-4-3H2z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6 6 0 0 1 0 9" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>',
  };
  const svg = (name) => `<svg viewBox="0 0 16 16" aria-hidden="true">${glyph[name]}</svg>`;
  const watch =
    !reduce && "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.target.dataset.paused) continue;
              if (entry.isIntersecting) entry.target.play().catch(() => {});
              else entry.target.pause();
            }
          },
          { threshold: 0.45 },
        )
      : null;
  for (const video of document.querySelectorAll("video[data-autoplay]")) {
    const frame = video.parentElement;
    const start = document.createElement("button");
    start.type = "button";
    start.className = "start";
    start.setAttribute("aria-label", "Play the tour");
    start.innerHTML = `<span>${svg("play")}</span>`;
    const bar = document.createElement("div");
    bar.className = "controls";
    const toggle = document.createElement("button");
    toggle.type = "button";
    const sound = document.createElement("button");
    sound.type = "button";
    bar.append(toggle, sound);
    frame.append(start, bar);
    const paint = () => {
      const playing = !video.paused;
      toggle.innerHTML = svg(playing ? "pause" : "play");
      toggle.setAttribute("aria-label", playing ? "Pause the tour" : "Play the tour");
      sound.innerHTML = svg(video.muted ? "muted" : "sound");
      sound.setAttribute("aria-label", video.muted ? "Turn the sound on" : "Turn the sound off");
      start.hidden = playing || video.currentTime > 0 || Boolean(watch);
    };
    const play = () => {
      delete video.dataset.paused;
      video.play().catch(() => {});
    };
    start.addEventListener("click", play);
    toggle.addEventListener("click", () => {
      if (video.paused) play();
      else {
        video.dataset.paused = "true";
        video.pause();
      }
    });
    sound.addEventListener("click", () => {
      video.muted = !video.muted;
      if (!video.muted && video.paused) play();
      paint();
    });
    for (const event of ["play", "pause", "volumechange"]) video.addEventListener(event, paint);
    paint();
    watch?.observe(video);
  }
  const list = document.querySelector('[role="tablist"]');
  if (list) {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const pill = document.createElement("span");
    pill.className = "tab-pill";
    pill.setAttribute("aria-hidden", "true");
    list.append(pill);
    const place = () => {
      const tab = tabs.find((each) => each.getAttribute("aria-selected") === "true");
      pill.style.width = `${tab.offsetWidth}px`;
      pill.style.height = `${tab.offsetHeight}px`;
      pill.style.translate = `${tab.offsetLeft}px ${tab.offsetTop}px`;
    };
    const select = (tab, focus) => {
      for (const other of tabs) {
        const selected = other === tab;
        other.setAttribute("aria-selected", String(selected));
        other.tabIndex = selected ? 0 : -1;
        document.querySelector(`#${CSS.escape(other.getAttribute("aria-controls"))}`).hidden = !selected;
      }
      place();
      if (focus) tab.focus();
    };
    new ResizeObserver(() => {
      pill.classList.remove("moving");
      place();
    }).observe(list);
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => {
        pill.classList.add("moving");
        select(tab);
      });
      tab.addEventListener("keydown", (event) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
        const target =
          event.key === "Home"
            ? tabs[0]
            : event.key === "End"
              ? tabs.at(-1)
              : step
                ? tabs[(index + step + tabs.length) % tabs.length]
                : null;
        if (!target) return;
        event.preventDefault();
        pill.classList.add("moving");
        select(target, true);
      });
    });
    for (const link of document.querySelectorAll("a[data-tab]")) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const tab = document.querySelector(`#${CSS.escape(link.dataset.tab)}`);
        pill.classList.add("moving");
        select(tab);
        document
          .querySelector("#manual-title")
          .scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        tab.focus({ preventScroll: true });
      });
    }
    const initial =
      list.dataset.initial === "os" ? { windows: 1, linux: 2 }[system] : { firefox: 1, safari: 2 }[browser];
    select(tabs[initial ?? 0]);
  }

  const demos = [...document.querySelectorAll("[data-demo]")];
  for (const element of document.querySelectorAll("[data-board]")) board(element, element.textContent, false);
  for (const root of demos) {
    glide(root);
    new ResizeObserver(() => snap(root, () => glide(root))).observe(root);
  }
  const plays = new Map();
  const looks =
    !reduce && "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const play = plays.get(entry.target);
              play.seen = entry.isIntersecting;
              play.act.run(play.seen && !document.hidden);
              if (play.seen && !play.started) play.start();
            }
          },
          { threshold: 0.35 },
        )
      : null;
  if (looks) {
    for (const root of demos) {
      const act = stage(root);
      const scene = scenes[root.dataset.demo];
      const loop = () => scene(act).then(() => (root.dataset.play === "loop" ? loop() : undefined));
      const play = { act, seen: false, started: false, busy: false };
      play.start = async (delay = Number(root.dataset.delay ?? 0)) => {
        play.started = true;
        play.busy = true;
        await act.wait(delay);
        await loop();
        await act.wait(1200);
        act.hide();
        play.busy = false;
      };
      snap(root, () => {
        for (const number of root.querySelectorAll("[data-num]")) {
          const text = number.textContent;
          number.textContent = "";
          roll(number, text);
        }
      });
      root.closest(".product, .tile")?.addEventListener("pointerenter", () => {
        if (play.started && !play.busy) play.start(0);
      });
      plays.set(root, play);
      looks.observe(root);
    }
    document.addEventListener("visibilitychange", () => {
      for (const play of plays.values()) play.act.run(play.seen && !document.hidden);
    });
  }
}
