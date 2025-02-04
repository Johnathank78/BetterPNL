const CACHE_NAME = 'app-cache-v1.1';

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            const urlsToCache = [
                '/BetterPNL/index.html',
                '/BetterPNL/resources/css/pnl.css',
                '/BetterPNL/resources/fonts/fonts/GothicA1-Bold.woff',
                '/BetterPNL/resources/imgs/profile.png',
                '/BetterPNL/resources/imgs/pnl_logo.png',
                '/BetterPNL/resources/imgs/smallSS.png',
                '/BetterPNL/resources/imgs/wideSS.png',
                '/BetterPNL/resources/imgs/icon.png',
                '/BetterPNL/resources/js/pnl.js',
                '/BetterPNL/resources/js/jquery.js',
                '/BetterPNL/resources/js/binance.js',
                "BetterPNL/resources/splash_screens/iPhone_15_Pro_Max__iPhone_15_Plus__iPhone_14_Pro_Max_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_15_Pro__iPhone_15__iPhone_14_Pro_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_14_Plus__iPhone_13_Pro_Max__iPhone_12_Pro_Max_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_14__iPhone_13_Pro__iPhone_13__iPhone_12_Pro__iPhone_12_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_13_mini__iPhone_12_mini__iPhone_11_Pro__iPhone_XS__iPhone_X_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_11_Pro_Max__iPhone_XS_Max_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_11__iPhone_XR_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_8_Plus__iPhone_7_Plus__iPhone_6s_Plus__iPhone_6_Plus_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_8__iPhone_7__iPhone_6s__iPhone_6__4.7__iPhone_SE_landscape.png",
                "BetterPNL/resources/splash_screens/4__iPhone_SE__iPod_touch_5th_generation_and_later_landscape.png",
                "BetterPNL/resources/splash_screens/13__iPad_Pro_M4_landscape.png",
                "BetterPNL/resources/splash_screens/12.9__iPad_Pro_landscape.png",
                "BetterPNL/resources/splash_screens/11__iPad_Pro_M4_landscape.png",
                "BetterPNL/resources/splash_screens/11__iPad_Pro__10.5__iPad_Pro_landscape.png",
                "BetterPNL/resources/splash_screens/10.9__iPad_Air_landscape.png",
                "BetterPNL/resources/splash_screens/10.5__iPad_Air_landscape.png",
                "BetterPNL/resources/splash_screens/10.2__iPad_landscape.png",
                "BetterPNL/resources/splash_screens/9.7__iPad_Pro__7.9__iPad_mini__9.png",
                "BetterPNL/resources/splash_screens/8.3__iPad_Mini_landscape.png",
                "BetterPNL/resources/splash_screens/iPhone_15_Pro_Max__iPhone_15_Plus__iPhone_14_Pro_Max_portrait.png",
                "BetterPNL/resources/splash_screens/iPhone_15_Pro__iPhone_15__iPhone_14_Pro_portrait.png",
                "BetterPNL/resources/splash_screens/iPhone_14_Plus__iPhone_13_Pro_Max__iPhone_12_Pro_Max_portrait.png",
                "BetterPNL/resources/splash_screens/iPhone_14__iPhone_13_Pro__iPhone_13__iPhone_12_Pro__iPhone_12_portrait.png",
                "BetterPNL/resources/splash_screens/iPhone_13_mini__iPhone_12_mini__iPhone_11_Pro__iPhone_XS__iPhone_X_portrait.png",
                "BetterPNL/resources/splash_screens/iPhone_11_Pro_Max__iPhone_XS_Max_portrait.png",
                "BetterPNL/resources/splash_screens/iPhone_11__iPhone_XR_portrait.png",
                "BetterPNL/resources/splash_screens/iPhone_8_Plus__iPhone_7_Plus__iPhone_6s_Plus__iPhone_6_Plus_portrait.png",
                "BetterPNL/resources/splash_screens/iPhone_8__iPhone_7__iPhone_6s__iPhone_6__4.7__iPhone_SE_portrait.png",
                "BetterPNL/resources/splash_screens/4__iPhone_SE__iPod_touch_5th_generation_and_later_portrait.png",
                "BetterPNL/resources/splash_screens/13__iPad_Pro_M4_portrait.png",
                "BetterPNL/resources/splash_screens/12.9__iPad_Pro_portrait.png",
                "BetterPNL/resources/splash_screens/11__iPad_Pro_M4_portrait.png",
                "BetterPNL/resources/splash_screens/11__iPad_Pro__10.5__iPad_Pro_portrait.png",
                "BetterPNL/resources/splash_screens/10.9__iPad_Air_portrait.png",
                "BetterPNL/resources/splash_screens/10.5__iPad_Air_portrait.png",
                "BetterPNL/resources/splash_screens/10.2__iPad_portrait.png",
                "BetterPNL/resources/splash_screens/9.7__iPad_Pro__7.9__iPad_mini__9.png",
                "BetterPNL/resources/splash_screens/8.3__iPad_Mini_portrait.png"
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
            console.error('Cache open failed:', error);
        })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.filter(name => name !== CACHE_NAME).map(name => {
                    return caches.delete(name); // Delete old caches
                })
            );
        })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.open(CACHE_NAME).then(cache => { 
            return cache.match(event.request).then(response => {
                const fetchPromise = fetch(event.request).then(networkResponse => {
                    if (event.request.method === 'GET') {
                        cache.put(event.request, networkResponse.clone()); // Update cache with new response
                    }
                    return networkResponse;
                }).catch(error => {
                    console.error('Fetch failed for:', event.request.url, '; Error:', error);
                    return response; // Return cached response if fetch fails
                });

                return response || fetchPromise;
            });
        })
    );
});
