# Test Raporu

Tarih: 2026-10-26 · Node 22 · vitest 2.1 · Chromium (Playwright, SwiftShader yazılım WebGL)

## Otomatik birim testleri — `npm test`
**10 dosya, 132 test, hepsi geçti** (son çalıştırma). `npm run typecheck` temiz; `npm run build` başarılı.

| Dosya | Kapsam |
|---|---|
| economy | para hareketi, defter, grantOnce |
| garage | satın alma/satış, yükseltme, tamir, kozmetik |
| passengers-trips | koltuk sınırı, biniş/iniş, sefer gelir hesabı |
| missions-daily | görev ilerlemesi, günlük ödül, saat geri alma |
| save-routes-drivers | sürümlü kayıt, yedekten kurtarma, rotalar, AI şoför, çevrimdışı sınır |
| ads-purchases-premium | reklam akışı/bekleme, satın alma, iade, Premium durumları |
| vehicle-road | fizik, yol geometrisi |
| i18n | TR/EN anahtar eşitliği |
| imported-buses | 50 GLB'nin tamamı: 4 tekerlek (2 ön), kapı, gövde, cam, katalog boyutları, TR/EN isimler, satın alma + kayıt turu |
| traffic-scenery-perf | ışık döngüsü, dekor determinizmi, durak rezervi, PerformanceManager |

## Tarayıcı duman testi — `npm run e2e` (opsiyonel, CI'da yok)
- 16 menü ekranı açıldı, konsol hatası yok.
- Otomatik pilot ile tam sefer (Kuzeyliman → Yeşilvadi, otoyol) **tamamlandı**: 41 yolcu, kâr ödendi.
- Önceki elle çalıştırmalarda 118 km otoyol ve 321 km eski yol (1 mola) seferleri tamamlandı.
- İçe aktarılan otobüslerle (rm16 ve elektrikli rm05) tam sefer tamamlandı; showroom, kapı yan görünümü, arka görünüm, gündüz/gece sürüş ve Tab ile kamera modları ekran görüntüsüyle kontrol edildi.
- **Gerçek fare tıklaması** testi eklendi: boş katman (`modal-layer`) tüm tıklamaları yutuyordu; CSS özgüllüğü düzeltildi (bkz. aşağıdaki not).
- Mobil yatay (844×390) dokunmatik HUD ve gece/kokpit kamerası ekran görüntüsüyle kontrol edildi.

## Test EDİLMEYENLER
- Gerçek cihaz performansı/FPS (yazılım GL ~5 FPS; sürüş hızı bu yüzden hızlandırılmış adımla sınandı).
- Gerçek dokunmatik cihaz, gerçek gamepad, Safari/Firefox.
- Gerçek reklam, gerçek satın alma, Android paketi.
- Uzun süreli bellek sızıntısı (FPS düşüşü gözlendi, incelenmedi).

## Bu turda bulunan hata
Playwright'ın gerçek tıklaması `modal-layer` öğesinin menü ve butonların üstünde tıklamaları yuttuğunu gösterdi (`#ui > *{pointer-events:auto}` kuralı `.modal-layer{pointer-events:none}` kuralını eziyordu). Önceki testler tıklamayı JavaScript ile yaptığı için görmemişti. Düzeltildi ve `npm run e2e` artık gerçek tıklama içerir.
