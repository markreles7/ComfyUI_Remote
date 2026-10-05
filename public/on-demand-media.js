// Keep remote media URLs inert until the user explicitly opens a preview.
export function deferMediaPreview(markup) {
  const kind = markup.match(/^<(video|audio|img)\b/)?.[1];
  if (!kind) return markup;
  const deferred = markup
    .replace(/\ssrc="([^"]*)"/, ' data-on-demand-src="$1"')
    .replace(/\spreload="[^"]*"/, '')
    .replace(/\sautoplay\b/, '')
    .replace(/\sposter="[^"]*"/, '')
    .replace(/^<(video|audio|img)\b/, `<$1 hidden${kind === "img" ? "" : ' preload="none"'}`);
  const label = { video: "Mostra video", audio: "Ascolta audio", img: "Mostra immagine" }[kind];
  return `<div class="on-demand-preview on-demand-${kind}">${deferred}<button type="button" class="media-preview-button" data-open-media-preview>${label}</button></div>`;
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-open-media-preview]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const wrapper = button.closest(".on-demand-preview");
    const media = wrapper.querySelector("[data-on-demand-src]");
    media.src = media.dataset.onDemandSrc;
    media.hidden = false;
    wrapper.classList.add("preview-open");
    button.hidden = true;
    media.addEventListener("error", () => {
      media.hidden = true;
      wrapper.classList.remove("preview-open");
      button.textContent = "Riprova anteprima";
      button.hidden = false;
    }, { once: true });
    if (media.tagName !== "IMG") {
      media.load();
      media.play().catch(() => {});
    }
  }, true);
}
