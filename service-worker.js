const CACHE_NAME = "app-cache-v6.5";

self.addEventListener("install", (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            const urlsToCache = [
                "BetterPNL/index.html",
                "BetterPNL/resources/css/pnl.css",
                "BetterPNL/resources/imgs/profile.png",
                "BetterPNL/resources/imgs/pnl_logo.png",
                "BetterPNL/resources/imgs/smallSS.png",
                "BetterPNL/resources/imgs/wideSS.png",
                "BetterPNL/resources/imgs/preview.png",
                "BetterPNL/resources/imgs/icon.png",
                "BetterPNL/resources/js/pnl.js",
                "BetterPNL/resources/js/bottomNotification.js",
                "BetterPNL/resources/js/jquery.js",
                "BetterPNL/resources/splash_screens/iPhone_8_Plus__iPhone_7_Plus__iPhone_6s_Plus__iPhone_6_Plus_portrait.png",
                "BetterPNL/resources/splash_screens/iPhone_16_Pro_Max_portrait.png",
                "BetterPNL/resources/splash_screens/10.9__iPad_Air_portrait.png",
                "BetterPNL/resources/splash_screens/iPhone_13_mini__iPhone_12_mini__iPhone_11_Pro__iPhone_XS__iPhone_X_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_14__iPhone_13_Pro__iPhone_13__iPhone_12_Pro__iPhone_12_portrait.png",
                "BetterPNL/resources/splash_screens/13__iPad_Pro_M4_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_14_Plus__iPhone_13_Pro_Max__iPhone_12_Pro_Max_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_8__iPhone_7__iPhone_6s__iPhone_6__4.7__iPhone_SE_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_14__iPhone_13_Pro__iPhone_13__iPhone_12_Pro__iPhone_12_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_11_Pro_Max__iPhone_XS_Max_portrait.png",
                "BetterPNL/resources/splash_screens/iPhone_8__iPhone_7__iPhone_6s__iPhone_6__4.7__iPhone_SE_portrait.png",
                "BetterPNL/resources/splash_screens/4__iPhone_SE__iPod_touch_5th_generation_and_later_landscape.png",
                "BetterPNL/resources/splash_screens/12.9__iPad_Pro_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_13_mini__iPhone_12_mini__iPhone_11_Pro__iPhone_XS__iPhone_X_portrait.png",
                "BetterPNL/resources/splash_screens/iPhone_14_Plus__iPhone_13_Pro_Max__iPhone_12_Pro_Max_portrait.png",
                "BetterPNL/resources/splash_screens/10.9__iPad_Air_landscape.png",
                "BetterPNL/resources/splash_screens/10.2__iPad_portrait.png",
                "BetterPNL/resources/splash_screens/4__iPhone_SE__iPod_touch_5th_generation_and_later_portrait.png",
                "BetterPNL/resources/splash_screens/8.3__iPad_Mini_portrait.png",
                "BetterPNL/resources/splash_screens/iPhone_11__iPhone_XR_landscape.png",
                "BetterPNL/resources/splash_screens/11__iPad_Pro__10.5__iPad_Pro_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_16_Plus__iPhone_15_Pro_Max__iPhone_15_Plus__iPhone_14_Pro_Max_portrait.png",
                "BetterPNL/resources/splash_screens/iPhone_11_Pro_Max__iPhone_XS_Max_landscape.png",
                "BetterPNL/resources/splash_screens/11__iPad_Pro_M4_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_16__iPhone_15_Pro__iPhone_15__iPhone_14_Pro_portrait.png",
                "BetterPNL/resources/splash_screens/9.7__iPad_Pro__7.9__iPad_mini__9.7__iPad_Air__9.7__iPad_portrait.png",
                "BetterPNL/resources/splash_screens/iPhone_16_Pro_landscape.png",
                "BetterPNL/resources/splash_screens/8.3__iPad_Mini_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_16__iPhone_15_Pro__iPhone_15__iPhone_14_Pro_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_16_Pro_Max_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_11__iPhone_XR_portrait.png",
                "BetterPNL/resources/splash_screens/10.2__iPad_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_8_Plus__iPhone_7_Plus__iPhone_6s_Plus__iPhone_6_Plus_landscape.png",
                "BetterPNL/resources/splash_screens/12.9__iPad_Pro_portrait.png",
                "BetterPNL/resources/splash_screens/11__iPad_Pro_M4_portrait.png",
                "BetterPNL/resources/splash_screens/9.7__iPad_Pro__7.9__iPad_mini__9.7__iPad_Air__9.7__iPad_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_16_Pro_portrait.png",
                "BetterPNL/resources/splash_screens/13__iPad_Pro_M4_portrait.png",
                "BetterPNL/resources/splash_screens/10.5__iPad_Air_portrait.png",
                "BetterPNL/resources/splash_screens/10.5__iPad_Air_landscape.png",
                "BetterPNL/resources/splash_screens/11__iPad_Pro__10.5__iPad_Pro_portrait.png",
                "BetterPNL/resources/splash_screens/iPhone_16_Plus__iPhone_15_Pro_Max__iPhone_15_Plus__iPhone_14_Pro_Max_landscape.png"
            ];

            const cachePromises = urlsToCache.map(url => {
                return cache.add(url).then(() => {
                    //console.log(`Successfully cached: ${url}`);
                }).catch(error => {
                    console.error(`Failed to cache ${url}:`, error);
                });
            });

            return Promise.all(cachePromises);
        }).catch(error => {
            console.error("Cache open failed:", error);
        })
    );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE_NAME).map(caches.delete));
    await self.clients.claim(); // 👉 contrôle immédiat des pages
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 🚫 Ne jamais mettre en cache les appels API / proxy
  if (url.pathname.startsWith("/proxy") || url.pathname.startsWith("/listenKey")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-first pour les assets statiques
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((response) => {
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (event.request.method === "GET") {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch((error) => {
            console.error("Fetch failed:", event.request.url, error);
            return response; // fallback cache
          });

        return response || fetchPromise;
      })
    )
  );
});

self.addEventListener("notificationclick", event => {
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
            if(clientList.length > 0){return clientList[0].focus()};

            return clients.openWindow("/");
        })
    );
});
