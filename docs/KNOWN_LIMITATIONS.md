# Bilinen Sınırlar (dürüst liste)

- **Gerçek reklam/IAP yok.** Yalnızca TEST adaptörleri ve arayüzler. Gerçek gelir için Android eklentisi + sunucu doğrulaması gerekir.
- **Sunucu yok:** saat ileri alma hilesi engellenemez (yalnızca geri alma azaltılır); bulut kayıt, liderlik tablosu, çok oyunculu yok.
- **Rota ölçeği 1:20:** mesafeler oyuna sığması için sıkıştırılmıştır; ücret/süre buna göre dengelidir.
- **Ses** tamamen sentez (WebAudio), prototip kalitesi; gerçek motor kaydı yok.
- **Performans gerçek cihazlarda ölçülmedi.** Testler yazılım WebGL'de (~5 FPS) yapıldı. Uzun oturumda FPS düşüşü gözlendi (8→4, yazılım GL) ve araştırılmadı.
- **Çevrimdışı PWA/service worker yok;** manifest vardır ama kurulabilir çevrimdışı deneyim sağlanmaz.
- **Android paketi üretilmedi;** ANDROID_BUILD.md test edilmemiş yol haritasıdır.
- Modeller prosedürel/düşük poligonlu prototiptir (6 yerleşik + 50 içe aktarılan GLB); UV/PBR doku, LOD, gerçek iç mekân ve silecek animasyonu yok, içe aktarılanlar düz gölgelidir. Ayrıntı: IMPORTED_BUSES.md.
- Mobil dokunmatik arayüz yalnızca emülasyonda (844×390) bakıldı; gerçek cihazda denenmedi.
- `.env.example` değişkenleri henüz kodda okunmuyor (adaptör yazılınca kullanılacak).
- E2E testi opsiyoneldir (Playwright kurulumu gerekir) ve CI'da çalıştırılmaz.
