
    // Version is single-source-of-truth.
    // Keep this block extremely defensive for iOS Safari.
    window.APP_VERSION = "18.10.40";
    // Defer SW registration to after DOM is ready (and never hard-fail).
    window.__TRY_REGISTER_SW__ = function(){
      try {
        if (!('serviceWorker' in navigator)) return;
        var v = String(window.APP_VERSION || '');
        var q = v.replace(/\./g, '_');
        var p = navigator.serviceWorker.register('./sw.js?v=' + q);
        if (p && p.catch) p.catch(function(){});
      } catch (e) {
        // ignore
      }
    };
  
