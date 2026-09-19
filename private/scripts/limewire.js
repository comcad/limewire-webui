/* LimeWire frame glue — live speeds + real status-filter wiring.
   Runs in the SAME document as qBittorrent's app, so it can call the
   app's own functions (setStatusFilter, updateMainData) and the WebAPI. */
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
    fetch("api/v2/transfer/info", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        dl.textContent = fmt(d.dl_info_speed);
        ul.textContent = fmt(d.up_info_speed);
      })
      .catch(function () {});
  }

  // Map LimeWire Status panel → qBittorrent status filter values.
  var STATUS_MAP = {
    all: "all",
    active: "active",
    downloading: "downloading",   // "Progress"
    stalled: "stalled",
    stopped: "stopped",           // "Paused"
    completed: "completed",
    seeding: "seeding",
    inactive: "inactive"
  };

  // Call the app's real setStatusFilter() (defined in client.js scope) if
  // available; otherwise fall back to clicking qBittorrent's own filter link.
  function applyStatusFilter(value) {
    if (!STATUS_MAP[value]) value = "all";

    // 1) Preferred: the app exposes setStatusFilter on window (client.js top-level `let` in same scope).
    try {
      if (typeof setStatusFilter === "function") {
        setStatusFilter(value);
        return;
      }
    } catch (e) {}

    // 2) Fallback: click qBittorrent's own status filter link (<li id="<value>_filter"> > span.link).
    var li = document.getElementById(value + "_filter");
    if (li) {
      var target = li.querySelector("span.link") || li.firstElementChild || li;
      target.click();
      return;
    }
  }

  // Wire the LimeWire Status panel clicks to the real qBittorrent filter.
  function wireStatusFilters() {
    var ul = document.getElementById("lwStatusFilters");
    if (!ul) return;
    ul.addEventListener("click", function (e) {
      var item = e.target.closest("[data-qbt-filter]");
      if (!item) return;
      var value = item.getAttribute("data-qbt-filter");
      // keep selection visual
      ul.querySelectorAll(".fitem").forEach(function (x) { x.classList.remove("sel"); });
      item.classList.add("sel");
      applyStatusFilter(value);
    });
  }

  // ── Media panel → filter the transfer list by file-type (name keywords) ──
  var MEDIA_KEYWORDS = {
    audio:    "mp3|flac|aac|ogg|wav|m4a|opus|ape|album|soundtrack|music",
    video:    "1080p|720p|2160p|4k|x264|x265|hevc|h264|h265|mkv|mp4|web-?dl|bluray|hdtv|hdrip",
    images:   "jpg|jpeg|png|gif|webp|bmp|tiff|photo|wallpaper|scan|comic",
    programs: "exe|msi|apk|dmg|pkg|deb|rpm|portable|setup|installer|linux|windows|macos"
  };
  function applyMediaFilter(value) {
    var input = document.getElementById("torrentsFilterInput");
    if (!input) return;
    var term = (value === "all") ? "" : (MEDIA_KEYWORDS[value] || value);
    input.value = term;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function wireMediaFilters() {
    var ul = document.getElementById("lwMediaFilters");
    if (!ul) return;
    ul.addEventListener("click", function (e) {
      var item = e.target.closest("[data-media]");
      if (!item) return;
      var value = item.getAttribute("data-media");
      ul.querySelectorAll(".fitem").forEach(function (x) { x.classList.remove("sel"); });
      item.classList.add("sel");
      try { applyMediaFilter(value); } catch (_) {}
    });
  }

  // ── Wire LimeWire toolbar buttons to qBittorrent actions ──
  function wireToolbar() {
    // Monitor → show transfer info (already visible)
    var monitorBtn = document.querySelector('.sb-tools .tool:nth-child(1)');
    if (monitorBtn) {
      monitorBtn.addEventListener('click', function() {
        // Focus the transfer table
        var table = document.querySelector('.dynamicTable');
        if (table) table.scrollIntoView({ behavior: 'smooth' });
      });
    }
    
    // Connections → open connections dialog
    var connBtn = document.querySelector('.sb-tools .tool:nth-child(2)');
    if (connBtn) {
      connBtn.addEventListener('click', function() {
        fetch('api/v2/transfer/info', { credentials: 'same-origin' })
          .then(r => r.json())
          .then(d => {
            alert('Download: ' + d.dl_info_speed + ' B/s\nUpload: ' + d.up_info_speed + ' B/s\nPeers: ' + d.peers + '\nDHT: ' + (d.dht_nodes || 0));
          });
      });
    }
    
    // New @ Lime → open add torrent dialog (what Library used to do)
    var newAtLimeBtn = document.querySelector('.sb-tools .tool:nth-child(3)');
    if (newAtLimeBtn) {
      newAtLimeBtn.addEventListener('click', function() {
        var uploadLink = document.getElementById('uploadLink');
        if (uploadLink) uploadLink.click();
      });
    }
  }

  // ── Wire LimeWire control bar buttons to the selected torrent ──
  function wireControlBar() {
    // Helper: get the selected torrent hashes
    function getSelectedHashes() {
      if (typeof torrentsTable !== 'undefined' && torrentsTable.selectedRowsIds) {
        var hashes = torrentsTable.selectedRowsIds();
        return hashes.length > 0 ? hashes : null;
      }
      return null;
    }

    // Clear → remove selected torrent (without deleting files)
    var clearBtn = document.querySelector('.ctrlbar .cbtn:nth-child(1)');
    if (clearBtn) {
      clearBtn.addEventListener('click', function() {
        var hashes = getSelectedHashes();
        if (!hashes) { alert('No torrent selected'); return; }
        if (!confirm('Remove selected torrent?')) return;
        fetch('api/v2/torrents/delete', {
          method: 'POST',
          body: new URLSearchParams({
            hashes: hashes.join('|'),
            deleteFiles: 'false'
          })
        }).then(function() { if (typeof updateMainData === 'function') updateMainData(); });
      });
    }

    // Resume → start selected torrent
    var resumeBtn = document.querySelector('.ctrlbar .cbtn:nth-child(2)');
    if (resumeBtn) {
      resumeBtn.addEventListener('click', function() {
        var hashes = getSelectedHashes();
        if (!hashes) { alert('No torrent selected'); return; }
        fetch('api/v2/torrents/start', {
          method: 'POST',
          body: new URLSearchParams({ hashes: hashes.join('|') })
        }).then(function() { if (typeof updateMainData === 'function') updateMainData(); });
      });
    }

    // Pause → stop selected torrent
    var pauseBtn = document.querySelector('.ctrlbar .cbtn:nth-child(3)');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', function() {
        var hashes = getSelectedHashes();
        if (!hashes) { alert('No torrent selected'); return; }
        fetch('api/v2/torrents/stop', {
          method: 'POST',
          body: new URLSearchParams({ hashes: hashes.join('|') })
        }).then(function() { if (typeof updateMainData === 'function') updateMainData(); });
      });
    }

    // Clear Inactive → remove all inactive torrents
    var clearInactiveBtn = document.querySelector('.ctrlbar .cbtn:nth-child(4)');
    if (clearInactiveBtn) {
      clearInactiveBtn.addEventListener('click', function() {
        if (!confirm('Remove all inactive torrents?')) return;
        // Get all torrents and filter for inactive ones
        fetch('api/v2/torrents/info')
          .then(r => r.json())
          .then(d => {
            var inactive = d.filter(t => t.state === 'stoppedDL' || t.state === 'stoppedUP' || t.state === 'stalledUP');
            if (inactive.length === 0) { alert('No inactive torrents'); return; }
            fetch('api/v2/torrents/delete', {
              method: 'POST',
              body: new URLSearchParams({
                hashes: inactive.map(t => t.hash).join('|'),
                deleteFiles: 'false'
              })
            }).then(function() { if (typeof updateMainData === 'function') updateMainData(); });
          });
      });
    }
  }

  // ── Wire LimeWire dropdown menus to qBittorrent actions ──
  function wireMenus() {
    // Map menu actions to qBittorrent element IDs or API calls
    var actionMap = {
      'upload': 'uploadLink',
      'download': 'downloadLink',
      'logout': 'logoutLink',
      'shutdown': 'shutdownLink',
      'start': 'startLink',
      'stop': 'stopLink',
      'startAll': 'startAllLink',
      'stopAll': 'stopAllLink',
      'delete': 'deleteLink',
      'resumeSession': 'resumeSessionLink',
      'pauseSession': 'pauseSessionLink',
      'showTopToolbar': 'showTopToolbar',
      'showStatusBar': 'showStatusBar',
      'showFiltersSidebar': 'showFiltersSidebar',
      'speedInTitleBar': 'speedInTitleBar',
      'showSearchEngine': 'showSearchEngine',
      'showRssReader': 'showRssReader',
      'showLogViewer': 'showLogViewer',
      'statistics': 'statisticsLink',
      'torrentCreator': 'torrentCreatorLink',
      'manageCookies': 'manageCookiesLink',
      'preferences': 'preferencesLink',
      'registerMagnetHandler': 'registerMagnetHandlerLink',
      'about': 'aboutLink'
    };

    // Wire each dropdown
    var dropdowns = ['File', 'Edit', 'View', 'Tools', 'Help'];
    dropdowns.forEach(function(name) {
      var menuBtn = document.getElementById('lwMenu' + name);
      var dropdown = document.getElementById('lwDropdown' + name);
      if (!menuBtn || !dropdown) return;

      menuBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        console.log('Menu clicked:', name);
        // Close other dropdowns
        dropdowns.forEach(function(otherName) {
          if (otherName !== name) {
            var otherDropdown = document.getElementById('lwDropdown' + otherName);
            if (otherDropdown) otherDropdown.classList.remove('open');
          }
        });
        // Toggle this dropdown
        var isOpen = dropdown.classList.toggle('open');
        console.log('Dropdown state:', name, isOpen ? 'OPEN' : 'CLOSED');
      });

      // Wire menu items
      dropdown.querySelectorAll('.lw-menuitem').forEach(function(item) {
        item.addEventListener('click', function() {
          var action = item.getAttribute('data-action');
          var href = item.getAttribute('data-href');
          dropdown.classList.remove('open');

          // Handle special actions
          if (action === 'selectAll') {
            if (typeof torrentsTable !== 'undefined') {
              torrentsTable.selectRows(0, torrentsTable.getRowsNumber() - 1, true);
            }
            return;
          }
          if (action === 'invertSelection') {
            if (typeof torrentsTable !== 'undefined') {
              var rows = torrentsTable.getRows();
              for (var i = 0; i < rows.length; i++) {
                rows[i].classList.toggle('selected');
              }
            }
            return;
          }

          // Open external links
          if (href) {
            window.open(href, '_blank');
            return;
          }

          // Trigger qBittorrent action
          var targetId = actionMap[action];
          if (targetId) {
            var target = document.getElementById(targetId);
            if (target) {
              target.click();
              return;
            }
          }
        });
      });
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', function() {
      dropdowns.forEach(function(name) {
        var dropdown = document.getElementById('lwDropdown' + name);
        if (dropdown) dropdown.classList.remove('open');
      });
    });
  }

  window.addEventListener("DOMContentLoaded", function () {
    wireStatusFilters();
    wireMediaFilters();
    wireToolbar();
    wireControlBar();
    wireMenus();
    tick();
    setInterval(tick, 2000);
  });
})();

// Move MochaUI windows to body so they escape overflow:hidden containers
// Use a MutationObserver to catch windows as they're created
(function() {
  function escapeWindow(win) {
    if (win.parentElement !== document.body) {
      document.body.appendChild(win);
      // Bump z-index to ensure it's on top
      win.style.zIndex = '10001';
    }
  }
  
  const observer = new MutationObserver((mutations) => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType === 1 && node.classList && node.classList.contains('mocha')) {
          escapeWindow(node);
        }
      });
    });
  });
  
  window.addEventListener('DOMContentLoaded', () => {
    // Watch document.body for new MochaUI windows
    observer.observe(document.body, { childList: true, subtree: true });
    // Also check for any existing windows
    document.querySelectorAll('.mocha').forEach(escapeWindow);
  });
})();
