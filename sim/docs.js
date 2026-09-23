// Docs page: highlight the section in view in the contents list.
const links = [...document.querySelectorAll(".toc a")];
const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    links.forEach((a) => a.classList.remove("active"));
    byId.get(e.target.id)?.classList.add("active");
  }
}, { rootMargin: "-20% 0px -70% 0px" });
document.querySelectorAll(".doc section[id]").forEach((s) => io.observe(s));
