/* Bloopet — Universal Ad-Free Stub + Game SDK Compatibility Layer */
(function() {
  'use strict';

  var noop = function() {};
  var callNow = function(fn, arg) { if (typeof fn === 'function') setTimeout(function() { fn(arg); }, 0); };

  /* ---- GameDistribution (GD) SDK stub ---- */
  window.GD_OPTIONS = window.GD_OPTIONS || {};
  window.gdsdk = window.gdsdk || {
    showAd: function(type, cb) { callNow(cb); },
    openConsole: noop,
    preloadAd: function(type, cb) { callNow(cb); },
    cancelAd: noop,
    showBanner: noop,
    hideBanner: noop,
    isAdBlocked: function() { return false; }
  };

  /* ---- GameMonetize / Jump SDK stub ---- */
  var sdkObj = {
    showInterstitial: function(t, cb) { callNow(cb); },
    showRewardedVideo: function(cb) { callNow(cb, true); },
    showBanner: noop, hideBanner: noop, destroyBanner: noop,
    setGameData: noop, isAdBlocked: function() { return false; },
    init: function(o) {
      if (o) { callNow(o.gameStarted); callNow(o.onAdsFinished); }
      return sdkObj;
    },
    on: function(evt, cb) {
      var ok = ['SDK_GAME_START','SDK_READY','GAME_START','AD_SKIPPED','AD_FINISHED','AD_ERROR'];
      if (ok.indexOf(evt) !== -1) callNow(cb);
      return sdkObj;
    }
  };
  window.GameMonetize = window.GameMonetize || sdkObj;
  window.sdk = window.sdk || sdkObj;
  window.JumpSDK = window.JumpSDK || sdkObj;

  /* ---- MochiAds stub ---- */
  window.MochiAd = window.MochiAd || {
    showPreGameAd: function(o) { callNow(o && o.ad_finished); },
    showInterLevelAd: function(o) { callNow(o && o.ad_finished); },
    showTimedAd: function(o) { callNow(o && o.ad_finished); },
    getBannerAd: noop, adLoaded: noop
  };

  /* ---- Crazy Games stub ---- */
  window.CrazyGames = window.CrazyGames || { SDK: {
    ad: { requestAd: function(t,cb) { callNow(cb); }, hasAdblock: function() { return false; } },
    game: { sdkGameLoadingStart: noop, sdkGameLoadingStop: noop, gameplayStart: noop, gameplayStop: noop, happytime: noop }
  }};

  /* ---- Google AdSense / tag stub ---- */
  window.adsbygoogle = window.adsbygoogle || { push: noop };
  window.googletag = window.googletag || { cmd: { push: function(fn) { /* suppress */ } }, apiReady: false };
  window.gtag = window.gtag || noop;

  /* ---- Suppress any ad iframes/scripts that try to load ---- */
  var AD_HOSTS = ['googleads','doubleclick','pagead2','adservice','mochiads','gamemonetize.com','gamedistribution.com'];
  var _origCreate = document.createElement.bind(document);
  document.createElement = function(tag) {
    var el = _origCreate(tag);
    if (tag.toLowerCase() === 'script' || tag.toLowerCase() === 'iframe') {
      var _origSrc = Object.getOwnPropertyDescriptor(HTMLElement.prototype,'src') ||
                     Object.getOwnPropertyDescriptor(Element.prototype,'src') || null;
      Object.defineProperty(el, 'src', {
        set: function(v) {
          if (v && AD_HOSTS.some(function(h) { return v.indexOf(h) !== -1; })) {
            /* Block ad network URLs silently */
            return;
          }
          try { if (_origSrc && _origSrc.set) _origSrc.set.call(el, v); else el.setAttribute('src', v); }
          catch(e) {}
        },
        get: function() {
          try { return el.getAttribute('src') || ''; } catch(e) { return ''; }
        }
      });
    }
    return el;
  };

})();
