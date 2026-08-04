import { ALL_WORKFLOW_GUIDES } from "./workflow-guides.js";

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function list(items) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderGuide(guide, index) {
  return `
    <article id="${escapeHtml(guide.id)}" class="workflow-guide-card panel" data-guide="${escapeHtml(`${guide.name} ${guide.category} ${guide.summary} ${guide.bestFor.join(" ")}`.toLowerCase())}">
      <header>
        <div>
          <p class="eyebrow">${String(index + 1).padStart(2, "0")} / ${escapeHtml(guide.category)}</p>
          <h2>${escapeHtml(guide.name)}</h2>
          <p>${escapeHtml(guide.summary)}</p>
        </div>
        <span class="guide-level">${escapeHtml(guide.level)}</span>
      </header>

      <div class="guide-detail-grid">
        <section><h3>Ideale per</h3>${list(guide.bestFor)}</section>
        <section><h3>Cosa preparare</h3>${list(guide.inputs)}</section>
      </div>

      <section>
        <h3>Come usarlo</h3>
        <ol class="guide-steps">
          ${guide.steps.map(([title, text]) => `
            <li><div><b>${escapeHtml(title)}</b><p>${escapeHtml(text)}</p></div></li>
          `).join("")}
        </ol>
      </section>

      <section>
        <h3>Impostazioni consigliate</h3>
        <div class="guide-settings">
          ${guide.settings.map(([label, value, note]) => `
            <div><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b><p>${escapeHtml(note)}</p></div>
          `).join("")}
        </div>
      </section>

      <aside class="guide-example">
        <span>Esempio prompt</span>
        <p>${escapeHtml(guide.example)}</p>
      </aside>

      <section class="guide-tips">
        <h3>Accorgimenti</h3>
        ${list(guide.tips)}
      </section>

      <footer><a class="guide-link-button" href="${escapeHtml(guide.destination || `/studio.html?workflow=${encodeURIComponent(guide.id)}`)}">Usa questo workflow <span aria-hidden="true">→</span></a></footer>
    </article>
  `;
}

function filterGuides(query) {
  const normalized = query.trim().toLowerCase();
  let visible = 0;
  document.querySelectorAll("[data-guide]").forEach((card) => {
    const match = !normalized || card.dataset.guide.includes(normalized);
    card.classList.toggle("hidden", !match);
    const link = $(`#guide-index-links a[href="#${card.id}"]`);
    link?.classList.toggle("hidden", !match);
    if (match) visible += 1;
  });
  $("#guide-no-results").classList.toggle("hidden", visible !== 0);
}

async function checkHealth() {
  const connection = $("#connection");
  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error();
    connection.className = "connection online";
    connection.innerHTML = "<span></span>ComfyUI online";
  } catch {
    connection.className = "connection offline";
    connection.innerHTML = "<span></span>ComfyUI offline";
  }
}

$("#guide-index-links").innerHTML = ALL_WORKFLOW_GUIDES.map((guide, index) => `
  <a href="#${escapeHtml(guide.id)}"><span>${String(index + 1).padStart(2, "0")}</span><b>${escapeHtml(guide.name)}</b><small>${escapeHtml(guide.category)}</small></a>
`).join("");
$("#workflow-guide-list").innerHTML = ALL_WORKFLOW_GUIDES.map(renderGuide).join("");
$("#guide-search").addEventListener("input", (event) => filterGuides(event.target.value));

const requestedWorkflow = new URLSearchParams(location.search).get("workflow");
if (requestedWorkflow && ALL_WORKFLOW_GUIDES.some((guide) => guide.id === requestedWorkflow)) {
  location.hash = requestedWorkflow;
}
checkHealth();
