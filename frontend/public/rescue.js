// Salvavidas si la app no llega a pintar (p. ej. un iPhone con una versión vieja guardada por el service worker y sin
// poder borrar los datos de Safari). Script clásico y sin dependencias: no pasa por el bundle de React (CSP: script-src 'self').
setTimeout(function () {
  var root = document.getElementById('root')
  if (!root || root.childElementCount) return
  var box = document.createElement('div')
  box.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;background:#050A2E;color:#fff;font:16px system-ui,sans-serif;text-align:center'
  var p = document.createElement('p')
  p.textContent = 'La app no ha cargado.'
  var b = document.createElement('button')
  b.textContent = 'Actualizar la app'
  b.style.cssText = 'min-height:48px;padding:0 24px;border:0;border-radius:12px;background:#fff;color:#050A2E;font:600 16px system-ui,sans-serif'
  b.onclick = function () {
    b.disabled = true
    b.textContent = 'Actualizando…'
    var regs = navigator.serviceWorker ? navigator.serviceWorker.getRegistrations() : Promise.resolve([])
    var keys = window.caches ? caches.keys() : Promise.resolve([])
    Promise.all([
      regs.then(function (r) { return Promise.all(r.map(function (x) { return x.unregister() })) }),
      keys.then(function (k) { return Promise.all(k.map(function (x) { return caches.delete(x) })) }),
    ]).catch(function () {}).then(function () { location.reload() })
  }
  box.append(p, b)
  document.body.append(box)
}, 6000)
