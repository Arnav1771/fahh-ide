// Docs page: active section tracking, TOC filter, and Developer Command Palette / Search Engine

(() => {
  // ── 1. Active Section Tracking (TOC spy) ──
  const links = [...document.querySelectorAll(".toc a")];
  const byId = new Map(links.map((a) => [a.getAttribute("href")?.slice(1), a]));
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.classList.remove("active"));
      byId.get(e.target.id)?.classList.add("active");
    }
  }, { rootMargin: "-20% 0px -70% 0px" });
  document.querySelectorAll(".doc section[id]").forEach((s) => io.observe(s));

  // ── 2. Table of Contents Quick Filter ──
  const tocFilter = document.getElementById("tocFilter");
  const tocList = document.getElementById("tocList");
  if (tocFilter && tocList) {
    const tocItems = [...tocList.querySelectorAll("li")];
    tocFilter.addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      tocItems.forEach((li) => {
        const text = li.textContent.toLowerCase();
        li.style.display = text.includes(q) ? "" : "none";
      });
    });
    tocFilter.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        tocFilter.value = "";
        tocItems.forEach((li) => (li.style.display = ""));
        tocFilter.blur();
      } else if (e.key === "Enter") {
        const visible = tocItems.filter((li) => li.style.display !== "none");
        if (visible.length === 1) {
          const a = visible[0].querySelector("a");
          if (a) {
            a.click();
            tocFilter.blur();
          }
        }
      }
    });
  }

  // ── 3. Developer Search Index ──
  const searchIndex = [];

  // Index sections, headings, tables and code blocks from DOM
  document.querySelectorAll(".doc section[id]").forEach((sec) => {
    const secId = sec.id;
    const label = sec.querySelector(".section-label")?.textContent.trim() || "";
    const h2 = sec.querySelector("h2")?.textContent.trim() || "";
    const h3s = [...sec.querySelectorAll("h3")].map((h) => h.textContent.trim());

    // Section root entry
    searchIndex.push({
      title: `${h2 || secId} ${label}`.trim(),
      category: "Guide",
      snippet: sec.querySelector("p")?.textContent.trim().slice(0, 140) || "",
      targetId: secId,
      keywords: `${secId} ${label} ${h2} ${h3s.join(" ")}`.toLowerCase()
    });

    // Subheadings
    sec.querySelectorAll("h3").forEach((h3) => {
      const siblingP = h3.nextElementSibling;
      const snippet = siblingP && siblingP.tagName === "P" ? siblingP.textContent.trim().slice(0, 140) : "";
      searchIndex.push({
        title: `${h2} › ${h3.textContent.trim()}`,
        category: "Guide",
        snippet,
        targetId: secId,
        keywords: `${secId} ${h2} ${h3.textContent.trim()}`.toLowerCase()
      });
    });

    // Table rows (commands, configs, modules, tools, builds)
    sec.querySelectorAll("table tbody tr").forEach((tr) => {
      const cells = [...tr.querySelectorAll("td")];
      if (cells.length >= 2) {
        const first = cells[0].textContent.trim();
        const second = cells[1].textContent.trim();
        const third = cells[2] ? cells[2].textContent.trim() : "";
        const allCode = [...tr.querySelectorAll("code")].map((c) => c.textContent.trim()).join(" ");

        let category = "API";
        if (secId === "config") category = "Config";
        else if (secId === "events") category = "Event";
        else if (secId === "modules") category = "Architecture";
        else if (secId === "tools") category = "Tool";
        else if (secId === "build" || secId === "quick-start") category = "Build";

        searchIndex.push({
          title: first,
          category,
          snippet: `${second} ${third}`.trim().slice(0, 160),
          targetId: secId,
          keywords: `${first} ${second} ${third} ${allCode} ${secId}`.toLowerCase()
        });
      }
    });

    // Pre blocks / Code samples
    sec.querySelectorAll("pre.code").forEach((pre) => {
      const code = pre.textContent.trim();
      const firstLine = code.split("\n")[0].trim().slice(0, 60);
      searchIndex.push({
        title: `Code snippet: ${firstLine}`,
        category: "Code",
        snippet: code.slice(0, 140).replace(/\n/g, " "),
        targetId: secId,
        keywords: `${code} ${secId}`.toLowerCase()
      });
    });
  });

  // Dedicated high-value developer keyword index entries
  const curatedEntries = [
    {
      title: "trigger_error_sound (Tauri command)",
      category: "API",
      snippet: "Dispatches the diagnostic error sound 'fahh.mp3' through the backend sound engine if outside cooldown.",
      targetId: "commands",
      keywords: "trigger_error_sound sound fahh.mp3 audio error play invoke cooldown"
    },
    {
      title: "lsp_start / lsp_stop / lsp_restart (Tauri commands)",
      category: "API",
      snippet: "Spawns or stops language server background processes (rust-analyzer, tsserver, pylsp, gopls, clangd).",
      targetId: "commands",
      keywords: "lsp lsp_start lsp_stop lsp_restart language server diagnostics rpc"
    },
    {
      title: "get_file_tree / read_file / write_file (Tauri commands)",
      category: "API",
      snippet: "Inspects directories, loads utf-8 content into Monaco tabs, and atomically writes file modifications.",
      targetId: "commands",
      keywords: "get_file_tree read_file write_file file tree monaco save fs"
    },
    {
      title: "git_status / git_stage / git_commit / git_diff (Tauri commands)",
      category: "API",
      snippet: "Native Git integration for inspecting branch status, diffing unified patches, staging, and committing.",
      targetId: "commands",
      keywords: "git git_status git_stage git_commit git_diff git_branches vcs"
    },
    {
      title: "spawn_terminal / write_terminal / kill_terminal (Tauri commands)",
      category: "API",
      snippet: "Manages native pseudoterminal (PTY) sessions: conpty on Windows, openpty on macOS and Linux.",
      targetId: "commands",
      keywords: "spawn_terminal write_terminal terminal pty conpty shell bash cmd powershell"
    },
    {
      title: "agent_query / agent_cancel / agent_tools (AI Assistant)",
      category: "API",
      snippet: "Invokes AI reasoning models with slash commands (/plan, /ask, auto-edit) streaming tool execution.",
      targetId: "commands",
      keywords: "agent_query agent_cancel ai assistant slash plan ask auto-edit agent"
    },
    {
      title: "sfx_cooldown_secs / sound_volume (Configuration)",
      category: "Config",
      snippet: "Controls minimal cooldown window between consecutive error sounds (default 5s) and volume (0.0 to 1.0).",
      targetId: "config",
      keywords: "sfx_cooldown_secs sound_volume config volume cooldown audio fahh.mp3"
    },
    {
      title: "fahh://error (Event)",
      category: "Event",
      snippet: "Emitted on Tauri event bus whenever an error diagnostic triggers the fahh audio playback.",
      targetId: "events",
      keywords: "fahh://error event listen diagnostic sound trigger"
    },
    {
      title: "From diagnostic to sound (Lifecycle)",
      category: "Architecture",
      snippet: "Diagnostic flow: Language Server -> textDocument/publishDiagnostics -> Error check -> Cooldown gate -> fahh.mp3 playback.",
      targetId: "sound",
      keywords: "sound diagnostic lifecycle cooldown publishdiagnostics severity error"
    },
    {
      title: "Windows & Multi-OS Bundling (NSIS, MSI, DMG, AppImage)",
      category: "Build",
      snippet: "Production bundling: pnpm tauri build outputs Fahh Editor_x64-setup.exe (NSIS), MSI, macOS DMG, and Linux AppImage/deb.",
      targetId: "build",
      keywords: "bundle build packaging nsis setup exe msi dmg appimage release windows macos linux"
    }
  ];

  curatedEntries.forEach((entry) => searchIndex.push(entry));

  // ── 4. Command Palette / Search UI Logic ──
  const searchModal = document.getElementById("docSearchModal");
  const searchTrigger = document.getElementById("docSearchTrigger");
  const searchInput = document.getElementById("docSearchInput");
  const searchResults = document.getElementById("docSearchResults");
  const searchClear = document.getElementById("docSearchClear");

  let selectedIndex = -1;
  let currentMatches = [];

  function openSearch(initialQuery = "") {
    if (!searchModal) return;
    searchModal.classList.add("open");
    searchModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    if (searchInput) {
      if (initialQuery) searchInput.value = initialQuery;
      searchInput.focus();
      searchInput.select();
      renderResults(searchInput.value);
    }
  }

  function closeSearch() {
    if (!searchModal) return;
    searchModal.classList.remove("open");
    searchModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    selectedIndex = -1;
  }

  function highlightMatches(text, query) {
    if (!query) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    return text.replace(regex, "<mark>$1</mark>");
  }

  function renderResults(rawQuery) {
    const q = rawQuery.trim().toLowerCase();
    if (!searchResults) return;

    if (searchClear) {
      searchClear.style.display = q ? "flex" : "none";
    }

    if (!q) {
      currentMatches = [];
      selectedIndex = -1;
      searchResults.innerHTML = `<div class="doc-search-empty">Type a query to search commands, architecture, configuration...</div>`;
      return;
    }

    // Rank results: title match > keyword match > snippet match
    const scored = [];
    const seen = new Set();

    searchIndex.forEach((item) => {
      const key = `${item.title}-${item.targetId}`;
      if (seen.has(key)) return;

      const titleLower = item.title.toLowerCase();
      const kwLower = item.keywords || "";
      const snipLower = item.snippet.toLowerCase();

      let score = 0;
      if (titleLower.includes(q)) score += 100;
      if (titleLower.startsWith(q)) score += 50;
      if (kwLower.includes(q)) score += 40;
      if (snipLower.includes(q)) score += 10;

      if (score > 0) {
        seen.add(key);
        scored.push({ item, score });
      }
    });

    scored.sort((a, b) => b.score - a.score);
    currentMatches = scored.slice(0, 12).map((s) => s.item);

    if (currentMatches.length === 0) {
      selectedIndex = -1;
      searchResults.innerHTML = `<div class="doc-search-empty">No documentation matches found for "<strong>${rawQuery}</strong>".</div>`;
      return;
    }

    selectedIndex = 0;
    searchResults.innerHTML = currentMatches
      .map((item, idx) => {
        const highlightedTitle = highlightMatches(item.title, rawQuery.trim());
        const highlightedSnippet = highlightMatches(item.snippet, rawQuery.trim());
        return `
          <div class="search-result-item ${idx === 0 ? "selected" : ""}" data-index="${idx}" data-target="${item.targetId}">
            <div class="search-result-header">
              <span class="search-result-title">${highlightedTitle}</span>
              <span class="search-result-badge">${item.category}</span>
            </div>
            ${item.snippet ? `<div class="search-result-snippet">${highlightedSnippet}</div>` : ""}
          </div>
        `;
      })
      .join("");
  }

  function navigateToTarget(targetId) {
    closeSearch();
    const targetEl = document.getElementById(targetId);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
      targetEl.classList.remove("highlight-target");
      // Re-trigger animation
      void targetEl.offsetWidth;
      targetEl.classList.add("highlight-target");
      history.replaceState(null, "", `#${targetId}`);
    }
  }

  function updateSelected() {
    const items = searchResults?.querySelectorAll(".search-result-item");
    if (!items) return;
    items.forEach((item, idx) => {
      if (idx === selectedIndex) {
        item.classList.add("selected");
        item.scrollIntoView({ block: "nearest" });
      } else {
        item.classList.remove("selected");
      }
    });
  }

  // Event Listeners
  if (searchTrigger) {
    searchTrigger.addEventListener("click", () => openSearch());
  }

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      renderResults(e.target.value);
    });

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (currentMatches.length > 0) {
          selectedIndex = (selectedIndex + 1) % currentMatches.length;
          updateSelected();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (currentMatches.length > 0) {
          selectedIndex = (selectedIndex - 1 + currentMatches.length) % currentMatches.length;
          updateSelected();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < currentMatches.length) {
          navigateToTarget(currentMatches[selectedIndex].targetId);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeSearch();
      }
    });
  }

  if (searchClear) {
    searchClear.addEventListener("click", () => {
      if (searchInput) {
        searchInput.value = "";
        searchInput.focus();
        renderResults("");
      }
    });
  }

  if (searchResults) {
    searchResults.addEventListener("click", (e) => {
      const item = e.target.closest(".search-result-item");
      if (item) {
        const targetId = item.getAttribute("data-target");
        if (targetId) navigateToTarget(targetId);
      }
    });
  }

  if (searchModal) {
    searchModal.addEventListener("click", (e) => {
      if (e.target === searchModal) {
        closeSearch();
      }
    });
  }

  // Global Keyboard Shortcuts (Ctrl+K, Cmd+K, /)
  window.addEventListener("keydown", (e) => {
    const isCtrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
    const isSlash = e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);

    if (isCtrlK || isSlash) {
      e.preventDefault();
      openSearch();
    } else if (e.key === "Escape" && searchModal?.classList.contains("open")) {
      e.preventDefault();
      closeSearch();
    }
  });
})();
