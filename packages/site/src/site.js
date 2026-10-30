const read = (name) =>
  fetch(`badges/${name}.json`)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
const worth = (badge) => {
  const [, number, unit] = /^([\d.]+)([KMB]?)$/iu.exec(badge?.message ?? "") ?? [];
  const value = Number(number) * ({ k: 1e3, m: 1e6, b: 1e9 }[unit?.toLowerCase()] ?? 1);
  return value >= 100 ? badge.message : null;
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
}
