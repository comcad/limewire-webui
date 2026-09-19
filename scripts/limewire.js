/* LimeWire frame glue — live speeds + filter wiring.
   qBittorrent's WebAPI (api/v2/*) is same-origin, so we can poll it directly. */
(function () {
  "use strict";

  function fmt(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec < 0) return "0 KB/s";
    var units = ["B/s", "KB/s", "MB/s", "GB/s"];
    var i = 0, v = bytesPerSec;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (i === 0 ? Math.round(v) : v.toFixed(1)) + " " + units[i];
  }

  // Poll qBittorrent transfer speeds into the LimeWire status bar.
  function tick() {
    var dl = document.getElementById("dlspeed");
    var ul = document.getElementById("ulspeed");
    if (!dl) return;
    fetch("api/v2/transfer/speeds", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        dl.textContent = fmt(d.downloadPayload);
        ul.textContent = fmt(d.uploadPayload);
      })
      .catch(function () {});
  }

  // Filter sidebar → qBittorrent category filter (best-effort, non-fatal).
  function wireFilters() {
    var lists = document.querySelectorAll(".filter-list");
    lists.forEach(function (ul) {
      ul.addEventListener("click", function (e) {
        var item = e.target.closest(".fitem");
        if (!item) return;
        var label = (item.textContent || "").trim();
        // keep selection visual
        ul.querySelectorAll(".fitem").forEach(function (x) { x.classList.remove("sel"); });
        item.classList.add("sel");
        try {
          var map = { "Active": "active", "Progress": "downloading",
                      "Stalled": "stalled", "Paused": "paused",
                      "Completed": "completed" };
          var key = map[label];
          if (key) fetch("api/v2/torrents/filter?category=" + encodeURIComponent(key),
                         { credentials: "same-origin" }).catch(function () {});
        } catch (_) {}
      });
    });
  }

  window.addEventListener("DOMContentLoaded", function () {
    wireFilters();
    tick();
    setInterval(tick, 2000);
  });
})();
